/**
 * Decide whether a Dependabot pull request may have its committed artifacts
 * regenerated, and prepare the build worktree when it may.
 *
 * [ADR-0041](../docs/adr/0041-regenerate-committed-artifacts-on-dependabot-pull-requests-with-default-branch-s.md)
 * lets a maintainer label a Dependabot pull request so that
 * `.github/workflows/regenerate-artifacts.yml` rebuilds `packages/ci/dist` and
 * `schema/adr.schema.json` and pushes them back. That workflow runs on
 * `pull_request_target`, so every input here is untrusted and every rule below
 * fails closed.
 *
 * ## What "eligible" means
 *
 * - The pull request is open, targets the default branch, was opened by
 *   `dependabot[bot]`, and its head lives in this repository on a
 *   `dependabot/…` branch. The login comes from the API; `github.actor` is never
 *   consulted, because published research shows it can be made
 *   `dependabot[bot]` on a pull request Dependabot did not author.
 * - The head has not moved since the label was applied.
 * - Every commit is authored by `dependabot[bot]`, or by the regeneration App and
 *   touches only artifact paths. Committer is not checked: Dependabot's commits
 *   carry `web-flow`.
 * - Every changed file is a root-workspace manifest or `bun.lock`, with status
 *   `modified`, or an artifact path that only App commits touched.
 * - Each changed manifest differs from its merge-base copy **only** in the four
 *   dependency fields. A path allowlist alone would pass a changed `scripts`.
 *
 * ## Why an overlay rather than a copy
 *
 * The build must run `main`'s scripts. Copying the pull request's whole
 * `package.json` would revert any `scripts` change `main` made after Dependabot
 * branched, so `overlay` writes only the dependency fields onto `main`'s
 * manifest, and `bun.lock` verbatim. If `main` has since changed dependencies
 * too, `bun install --frozen-lockfile` refuses, which is the correct outcome: the
 * pull request needs a rebase before its artifacts mean anything.
 *
 * ## Dependencies, deliberately none
 *
 * Node builtins only, like `check-gate-integrity.ts`: the trusted workflow runs
 * this with no `bun install`. Git objects are read with `git show`, never checked
 * out.
 *
 *   bun scripts/check-regeneration-eligibility.ts check \
 *     --pr <pr.json> --commits <commits.json> --files <files.json> \
 *     --granted-head <sha> --merge-base <sha> --default-branch <name> \
 *     [--app-login <slug>[bot]] --out <eligible-files.txt>
 *
 *   bun scripts/check-regeneration-eligibility.ts overlay \
 *     --head <sha> --list <eligible-files.txt>
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export const DEPENDABOT_LOGIN = 'dependabot[bot]';

/** Manifest fields Dependabot may change. Anything else is a refusal. */
export const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** Root-workspace dependency files. `site/` is out of scope by construction. */
const DEPENDENCY_FILE = /^(?:bun\.lock|package\.json|packages\/[^/]+\/package\.json|packages\/adapters\/[^/]+\/package\.json)$/;

/** The only paths the regeneration may write. */
const ARTIFACT_FILE = /^(?:packages\/ci\/dist\/[^/]+\.js|schema\/adr\.schema\.json)$/;

const SHA = /^[0-9a-f]{40}$/;

/** Dependabot's branch names; also keeps the name safe to place in an API path. */
const DEPENDABOT_BRANCH = /^dependabot\/[A-Za-z0-9._@+/-]+$/;

/** A `..` segment is refused outright; `[^/]+` would otherwise accept one. */
function traverses(path: string): boolean {
  return path.split('/').some((segment) => segment === '..' || segment === '.');
}

export function isDependencyFile(path: string): boolean {
  return DEPENDENCY_FILE.test(path) && !traverses(path);
}

export function isArtifactFile(path: string): boolean {
  return ARTIFACT_FILE.test(path) && !traverses(path);
}

export interface PullRequest {
  state?: string;
  changed_files?: number;
  user?: { login?: string } | null;
  base?: { ref?: string; repo?: { full_name?: string } | null } | null;
  head?: { sha?: string; ref?: string; repo?: { full_name?: string } | null } | null;
}

export interface PullCommit {
  sha: string;
  author: { login?: string } | null;
  parents?: unknown[];
}

export interface PullFile {
  filename: string;
  status: string;
}

export interface EligibilityInput {
  pr: PullRequest;
  commits: PullCommit[];
  files: PullFile[];
  grantedHead: string;
  defaultBranch: string;
  /** `<slug>[bot]`, or undefined when no App commit is acceptable. */
  appLogin?: string;
  /** Paths touched by each App-authored commit, keyed by SHA. */
  appCommitPaths: Record<string, readonly string[]>;
  /** Merge-base and head text of every changed manifest; `null` when absent. */
  manifests: Record<string, { base: string | null; head: string | null }>;
}

export interface Eligibility {
  eligible: boolean;
  refusals: string[];
  /** Dependency files to overlay onto the default branch, sorted. */
  dependencyFiles: string[];
}

function sameExceptDependencies(base: unknown, head: unknown): boolean {
  if (!isPlainObject(base) || !isPlainObject(head)) return false;
  const strip = (manifest: Record<string, unknown>) => {
    const copy: Record<string, unknown> = { ...manifest };
    for (const field of DEPENDENCY_FIELDS) delete copy[field];
    return copy;
  };
  return canonical(strip(base)) === canonical(strip(head));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Key-order-independent serialization, so reformatting is not a difference. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Pure: every rule in the module comment, reporting all failures, not the first. */
export function evaluateEligibility(input: EligibilityInput): Eligibility {
  const refusals: string[] = [];
  const { pr } = input;

  if (pr.state !== 'open') refusals.push(`the pull request is ${pr.state ?? 'in an unknown state'}, not open`);
  if (pr.user?.login !== DEPENDABOT_LOGIN) {
    refusals.push(`the pull request was opened by ${pr.user?.login ?? 'an unknown account'}, not ${DEPENDABOT_LOGIN}`);
  }
  if (pr.base?.ref !== input.defaultBranch) {
    refusals.push(`the pull request targets ${pr.base?.ref ?? 'an unknown branch'}, not ${input.defaultBranch}`);
  }
  const headRepo = pr.head?.repo?.full_name;
  if (!headRepo || headRepo !== pr.base?.repo?.full_name) {
    refusals.push(`the head lives in ${headRepo ?? 'an unknown repository'}, not this repository`);
  }
  if (!DEPENDABOT_BRANCH.test(pr.head?.ref ?? '')) {
    refusals.push('the head branch is not a dependabot/… branch');
  }
  if (!SHA.test(input.grantedHead) || pr.head?.sha !== input.grantedHead) {
    refusals.push('the head moved after the label was applied; apply it again to the current head');
  }

  if (input.commits.length === 0) refusals.push('the commit list is empty, so authorship cannot be established');
  const appCommits = new Set<string>();
  for (const commit of input.commits) {
    const login = commit.author?.login;
    if ((commit.parents?.length ?? 1) !== 1) {
      refusals.push(`commit ${commit.sha} is a merge; update the branch with a Dependabot rebase instead`);
    } else if (login === DEPENDABOT_LOGIN) {
      continue;
    } else if (input.appLogin !== undefined && login === input.appLogin) {
      const paths = input.appCommitPaths[commit.sha];
      if (paths === undefined || paths.length === 0 || !paths.every(isArtifactFile)) {
        refusals.push(`commit ${commit.sha} by ${login} touches a path outside the regenerated artifacts`);
      } else {
        appCommits.add(commit.sha);
      }
    } else {
      refusals.push(`commit ${commit.sha} is authored by ${login ?? 'an account GitHub could not link'}, not ${DEPENDABOT_LOGIN}`);
    }
  }

  if (typeof pr.changed_files !== 'number' || pr.changed_files !== input.files.length) {
    refusals.push(
      `the file listing has ${input.files.length} entries but the pull request reports ${pr.changed_files ?? 'none'}; refusing to judge a partial list`,
    );
  }

  const appTouched = new Set(Array.from(appCommits).flatMap((sha) => input.appCommitPaths[sha] ?? []));
  const dependencyFiles: string[] = [];
  for (const file of input.files) {
    if (isDependencyFile(file.filename)) {
      if (file.status !== 'modified') {
        refusals.push(`${file.filename} is ${file.status}, and only a modification is expected`);
        continue;
      }
      dependencyFiles.push(file.filename);
    } else if (isArtifactFile(file.filename) && appTouched.has(file.filename)) {
      continue;
    } else {
      refusals.push(`${file.filename} is neither a dependency file nor an artifact a regeneration commit wrote`);
    }
  }

  for (const path of dependencyFiles.filter((p) => p.endsWith('package.json'))) {
    const pair = input.manifests[path];
    const base = pair?.base == null ? undefined : parseJson(pair.base);
    const head = pair?.head == null ? undefined : parseJson(pair.head);
    if (!sameExceptDependencies(base, head)) {
      refusals.push(`${path} changes more than its dependency fields`);
    }
  }

  if (dependencyFiles.length === 0) refusals.push('no dependency file changed, so there is nothing to regenerate from');

  return { eligible: refusals.length === 0, refusals, dependencyFiles: dependencyFiles.sort() };
}

/**
 * Pure: the default branch's manifest with only its dependency fields replaced
 * by the pull request's. A field absent from the pull request is removed.
 */
export function overlayManifest(defaultText: string, headText: string): string {
  const onDefault = parseJson(defaultText);
  const onHead = parseJson(headText);
  if (!isPlainObject(onDefault) || !isPlainObject(onHead)) {
    throw new Error('a manifest is not a JSON object');
  }
  const merged: Record<string, unknown> = { ...onDefault };
  for (const field of DEPENDENCY_FIELDS) {
    if (field in onHead) merged[field] = onHead[field];
    else delete merged[field];
  }
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/** `gh api --paginate --slurp` yields an array of pages. Flatten it, or refuse. */
export function flattenPages(parsed: unknown): unknown[] {
  if (!Array.isArray(parsed)) throw new Error('expected an array of pages');
  return parsed.flatMap((page) => {
    if (!Array.isArray(page)) throw new Error('expected every page to be an array');
    return page;
  });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gitShow(sha: string, path: string): string | null {
  try {
    return execFileSync('git', ['show', `${sha}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function commitPaths(sha: string): string[] {
  const out = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', sha], { encoding: 'utf8' });
  return out.split('\0').filter((p) => p.length > 0);
}

export function parseArgs(argv: readonly string[]): { mode: string; flags: Map<string, string> } {
  const [mode, ...rest] = argv;
  if (mode !== 'check' && mode !== 'overlay') throw new Error('usage: check-regeneration-eligibility.ts check|overlay [flags]');
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`malformed argument near ${key ?? 'end'}`);
    flags.set(key.slice(2), value);
  }
  return { mode, flags };
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value === '') throw new Error(`--${name} is required`);
  return value;
}

/** Escape control characters so an attacker-chosen path cannot forge log lines. */
function display(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function runCheck(flags: Map<string, string>): number {
  const pr = readJson(required(flags, 'pr')) as PullRequest;
  const commits = flattenPages(readJson(required(flags, 'commits'))) as PullCommit[];
  const files = flattenPages(readJson(required(flags, 'files'))) as PullFile[];
  const mergeBase = required(flags, 'merge-base');
  const headSha = pr.head?.sha ?? '';
  if (!SHA.test(mergeBase) || !SHA.test(headSha)) throw new Error('merge base and head must be full SHAs');
  const appLogin = flags.get('app-login') || undefined;

  const appCommitPaths: Record<string, string[]> = {};
  for (const commit of commits) {
    if (appLogin !== undefined && commit.author?.login === appLogin) appCommitPaths[commit.sha] = commitPaths(commit.sha);
  }
  const manifests: Record<string, { base: string | null; head: string | null }> = {};
  for (const file of files) {
    if (isDependencyFile(file.filename) && file.filename.endsWith('package.json')) {
      manifests[file.filename] = { base: gitShow(mergeBase, file.filename), head: gitShow(headSha, file.filename) };
    }
  }

  const result = evaluateEligibility({
    pr,
    commits,
    files,
    grantedHead: required(flags, 'granted-head'),
    defaultBranch: required(flags, 'default-branch'),
    appLogin,
    appCommitPaths,
    manifests,
  });
  if (!result.eligible) {
    console.error('not eligible for regeneration:');
    for (const refusal of result.refusals) console.error(`  - ${display(refusal)}`);
    return 1;
  }
  writeFileSync(required(flags, 'out'), result.dependencyFiles.map((p) => `${p}\n`).join(''));
  console.log(`eligible; dependency files: ${result.dependencyFiles.join(', ')}`);
  return 0;
}

function runOverlay(flags: Map<string, string>): number {
  const head = required(flags, 'head');
  if (!SHA.test(head)) throw new Error('--head must be a full SHA');
  const list = readFileSync(required(flags, 'list'), 'utf8').split('\n').filter((p) => p.length > 0);
  for (const path of list) {
    // Re-validated: the list crossed a job boundary as an artifact.
    if (!isDependencyFile(path)) throw new Error(`refusing to overlay ${display(path)}`);
    const onHead = gitShow(head, path);
    if (onHead === null) throw new Error(`${path} is missing at ${head}`);
    const contents = path === 'bun.lock' ? onHead : overlayManifest(readFileSync(path, 'utf8'), onHead);
    writeFileSync(path, contents);
    console.log(`overlaid ${path}`);
  }
  return 0;
}

if (import.meta.main) {
  try {
    const { mode, flags } = parseArgs(process.argv.slice(2));
    process.exit(mode === 'check' ? runCheck(flags) : runOverlay(flags));
  } catch (error) {
    console.error(display(error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }
}
