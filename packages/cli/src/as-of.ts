/**
 * Resolution of `adr explain --as-of <value>` to a UTC calendar date.
 *
 * Two grammars share one flag, with a stated precedence: the **date grammar first**, and a
 * git ref only when the value is not a date. A tag literally named `2026-03-01` therefore
 * resolves as a date, which is the plain rule and the documentable one — the alternative is
 * a flag whose meaning depends on what happens to be tagged in the repository you are
 * standing in.
 *
 * The date half is `resolveAsOf` from `@adrkit/core`, unchanged and unwrapped: `adr queue`
 * and `adr explain` must not phrase `--as-of` two ways. A timezone-less datetime is
 * therefore still rejected outright rather than falling through to git, because it is
 * unambiguously a date attempt and "did you mean a git ref?" is not the help that input
 * needs.
 *
 * The git half is the only subprocess in `@adrkit/cli`. It stays here, at the boundary, and
 * nothing in `@adrkit/core` learns about it — the same split `checkChanges` keeps from
 * marker I/O, and `graph` keeps from TTY detection.
 *
 * It uses `node:child_process`, **not** `Bun.spawn`. `@adrkit/cli` is built with
 * `--target=node` and declares `engines.node >= 22` (ADR-0010: Bun for development,
 * Node-targeted published artifacts), and `bun build` does not shim the `Bun` global — it
 * emits the reference verbatim, so a `Bun.spawn` here is a `ReferenceError` in every
 * published install. This is the only place in `packages/cli/src` or `packages/core/src`
 * that runs a subprocess, and `test/node-compatibility.test.ts` now asserts no shipped
 * source reaches for a Bun global at all.
 */

import { execFile } from 'node:child_process';
import { resolveAsOf } from '@adrkit/core';

/** Which grammar produced the date. */
export type AsOfSource = 'date' | 'ref';

export interface ResolvedAsOf {
  /** Exactly what the user typed, so the answer can name the question. */
  requested: string;
  /** The UTC calendar date the corpus is placed on. */
  date: string;
  resolvedFrom: AsOfSource;
  /** The full commit id the ref peeled to. */
  commit?: string;
  /** That commit's committer date, verbatim from git. */
  committedAt?: string;
}

export type AsOfFailure =
  | { code: 'leading-dash' }
  | { code: 'tzless' }
  | { code: 'date-invalid' }
  | { code: 'ref-unresolved' }
  | { code: 'git-unavailable'; reason: string };

export type AsOfResolution = { ok: true; value: ResolvedAsOf } | { ok: false; failure: AsOfFailure };

interface GitOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runGit(args: readonly string[], cwd: string): Promise<GitOutcome | 'missing'> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        // A ref lookup is local git state. Denying the terminal prompt keeps the subprocess
        // from reaching for a credential helper, and therefore from reaching the network,
        // for a value that came off the command line.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        encoding: 'utf8',
        windowsHide: true,
        // The outputs are a commit id and a date. A megabyte is already far past anything
        // legitimate, and bounding it keeps a pathological repository from being read into
        // memory here.
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        // Narrow on purpose. The predecessor caught *everything* and returned `missing`,
        // which turned a `ReferenceError: Bun is not defined` under Node into the message
        // "git is not installed or not on PATH" — a confident, wrong diagnosis that hid the
        // real defect. Only an absent binary means missing; anything else is either a git
        // exit code or a bug that should surface.
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (code === 'ENOENT') {
          resolve('missing');
          return;
        }
        if (error && typeof code !== 'number') {
          reject(error);
          return;
        }
        resolve({
          ok: !error,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: typeof code === 'number' ? code : 0,
        });
      },
    );
  });
}

/**
 * Peel a ref to a commit and read that commit's committer date.
 *
 * `^{commit}` is explicit because an annotated tag is a tag object, not a commit, and this
 * repository's own release tooling already turns on that distinction. `rev-parse --verify
 * --quiet` separates the two failures that must not be reported as one: exit 1 is "this
 * repository has no such commit", exit 128 is "this is not a repository at all", and a user
 * standing in the wrong directory with a perfectly good SHA deserves to be told which.
 *
 * `%cI` is the **committer** date, not the author date (`%aI`). Both are defensible; this is
 * a stated choice, not an obvious one. `--as-of <ref>` asks where a branch's timeline stood,
 * and a rebased or cherry-picked commit takes its new position from its committer date while
 * its author date still names the original keystroke (ADR-0039).
 */
async function resolveRef(ref: string, cwd: string): Promise<AsOfResolution> {
  const verified = await runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
  if (verified === 'missing') {
    return { ok: false, failure: { code: 'git-unavailable', reason: 'git is not installed or not on PATH' } };
  }
  if (!verified.ok) {
    if (/not a git repository/i.test(verified.stderr)) {
      return { ok: false, failure: { code: 'git-unavailable', reason: `${cwd} is not a git repository` } };
    }
    return { ok: false, failure: { code: 'ref-unresolved' } };
  }

  const commit = verified.stdout;
  // `--no-show-signature` is not optional. A user with `log.showSignature = true` in their
  // config and a signed commit otherwise gets `Good "git" signature for …` prepended to
  // **stdout**, ahead of the date — and this command would then report "git could not
  // resolve it to a commit" for a perfectly good HEAD. Observed, not anticipated: the same
  // class of inherited-config surprise as the `tag.gpgSign` hang that the test harness pins.
  const shown = await runGit(['show', '-s', '--no-show-signature', '--format=%cI', commit], cwd);
  if (shown === 'missing' || !shown.ok || shown.stdout.length === 0) {
    return { ok: false, failure: { code: 'ref-unresolved' } };
  }

  // The commit date goes back through the same date grammar rather than being sliced, so
  // there is one rule producing a UTC calendar date in this CLI and not two. `%cI` is
  // strict ISO-8601 with an explicit offset, which that grammar accepts.
  const committedAt = shown.stdout;
  const resolved = resolveAsOf(committedAt);
  if (!resolved.ok) return { ok: false, failure: { code: 'ref-unresolved' } };

  return {
    ok: true,
    value: { requested: ref, date: resolved.date, resolvedFrom: 'ref', commit, committedAt },
  };
}

/** Resolve one `--as-of` value: date grammar first, then a git ref in `cwd`. */
export async function resolveExplainAsOf(value: string, cwd: string): Promise<AsOfResolution> {
  // A value starting with `-` is never a date and must never reach `git` as a rev, where it
  // would be read as an option. `parseArgs` will hand over the next token whatever it is,
  // so this is the guard that keeps `adr explain f.ts --as-of --json` from being a git call.
  if (value.startsWith('-')) return { ok: false, failure: { code: 'leading-dash' } };

  const asDate = resolveAsOf(value);
  if (asDate.ok) {
    return { ok: true, value: { requested: value, date: asDate.date, resolvedFrom: 'date' } };
  }
  // A timezone-less datetime is a date attempt, not a ref. Falling through to git would
  // answer an unambiguous mistake with an unrelated diagnosis.
  if (asDate.code === 'tzless') return { ok: false, failure: { code: 'tzless' } };

  const asRef = await resolveRef(value, cwd);
  if (asRef.ok) return asRef;

  // `2026-02-30` is a broken date, not a plausible ref. Git was still asked — a tag may
  // carry that name — but when git does not produce one, the message should name the
  // mistake the user actually made. That holds whether git said "no such commit" or was
  // not available at all: "this is not a git repository" is a true statement and useless
  // advice to someone who mistyped a February date.
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return { ok: false, failure: { code: 'date-invalid' } };
  return asRef;
}

/** The exit-2 message for each failure. */
export function asOfFailureMessage(value: string, failure: AsOfFailure, cwd: string): string {
  switch (failure.code) {
    case 'leading-dash':
      return `Missing value for option "--as-of". It was followed by "${value}", which looks like another option.`;
    case 'tzless':
      // Word-for-word the message `adr queue` gives the same input.
      return `Invalid --as-of value "${value}". Timezone-less datetimes are ambiguous — use YYYY-MM-DD or add an explicit timezone offset (e.g. Z or +05:00).`;
    case 'date-invalid':
      return `Invalid --as-of value "${value}". Expected YYYY-MM-DD, an ISO datetime with an explicit timezone (e.g. 2026-01-08T00:00:00Z), or a git ref that resolves to a commit.`;
    case 'ref-unresolved':
      return `Invalid --as-of value "${value}". It is not a YYYY-MM-DD date or an ISO datetime with an explicit timezone, and git could not resolve it to a commit in ${cwd}.`;
    case 'git-unavailable':
      return `Could not resolve --as-of value "${value}". It is not a YYYY-MM-DD date or an ISO datetime with an explicit timezone, and it could not be resolved as a git ref: ${failure.reason}.`;
  }
}
