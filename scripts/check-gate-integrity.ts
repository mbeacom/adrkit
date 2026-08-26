/**
 * Fail when a pull request changes the surface that *defines* this repository's
 * CI gates, unless a maintainer has explicitly acknowledged the change.
 *
 * ## Why this exists at all
 *
 * Every gate in `.github/workflows/ci.yml` is executed from the pull request's
 * own checkout, so the pull request can edit both the check and the step that
 * invokes it and still produce a green required status (#137, measured on #98).
 * [ADR-0035](../docs/adr/0035-execute-the-gates-that-certify-a-pull-request-from-the-default-branch.md)
 * moves the checks that matter onto `pull_request_target`, which GitHub executes
 * from the repository's **default branch** — workflow file, referenced actions,
 * and `actions/checkout` commit alike. That closes the "edit the check" half.
 *
 * It does not close the other half. A required status check is matched by
 * *name*, so a pull request that cannot edit the trusted job can still add a
 * job of its own with the same name and let the later result stand. Every route
 * to that shadow runs through a change under `.github/workflows/`, which is what
 * this guard watches.
 *
 * ## What the acknowledgment is, and what it is not
 *
 * The token is a label, because applying one requires triage or write access on
 * this repository. An external contributor therefore cannot self-authorize; a
 * maintainer can, exactly as a maintainer can already merge.
 *
 * **This is not a claim that gate changes are tamper-proof.** Whoever can merge
 * can label. What changes is the *shape* of the failure: a gate change stops
 * being one diff line among two hundred and becomes an explicit, attributed,
 * timestamped act that blocks the merge until it is performed. ADR-0016 argues
 * that attention is not the constraint, and this guard agrees with it — it does
 * not ask anyone to look harder, it refuses to proceed.
 *
 * ## Dependencies, deliberately none
 *
 * Imports only Node builtins, like `check-dco.ts` and for the same reason: the
 * trusted workflow runs it with no `bun install`, so a broken or hostile
 * dependency graph cannot take the gate-integrity gate down with it. Nothing
 * here reads the repository tree either — the inputs are the pull request's
 * changed-path list and its labels, both supplied as JSON by the caller.
 *
 *   bun run scripts/check-gate-integrity.ts \
 *     --files <pr-files.json> --labels <pr-labels.json> \
 *     [--expected-files <n>] [--ack-label <name>]
 */

import { readFileSync } from 'node:fs';

/** The label whose presence acknowledges a change to the gate-defining surface. */
export const DEFAULT_ACK_LABEL = 'gate-change-acknowledged';

export interface GateSurface {
  /** Matched case-insensitively against a repository-relative POSIX path. */
  readonly pattern: string;
  /** `prefix` matches a directory subtree; `exact` matches one file. */
  readonly kind: 'prefix' | 'exact';
  /** Why a change here can alter what CI certifies. Printed on a block. */
  readonly why: string;
}

/**
 * The surface a change to which can alter what CI certifies.
 *
 * Deliberately narrow. Every entry is here because editing it changes what a
 * gate *does*, not merely what it runs over — a broad list would fire on
 * ordinary work, and a guard that fires constantly is one that gets labelled
 * reflexively, which is the same failure as not having it.
 *
 * `package.json` is a near miss and is left out on purpose. Repointing a
 * `check:*` script is a real neutering vector, but only for the advisory copies
 * in `ci.yml`: the trusted workflow invokes script paths directly rather than
 * through `bun run`, so no manifest edit can redirect it. Including it would put
 * this label on every dependency bump and every version bump, and the protection
 * bought would be over checks that are already not authoritative.
 */
export const GATE_SURFACES: readonly GateSurface[] = [
  {
    pattern: '.github/workflows/',
    kind: 'prefix',
    why: 'defines which checks run, what they invoke, and what they are named',
  },
  {
    pattern: '.github/actions/',
    kind: 'prefix',
    why: 'repository-local actions execute inside those checks',
  },
  {
    pattern: 'scripts/',
    kind: 'prefix',
    why: 'the checks themselves',
  },
  {
    pattern: 'packages/ci/',
    kind: 'prefix',
    why: 'the published governing-decisions and queue Actions, which are gates',
  },
  // All three locations GitHub honors, in its resolution order. Protecting only
  // the root file left the gap that matters: GitHub resolves `.github/CODEOWNERS`
  // *first*, so a pull request that adds one supersedes the protected root file
  // entirely without ever touching it. Found in security review, not by the
  // coverage assertion below — which iterates this list and therefore cannot
  // detect a surface that was never added.
  {
    pattern: '.github/CODEOWNERS',
    kind: 'exact',
    why: 'GitHub resolves this before the root file, so adding it supersedes CODEOWNERS',
  },
  {
    pattern: 'CODEOWNERS',
    kind: 'exact',
    why: 'decides who is asked to review a change to any of the above',
  },
  {
    pattern: 'docs/CODEOWNERS',
    kind: 'exact',
    why: 'the third location GitHub honors, after .github/ and the root',
  },
];

/**
 * The locations GitHub resolves CODEOWNERS from, in its own precedence order.
 *
 * Named separately from {@link GATE_SURFACES} so a test can assert the list is
 * complete against a specific stated set rather than against the surface list
 * itself. A coverage check that reads the thing it is checking cannot see an
 * omission, which is how `.github/CODEOWNERS` was missing in the first place.
 */
export const CODEOWNERS_LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;

/**
 * Routes to neutering a gate that this guard **does not** protect.
 *
 * Written down because the first version of this file claimed the opposite — that
 * every route to neutering a gate ran through a protected path — and that was
 * false. A false completeness assertion is worse than a documented gap, which is
 * ADR-0016's whole subject, so the gap is named here and pinned by a test rather
 * than left to a comment that can drift.
 *
 * The distinction that matters:
 *
 * - **The trusted gates are complete.** `trusted-dco` and `gate-integrity` run
 *   from the default branch and invoke script *paths* directly, never
 *   `bun run <name>`, so no manifest edit can redirect them and no package edit
 *   can change what they execute.
 * - **The advisory gates in `ci.yml` are not, and cannot be made so by any path
 *   list.** They run the pull request's own code from its own checkout. Every
 *   entry below is a real way to change what a required context does without
 *   touching a protected path.
 *
 * The remedy for a gate that must be trustworthy is to move it into
 * `trusted-gates.yml`, as the sign-off gate was. Extending this guard's protected
 * list would add friction — the root manifest changes on every weekly Dependabot
 * bump — while still not reaching the code those gates execute.
 */
export const DOCUMENTED_UNPROTECTED_ROUTES: ReadonlyArray<{
  readonly path: string;
  readonly reaches: string;
}> = [
  {
    path: 'package.json',
    reaches:
      'clean-clone-builds runs typecheck, build, lint, release:pack, check:deps, ' +
      'check:freeze-hashes, check:doc-pins, check:clause8, check:no-spike-heuristics, ' +
      'check:site-grammar and adr lint through `bun run <name>`; node-smoke and ' +
      'action-dogfood likewise. Repointing a script redirects all of them.',
  },
  {
    path: 'packages/cli/src/index.ts',
    reaches: 'self-dogfood runs `bun run adr check`, and clean-clone-builds `adr lint`',
  },
  {
    path: 'packages/core/src/index.ts',
    reaches: 'the corpus loader every adr subcommand resolves through',
  },
  {
    path: 'bunfig.toml',
    reaches: 'how every gate in ci.yml is resolved and run',
  },
  {
    path: 'tsconfig.json',
    reaches: 'what typecheck and lint actually check',
  },
];

export interface GateChange {
  readonly path: string;
  readonly surface: GateSurface;
}

export type GateVerdict = 'clean' | 'acknowledged' | 'blocked';

export interface GateIntegrityReport {
  /** Every changed path considered, whether or not it matched. Always reported. */
  readonly examined: number;
  readonly changes: readonly GateChange[];
  readonly acknowledged: boolean;
  readonly ackLabel: string;
  readonly verdict: GateVerdict;
}

/**
 * Pure: normalize a path for matching.
 *
 * Lowercased, because matching case-insensitively can only ever *add* a match.
 * That is the fail-closed direction: `Scripts/check-dco.ts` and
 * `scripts/check-dco.ts` are distinct to git but the same file to a
 * case-insensitive checkout, and a guard that missed one would be silent about
 * the change that mattered.
 *
 * A leading `./` is stripped and backslashes are folded to `/`. GitHub's API
 * emits neither, so both are belt rather than braces — but a normalizer that
 * accepts only the shape it expects fails open on the shape it does not.
 */
export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/** Pure: the surface `path` belongs to, or `undefined`. */
export function surfaceOf(path: string): GateSurface | undefined {
  const normalized = normalizePath(path);
  return GATE_SURFACES.find((surface) =>
    surface.kind === 'prefix'
      ? normalized.startsWith(normalizePath(surface.pattern))
      : normalized === normalizePath(surface.pattern),
  );
}

/**
 * Pure: classify a pull request's changed paths against the gate surface.
 *
 * `blocked` requires *both* that a gate path changed and that the acknowledgment
 * is absent, so the two inputs are reported separately rather than folded into
 * the verdict — a reader has to be able to tell "nothing matched" from
 * "something matched and was acknowledged", and a bare boolean cannot.
 */
export function classifyGateChanges(
  paths: readonly string[],
  labels: readonly string[],
  ackLabel: string = DEFAULT_ACK_LABEL,
): GateIntegrityReport {
  const changes: GateChange[] = [];
  for (const path of paths) {
    const surface = surfaceOf(path);
    if (surface) changes.push({ path, surface });
  }

  const wanted = ackLabel.trim().toLowerCase();
  const acknowledged = labels.some((label) => label.trim().toLowerCase() === wanted);

  const verdict: GateVerdict =
    changes.length === 0 ? 'clean' : acknowledged ? 'acknowledged' : 'blocked';

  return { examined: paths.length, changes, acknowledged, ackLabel, verdict };
}

/**
 * Pure: a path rendered safe to print in a GitHub Actions log.
 *
 * Git permits a newline in a filename and the files endpoint carries it through,
 * so an attacker-chosen path can place `::` at the start of a physical log line
 * inside a privileged job. The runner trims leading whitespace before testing for
 * the workflow-command prefix, so indenting the output is not protection: it
 * would parse `::add-mask::` or `::error::` and let a pull request forge
 * annotations and suppress this guard's own output.
 *
 * `JSON.stringify` escapes every control character and is reversible, so the
 * reader still sees exactly which path tripped the guard. Applied to *every*
 * printed path rather than only suspicious ones, because a rule that decides
 * which paths are dangerous is one more thing that can be wrong.
 */
export function displayPath(path: string): string {
  if (!/[\p{Cc}\p{Cf}]/u.test(path)) return path;
  // Not `JSON.stringify` alone. It escapes control characters below U+0020 but
  // leaves format characters such as U+200B ZERO WIDTH SPACE exactly as they are,
  // so a path carrying one would still print as though it did not — which is the
  // whole failure this function exists to prevent. Escaping every Cc and Cf
  // explicitly makes the invisible visible; the surrounding quotes mark the path
  // as rendered rather than literal.
  const escaped = path
    .replace(/[\\"]/g, (character) => `\\${character}`)
    .replace(
      /[\p{Cc}\p{Cf}]/gu,
      (character) => `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`,
    );
  return `"${escaped}"`;
}

/**
 * Pure: the report as text.
 *
 * States the examined count in every branch, including the clean one. ADR-0016's
 * complementary half: "looked at 41 paths, none under a gate surface" and "could
 * not see the changed paths at all" are the same sentence unless the check says
 * what it looked at, and the second is the one that matters here.
 */
export function formatReport(report: GateIntegrityReport): string {
  const lines = [`check-gate-integrity: examined ${report.examined} changed path(s)`];

  for (const change of report.changes) {
    lines.push(
      `  gate    ${displayPath(change.path)}  — ${change.surface.pattern}: ${change.surface.why}`,
    );
  }

  if (report.verdict === 'clean') {
    lines.push('check-gate-integrity: ok — no path under a gate-defining surface');
  } else if (report.verdict === 'acknowledged') {
    lines.push(
      `check-gate-integrity: ok — ${report.changes.length} gate path(s) changed, ` +
        `acknowledged by the "${report.ackLabel}" label`,
    );
  }

  return lines.join('\n');
}

/** Pure: the failure text for a blocked report. Empty string when not blocked. */
export function formatBlock(report: GateIntegrityReport): string {
  if (report.verdict !== 'blocked') return '';
  // Each path carries its surface's reason. A bare list of filenames tells the
  // reader that something tripped without telling them what the guard thinks the
  // file *is*, which is the difference between acting on the block and labelling
  // past it.
  const listed = report.changes
    .map(
      (change) =>
        `  ${displayPath(change.path)}\n    ${change.surface.pattern} — ${change.surface.why}`,
    )
    .join('\n');
  return (
    `${report.changes.length} of ${report.examined} changed path(s) alter the surface that ` +
    `defines this repository's CI gates:\n\n${listed}\n\n` +
    `A change here can alter what every other check certifies, so it needs an explicit\n` +
    `acknowledgment rather than a quiet diff line. A maintainer applies the\n` +
    `"${report.ackLabel}" label to this pull request, which requires triage or write\n` +
    `access and is recorded in the timeline against whoever applied it.\n\n` +
    `  gh pr edit <number> --add-label "${report.ackLabel}"\n\n` +
    `This is not an assertion that the change is correct — it is an assertion that it was\n` +
    `seen. See docs/adr/0035-execute-the-gates-that-certify-a-pull-request-from-the-default-branch.md.`
  );
}

/**
 * Pure: flatten what `gh api --paginate --slurp` produces.
 *
 * `--slurp` wraps each *page* in the outer array, so the shape is `Page[]` and
 * not `File[]`; without `--paginate` it is `File[]` directly. Both are accepted
 * because a script that understands only one of them silently reads zero files
 * from the other, and zero files is this check's pass condition.
 */
export function flattenPages(parsed: unknown): unknown[] {
  if (!Array.isArray(parsed)) {
    throw new Error(`expected a JSON array, got ${parsed === null ? 'null' : typeof parsed}`);
  }
  const flat: unknown[] = [];
  for (const entry of parsed) {
    if (Array.isArray(entry)) flat.push(...entry);
    else flat.push(entry);
  }
  return flat;
}

/** Pure: read a string field off every entry, rejecting an entry that lacks it. */
export function pluck(entries: readonly unknown[], field: string): string[] {
  return entries.map((entry, index) => {
    const value = (entry as Record<string, unknown> | null)?.[field];
    if (typeof value !== 'string') {
      throw new Error(
        `entry ${index} has no string "${field}"; refusing to check a partially-parsed list`,
      );
    }
    return value;
  });
}

/**
 * Pure: every path a changed-file entry touches — its current path and, for a
 * rename, the path it came from.
 *
 * The second half is load-bearing and was the guard's one real bypass. GitHub's
 * files endpoint reports a rename as `filename: <new>` with the old path only in
 * `previous_filename`, so a pull request that moved
 * `.github/workflows/trusted-gates.yml` to `.github/wf/trusted-gates.yml` would
 * present this check with a path matching nothing, pass clean, and delete the
 * trusted gate on merge. A deletion is not affected — `filename` is the deleted
 * path — which is exactly why the gap was easy to miss.
 *
 * Reading both is the fail-closed direction: it can only ever add a path.
 */
export function changedPaths(entries: readonly unknown[]): string[] {
  const paths: string[] = [];
  for (const path of pluck(entries, 'filename')) paths.push(path);
  for (const [index, entry] of entries.entries()) {
    const previous = (entry as Record<string, unknown> | null)?.previous_filename;
    if (previous === undefined || previous === null) continue;
    if (typeof previous !== 'string') {
      throw new Error(
        `entry ${index} has a non-string "previous_filename"; refusing to check a ` +
          `partially-parsed list`,
      );
    }
    paths.push(previous);
  }
  return paths;
}

function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not read ${path}, so nothing was examined. ${detail}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not valid JSON, so nothing was examined. ${detail}`);
  }
}

interface Options {
  files: string;
  labels: string;
  expectedFiles?: number;
  ackLabel: string;
}

export function parseArgs(argv: readonly string[]): Options {
  const options: Partial<Options> = { ackLabel: DEFAULT_ACK_LABEL };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--files':
      case '--labels':
      case '--ack-label':
      case '--expected-files': {
        if (value === undefined) throw new Error(`${flag} needs a value`);
        i += 1;
        if (flag === '--files') options.files = value;
        else if (flag === '--labels') options.labels = value;
        else if (flag === '--ack-label') options.ackLabel = value;
        else {
          // `Number('')` is 0 and `Number.isInteger(0)` is true, so an unset
          // `changed_files` would arrive here as a confident "the pull request
          // changed nothing" rather than as the missing input it is. The empty
          // string is rejected explicitly, because the whole point of this flag is
          // to notice when the count could not be read.
          if (value.trim() === '') {
            throw new Error('--expected-files was empty; the count is missing, not zero');
          }
          const parsed = Number(value);
          if (!Number.isInteger(parsed) || parsed < 0) {
            throw new Error(`--expected-files needs a non-negative integer, got "${value}"`);
          }
          options.expectedFiles = parsed;
        }
        break;
      }
      default:
        throw new Error(`unrecognized argument "${flag}"`);
    }
  }
  if (!options.files) throw new Error('--files is required');
  if (!options.labels) throw new Error('--labels is required');
  return options as Options;
}

function main(argv: readonly string[]): void {
  const options = parseArgs(argv);

  const entries = flattenPages(readJson(options.files));
  // Two different counts, deliberately kept apart. `entries` is what the pull
  // request changed and is what `changed_files` counts; `paths` can be longer,
  // because a rename contributes both the path it went to and the one it came
  // from. Comparing the wrong one against `--expected-files` would make every
  // renaming pull request fail as "truncated".
  const paths = changedPaths(entries);
  const labels = pluck(flattenPages(readJson(options.labels)), 'name');

  // A pull request always changes at least one file, so an empty list means the
  // listing failed rather than that nothing was touched. Reporting "0 paths, ok"
  // here renders identically to a clean run — the exact fail-quiet shape ADR-0016
  // exists to prevent, and the one that would make this guard useless in the only
  // case it is for.
  if (entries.length === 0) {
    throw new Error(
      'the pull request listed no changed files, which cannot happen. ' +
        'Refusing to report a pass over an empty list.',
    );
  }

  // The files endpoint caps at 3000 entries and says so by truncating, not by
  // erroring. A gate path past the cap would be invisible, so the count the pull
  // request itself reports is compared against the count actually read.
  if (options.expectedFiles !== undefined && options.expectedFiles !== entries.length) {
    throw new Error(
      `the pull request reports ${options.expectedFiles} changed file(s) but ${entries.length} ` +
        `were read; the listing is truncated or stale. Refusing to report a pass over a ` +
        `partial list.`,
    );
  }

  const report = classifyGateChanges(paths, labels, options.ackLabel);
  console.log(formatReport(report));

  if (report.verdict === 'blocked') throw new Error(formatBlock(report));
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-gate-integrity: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
