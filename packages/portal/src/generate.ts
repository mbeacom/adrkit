/**
 * The build-time portal generator: the I/O around the pure builder
 * ([ADR-0054](../../../docs/adr/0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md)
 * clauses 3, 6, 9).
 *
 * It opens the corpus through `@adrkit/sdk`, resolves `asOf` (today, UTC, when not given),
 * resolves the commit and the tracked files through `git`, builds the path table from the
 * SDK's `governing(path)` for every tracked file, and writes the page bundle with
 * `portal-data.json` into `out`, replacing it whole: the bundle is built in a sibling staging
 * directory and swapped in only when complete. It never imports `@adrkit/core` or
 * `@adrkit/cli` and never spawns `adr` (clause 1).
 *
 * Exit codes follow `site.yml`'s publish step (clause 9):
 *
 * - `0` — the complete bundle was written.
 * - `1` — the complete bundle was written, and the corpus has error-severity issues: they are
 *   in the data file (for the page's banner) and in `errors`, and the path table is
 *   `unavailable`. The Action succeeds with a warning.
 * - `2` — usage error, unreadable corpus, a corpus directory that resolves outside the
 *   repository, or a write that failed. **Nothing is written**: a new `out` is not created,
 *   and an existing one is left byte-for-byte as it was.
 *
 * The bundle is stamped with HEAD's commit only when the checkout matches HEAD for its
 * purposes: no staged or unstaged change to a tracked file (the path table reads the working
 * tree) and no untracked file inside the corpus directory (the records are read from it).
 * Otherwise `commit` is `null`, so nothing is attributed to a commit that does not contain it,
 * and the page uses its no-commit wording. An untracked file elsewhere keeps the SHA.
 *
 * Outside a git work tree (git's own "not a git repository") there is no commit and the path
 * table is `absent`. A git that cannot start, an ownership refusal (`safe.directory`), or any
 * other git failure is exit 2 with a fixed message; git's stderr is never shown.
 *
 * Git is invoked with stdin closed, `GIT_TERMINAL_PROMPT=0`, and `GIT_OPTIONAL_LOCKS=0`, and
 * only `rev-parse`, `ls-files`, and `status`, none of which prints a signature or prompts. The user's
 * global git config is deliberately **not** overridden here (a runner's `safe.directory`
 * lives there); tests isolate it with `GIT_CONFIG_GLOBAL=/dev/null` instead (AGENTS.md).
 */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { openDecisions, type DecisionSet, type PathGovernance } from '@adrkit/sdk/src/index.ts';
import { buildPathTable, buildPortalData, DEFAULT_PATH_TABLE_CAPS, serializePortalData } from './data/build.ts';
import { PORTAL_ASSETS } from './page/assets.ts';
import {
  PORTAL_DATA_FILE,
  type PortalData,
  type PortalIssue,
  type PortalPathTable,
  type PortalPathTableCaps,
} from './data/contract.ts';

export interface GeneratePortalOptions {
  /** Corpus directory, resolved against `cwd`. Defaults to `docs/adr`. */
  readonly dir?: string;
  /** Output directory, resolved against `cwd`. Defaults to `_site`. */
  readonly out?: string;
  /** Working directory. Defaults to the process cwd. Inside a git work tree, the corpus is opened from its top level. */
  readonly cwd?: string;
  /** UTC calendar date `YYYY-MM-DD` for SLA states. Defaults to today (UTC). A datetime is a usage error. */
  readonly asOf?: string;
  /** Absolute `http:`/`https:` URL the site is served at; feeds absolute links only (clause 8). */
  readonly baseUrl?: string;
  /** Path table caps; each defaults to {@link DEFAULT_PATH_TABLE_CAPS}. */
  readonly pathTableCaps?: Partial<PortalPathTableCaps>;
  /** Clock, for tests. Only read when `asOf` is absent. */
  readonly now?: () => Date;
  /** Most concurrent `governing(path)` resolutions (each reads one file header). Defaults to 16. */
  readonly concurrency?: number;
  /** File writes, for tests that inject a failure. Defaults to `node:fs/promises`. */
  readonly io?: Partial<PortalIo>;
}

/** The file writes the generator makes while staging a bundle. */
export interface PortalIo {
  /** Write one UTF-8 file; its directory already exists. */
  writeFile(path: string, contents: string): Promise<void>;
}

const NODE_IO: PortalIo = { writeFile: (path, contents) => writeFile(path, contents, 'utf8') };

export interface GeneratePortalResult {
  /** `0` written; `1` written with corpus errors; `2` usage error or unreadable corpus, nothing written. */
  readonly exitCode: 0 | 1 | 2;
  /** Absolute path of the data file written, or `null` on exit 2. */
  readonly dataFile: string | null;
  /** The data written, or `null` on exit 2. */
  readonly data: PortalData | null;
  /** The corpus's error-severity issues (non-empty exactly when `exitCode` is 1). */
  readonly errors: readonly PortalIssue[];
  /** Why the run stopped, on exit 2; otherwise `null`. */
  readonly message: string | null;
}

const DEFAULT_CONCURRENCY = 16;

function usage(message: string): GeneratePortalResult {
  return { exitCode: 2, dataFile: null, data: null, errors: [], message };
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/** Build the portal data for one corpus and write it to `<out>/portal-data.json`. */
export async function generatePortal(options: GeneratePortalOptions = {}): Promise<GeneratePortalResult> {
  // Real path, so a symlinked cwd (macOS `/tmp`) compares against git's real top level.
  const given = resolve(options.cwd ?? process.cwd());
  const cwd = await realpath(given).catch(() => given);

  let asOf: string;
  if (options.asOf !== undefined) {
    if (!isCalendarDate(options.asOf)) return usage(`asOf must be a UTC calendar date YYYY-MM-DD; got "${options.asOf}".`);
    asOf = options.asOf;
  } else {
    asOf = (options.now ?? (() => new Date()))().toISOString().slice(0, 10);
  }

  let baseUrl: string | null = null;
  if (options.baseUrl !== undefined && options.baseUrl !== '') {
    let parsed: URL | null = null;
    try {
      parsed = new URL(options.baseUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      return usage(`base-url must be an absolute http: or https: URL; got "${options.baseUrl}".`);
    }
    baseUrl = parsed.href;
  }

  const caps: PortalPathTableCaps = {
    count: options.pathTableCaps?.count ?? DEFAULT_PATH_TABLE_CAPS.count,
    bytes: options.pathTableCaps?.bytes ?? DEFAULT_PATH_TABLE_CAPS.bytes,
  };
  for (const [name, value] of Object.entries(caps)) {
    if (!Number.isSafeInteger(value) || value < 0) return usage(`path table cap "${name}" must be a non-negative integer.`);
  }
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) return usage('concurrency must be a positive integer.');

  // Git: the top level anchors every path. Outside a work tree there is no commit and no
  // table; any other git failure (git missing, an ownership refusal, an unreadable `.git`)
  // is exit 2 with a fixed message, never git's own stderr.
  const located = await gitTopLevel(cwd);
  if (located.kind === 'missing') return usage(GIT_MISSING_MESSAGE);
  if (located.kind === 'error') return usage(GIT_REFUSED_MESSAGE);
  const toplevel = located.kind === 'repository' ? located.path : null;
  const root = toplevel ?? cwd;
  const givenDir = options.dir ?? 'docs/adr';
  const dirAbsolute = resolve(cwd, givenDir);
  const dirRelative = toPosix(relative(root, dirAbsolute));
  // Lexically, then through symlinks: a committed `docs/adr -> /elsewhere` must not publish
  // records from outside the work tree (the agent plugin's `staysInside` semantics). The
  // message is fixed, and names neither the target nor the root.
  const outsideMessage = `Corpus directory "${givenDir}" is outside the repository.`;
  if (dirRelative === '..' || dirRelative.startsWith('../') || isAbsolute(dirRelative)) return usage(outsideMessage);
  if (!(await staysInside(root, dirAbsolute))) return usage(outsideMessage);
  const dir = dirRelative === '' ? '.' : dirRelative;
  const out = resolve(cwd, options.out ?? '_site');
  // The bundle replaces `out` whole, so `out` may not be the repository, the working
  // directory, or any directory above them.
  // Lexically, then through symlinks in its existing components (`repo/up -> ..` with
  // `out: 'up/repo'` names the repository itself), before anything is staged.
  const realOut = await realpathOfExisting(out);
  const realRoot = await realpath(root).catch(() => root);
  if (contains(out, root) || contains(out, cwd) || contains(realOut, realRoot) || contains(realOut, cwd)) {
    return usage(`Output directory "${options.out ?? '_site'}" would replace the repository or the working directory.`);
  }

  let handle: DecisionSet;
  try {
    handle = await openDecisions({ dir, cwd: root });
  } catch (error) {
    // The SDK's one I/O failure it names: the corpus directory itself cannot be read.
    if (error instanceof Error && /^Corpus directory (not found|not readable):/.test(error.message)) {
      return usage(error.message);
    }
    throw error;
  }

  const errorIssues = handle.issues.filter((issue) => issue.severity === 'error');
  // The corpus comes from the working tree and the path list from the index, so a bundle is
  // stamped with HEAD only when the checkout matches it (see `checkoutMatchesHead`).
  let commit: string | null = null;
  if (toplevel !== null) {
    const clean = await checkoutMatchesHead(root, dir);
    if (clean === null) return usage(`Could not read the working tree's status with git.`);
    commit = clean ? await gitHead(root) : null;
  }

  let pathTable: PortalPathTable;
  if (errorIssues.length > 0) {
    // Clause 6: with corpus errors `governing` withholds every answer, so the table is
    // withheld too, rather than shown as a table in which nothing is governed.
    pathTable = { state: 'unavailable', reason: 'corpus-errors' };
  } else if (toplevel === null) {
    pathTable = { state: 'absent' };
  } else {
    const files = await gitTrackedFiles(root);
    if (files === null) return usage(`Could not list tracked files with git in "${root}".`);
    pathTable = buildPathTable(await resolveAll(handle, files, concurrency), caps);
  }

  const data = buildPortalData(handle, { dir, commit, asOf, pathTable });
  const bytes = serializePortalData(data);

  // Clause 9: exit 2 writes nothing. The whole bundle is built in a staging directory beside
  // `out` and swapped in only when complete; on any failure the staging directory is removed
  // and `out` is left exactly as it was.
  const dataFile = join(out, PORTAL_DATA_FILE);
  const failure = await writeBundle(out, { baseUrl, data, bytes }, { ...NODE_IO, ...options.io });
  if (failure !== null) return usage(failure);

  return {
    exitCode: errorIssues.length > 0 ? 1 : 0,
    dataFile,
    data,
    errors: data.issues.filter((issue) => issue.severity === 'error'),
    message: null,
  };
}

/** Resolve governance for every path with at most `limit` in flight. Order of the result is irrelevant: the table sorts. */
async function resolveAll(handle: DecisionSet, paths: readonly string[], limit: number): Promise<PathGovernance[]> {
  const results: PathGovernance[] = new Array(paths.length);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const index = next++;
      results[index] = await handle.governing(paths[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, paths.length) }, worker));
  return results;
}

/* ------------------------------------------------------------------ *
 * Assets — the renderer's hook
 * ------------------------------------------------------------------ */

export interface PortalAssetsContext {
  /** Absolute directory to write the page files into (the generator's staging directory). */
  readonly out: string;
  /** Validated absolute base URL, or `null`. Feeds absolute links only (clause 8). */
  readonly baseUrl: string | null;
  readonly data: PortalData;
}

/**
 * Write the page files (`src/page/assets.ts`: index.html, app.css, the page module, and the
 * two vendor modules it imports) into `context.out`. The files are embedded as text,
 * so the bundled Action writes them without reading anything beside itself. Every reference
 * inside them is relative and every route is a hash route (clause 8), so nothing is rewritten
 * here; `baseUrl` is accepted for absolute links and no page file needs one yet.
 *
 * Returns the written paths, relative to `out`. Throws a `PortalAssetsError` naming the file
 * and the error code when one cannot be written.
 */
export async function writePortalAssets(context: PortalAssetsContext, io: PortalIo = NODE_IO): Promise<readonly string[]> {
  const written: string[] = [];
  for (const asset of PORTAL_ASSETS) {
    const target = join(context.out, ...asset.path.split('/'));
    try {
      await mkdir(dirname(target), { recursive: true });
      await io.writeFile(target, asset.contents);
    } catch (error) {
      throw new PortalAssetsError(asset.path, errorCode(error));
    }
    written.push(asset.path);
  }
  return written;
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
}

/**
 * `path`'s real location: its deepest existing ancestor (itself included) through `realpath`,
 * with the components that do not exist yet appended.
 */
async function realpathOfExisting(path: string): Promise<string> {
  let existing = path;
  const rest: string[] = [];
  for (;;) {
    try {
      return join(await realpath(existing), ...rest);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return path;
      rest.unshift(basename(existing));
      existing = parent;
    }
  }
}

/** Whether `inner` is `outer` or below it. */
function contains(outer: string, inner: string): boolean {
  const rel = relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Whether `target` resolves, through symlinks, to `root` or below it. A path that does not
 * exist yet stays inside (the SDK then reports it missing); any other failure does not.
 */
async function staysInside(root: string, target: string): Promise<boolean> {
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return false;
  }
  let real: string;
  try {
    real = await realpath(target);
  } catch (error) {
    return errorCode(error) === 'ENOENT';
  }
  return real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
}

/**
 * Build the bundle in a sibling staging directory and swap it in for `out`. Returns `null` on
 * success, or the fixed failure message with `out` untouched and nothing left behind (a parent
 * directory this call had to create is removed again).
 */
async function writeBundle(
  out: string,
  bundle: { readonly baseUrl: string | null; readonly data: PortalData; readonly bytes: string },
  io: PortalIo,
): Promise<string | null> {
  const parent = dirname(out);
  let createdParent: string | undefined;
  let staging: string | null = null;
  const cleanUp = async () => {
    if (staging !== null) await rm(staging, { recursive: true, force: true });
    if (createdParent !== undefined) await rm(createdParent, { recursive: true, force: true });
  };
  try {
    createdParent = await mkdir(parent, { recursive: true });
    staging = await mkdtemp(join(parent, `.${basename(out)}.staging-`));
  } catch (error) {
    await cleanUp();
    return `Could not prepare "${out}" (${errorCode(error)}).`;
  }
  try {
    await writePortalAssets({ out: staging, baseUrl: bundle.baseUrl, data: bundle.data }, io);
    await io.writeFile(join(staging, PORTAL_DATA_FILE), bundle.bytes);
  } catch (error) {
    await cleanUp();
    const path = error instanceof PortalAssetsError ? error.target : PORTAL_DATA_FILE;
    const code = error instanceof PortalAssetsError ? error.code : errorCode(error);
    return `Could not write "${join(out, ...path.split('/'))}" (${code}).`;
  }
  // Swap: the old bundle aside, the new one in, the old one removed. If the new one cannot
  // move in, the old one is moved back.
  const aside = `${staging}.old`;
  let movedAside = false;
  try {
    try {
      await rename(out, aside);
      movedAside = true;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    await rename(staging, out);
    staging = null;
  } catch (error) {
    if (movedAside) await rename(aside, out).catch(() => undefined);
    await cleanUp();
    return `Could not replace "${out}" (${errorCode(error)}).`;
  }
  if (movedAside) await rm(aside, { recursive: true, force: true });
  return null;
}

/** A page file could not be written. */
export class PortalAssetsError extends Error {
  constructor(
    /** The asset's path, relative to the bundle directory. */
    readonly target: string,
    readonly code: string,
  ) {
    super(`Could not write "${target}" (${code}).`);
    this.name = 'PortalAssetsError';
  }
}

/* ------------------------------------------------------------------ *
 * Git
 * ------------------------------------------------------------------ */

interface GitResult {
  readonly code: number | null;
  readonly stdout: Buffer;
  /** Read only to classify a failure; never shown or returned. */
  readonly stderr: string;
}

const GIT_MISSING_MESSAGE = 'git could not be started, so the repository could not be read; install git or put it on PATH.';
const GIT_REFUSED_MESSAGE =
  'git refused to read this repository, or could not read it; check its ownership and permissions (safe.directory).';

/** Run git with stdin closed and no prompt; `null` when git cannot be started at all. */
function runGit(args: readonly string[], cwd: string): Promise<GitResult | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') resolvePromise(null);
      else reject(error);
    });
    child.on('close', (code) =>
      resolvePromise({ code, stdout: Buffer.concat(chunks), stderr: Buffer.concat(errors).toString('utf8').slice(0, 4096) }),
    );
  });
}

type Located = { readonly kind: 'repository'; readonly path: string } | { readonly kind: 'outside' | 'missing' | 'error' };

/**
 * Where `cwd` sits. `outside` is kept for git's own answer that this is no work tree: exit
 * 128 with "not a git repository" (and no ownership refusal), or `--is-inside-work-tree`
 * printing `false` (inside `.git`). A git that cannot start is `missing`; every other failure
 * is `error`.
 */
async function gitTopLevel(cwd: string): Promise<Located> {
  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside === null) return { kind: 'missing' };
  if (inside.code === 0) {
    const answer = inside.stdout.toString('utf8').trim();
    if (answer === 'false') return { kind: 'outside' };
    if (answer !== 'true') return { kind: 'error' };
  } else {
    const refused = /dubious ownership|safe\.directory/i.test(inside.stderr);
    return inside.code === 128 && !refused && /not a git repository/i.test(inside.stderr) ? { kind: 'outside' } : { kind: 'error' };
  }
  const top = await runGit(['rev-parse', '--show-toplevel'], cwd);
  if (top === null) return { kind: 'missing' };
  if (top.code !== 0) return { kind: 'error' };
  const path = top.stdout.toString('utf8').replace(/\n$/, '');
  return path.length > 0 ? { kind: 'repository', path: resolve(path) } : { kind: 'error' };
}

/**
 * Whether the checkout matches HEAD for this bundle's purposes: no staged or unstaged change
 * to any tracked file (the path table reads the working tree) and no untracked file inside
 * the corpus directory (the records do). An untracked file elsewhere changes nothing the
 * bundle shows. `null` when git cannot say.
 */
async function checkoutMatchesHead(root: string, dir: string): Promise<boolean | null> {
  const status = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], root);
  if (!status || status.code !== 0) return null;
  const inCorpus = (path: string) => dir === '.' || path === dir || path.startsWith(`${dir}/`);
  for (const entry of status.stdout.toString('utf8').split('\0')) {
    if (entry.length < 4) continue;
    const state = entry.slice(0, 2);
    const path = entry.slice(3);
    if (state !== '??' || inCorpus(path)) return false;
  }
  return true;
}

/** HEAD's commit, or `null` in a repository with no commits. */
async function gitHead(root: string): Promise<string | null> {
  const head = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], root);
  if (!head || head.code !== 0) return null;
  const sha = head.stdout.toString('utf8').trim();
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha) ? sha : null;
}

/** Every tracked file, top-level-relative (`--full-name -- :/`), or `null` if git fails. */
async function gitTrackedFiles(root: string): Promise<string[] | null> {
  const listed = await runGit(['ls-files', '-z', '--full-name', '--', ':/'], root);
  if (!listed || listed.code !== 0) return null;
  return [...new Set(listed.stdout.toString('utf8').split('\0').filter((path) => path.length > 0))];
}
