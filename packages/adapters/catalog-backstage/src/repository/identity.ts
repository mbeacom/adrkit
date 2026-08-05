/**
 * T041 · T042 — repository identity and revision, read through separate git
 * tooling and compared by **exact string equality**.
 *
 * `input-manifest.md` §3 fixes two things that are easy to get subtly wrong:
 *
 * 1. **Where the observed values come from.** `git remote get-url origin` and
 *    `git rev-parse HEAD`, invoked as subprocesses against the checkout — *never*
 *    from a descriptor annotation, including `github.com/project-slug`, and never
 *    by re-reading the manifest under test. A check that reads its "observed" value
 *    from the same document it is checking is not a check.
 * 2. **How they are compared.** Exact string equality on both values. A partial
 *    match — revision agrees, identity does not, or the reverse — is
 *    `repository-mismatch`, not a partial success. A prefix match on a revision
 *    (an abbreviated SHA against a full one) is a mismatch.
 *
 * **The fixture constraint is part of the contract, not a testing detail.**
 * `input-manifest.md` §3.1 requires the mismatch fixture be a standalone scratch
 * `git init` repository, never a `git worktree add` linked worktree, because a
 * linked worktree shares its remote configuration with the repository it was
 * created from and would report this repository's own `origin` no matter what the
 * test intended. The checkout this package is developed in *is* such a worktree, so
 * a test that skipped the constraint would pass for the wrong reason.
 *
 * **Bounded warrant.** This confirms the manifest agrees with the checkout's own
 * **locally-configured** git state (`data-model.md` §2). It is not a
 * network-verified provenance check and no artifact may describe it as one.
 *
 * @see `specs/009-catalog-binding-viability/contracts/input-manifest.md` §3, §3.1
 * @see `specs/009-catalog-binding-viability/research.md` R6
 * @see `specs/010-catalog-backstage/data-model.md` §2
 */

import { type Validated, accepted, rejected } from '../diagnostics.ts';

/**
 * The sentinel `data-model.md` §2 assigns to a remote URL matching no recognized
 * form. It is a value, not an error: an unrecognized remote is compared like any
 * other observed identity and mismatches, rather than short-circuiting somewhere
 * else with a different reason.
 */
export const INVALID_REPOSITORY_ID = 'invalid';

/** `data-model.md` §2. */
export interface RepositoryIdentityCheck {
  readonly manifestRepositoryId: string;
  readonly manifestRevision: string;
  /** Verbatim, from `git remote get-url origin`. */
  readonly observedRemoteRaw: string;
  /** After {@link normalizeRepositoryId}; may be {@link INVALID_REPOSITORY_ID}. */
  readonly observedRepositoryId: string;
  /** Verbatim, from `git rev-parse HEAD`. */
  readonly observedHead: string;
  readonly outcome: 'match' | 'repository-mismatch';
}

/** The one fine-grained reason this module emits. */
export type RepositoryIdentityReason = 'repository-mismatch';

/**
 * `research.md` R6's normalization algorithm, applied identically to the
 * manifest's declared `repository.id` and to the value read from the checkout, so
 * the two are compared on equal footing.
 *
 * The steps are numbered as R6 numbers them. Step 6 runs *after* steps 2–5, so
 * `.../repo.git/` has its trailing slash stripped first and then its `.git`
 * suffix — never the reverse, which would leave a dangling `/`.
 *
 * Returns {@link INVALID_REPOSITORY_ID} for any input matching none of steps 3–5,
 * or failing step 7's exactly-two-segments check. That is a fail-closed outcome,
 * never a best-effort guess.
 */
export function normalizeRepositoryId(raw: string): string {
  // 1. Strip trailing whitespace.
  let value = raw.replace(/\s+$/u, '');

  // 2. Strip one or more trailing `/`.
  value = value.replace(/\/+$/u, '');

  // 3-5. Rewrite each recognized form to bare `github.com/<rest>`.
  const scp = /^git@github\.com:(.+)$/u.exec(value);
  const url = /^(?:https?|ssh):\/\/(?:git@)?github\.com\/(.+)$/u.exec(value);
  const bare = /^github\.com\/(.+)$/u.exec(value);
  const rest = scp?.[1] ?? url?.[1] ?? bare?.[1];
  if (rest === undefined) return INVALID_REPOSITORY_ID;

  // 6. Strip an exact trailing `.git`.
  const withoutGitSuffix = rest.endsWith('.git') ? rest.slice(0, -'.git'.length) : rest;

  // 7. Exactly two non-empty segments, each in GitHub's permitted character set.
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(withoutGitSuffix)) {
    return INVALID_REPOSITORY_ID;
  }

  // 8. Plain ASCII case fold.
  return `github.com/${withoutGitSuffix}`.toLowerCase();
}

/** The two values read from a checkout, and the raw remote they came from. */
export interface ObservedRepositoryState {
  readonly remoteRaw: string;
  readonly head: string;
}

/**
 * Read `git remote get-url origin` and `git rev-parse HEAD` from `checkoutRoot`.
 *
 * This is the only function in Phase D that runs a subprocess, and it is separated
 * from {@link compareRepositoryIdentity} precisely so the comparison stays pure and
 * independently testable. `input-manifest.md` §5's input boundary permits exactly
 * these two subprocess reads and no others.
 *
 * Throws if either command fails. A checkout that is not a git repository, or has
 * no `origin`, is not a mismatch — it is an absent precondition, and reporting it
 * as `repository-mismatch` would claim an observation that was never made.
 */
export async function readObservedRepositoryState(
  checkoutRoot: string,
): Promise<ObservedRepositoryState> {
  const remote = await runGit(['remote', 'get-url', 'origin'], checkoutRoot);
  const head = await runGit(['rev-parse', 'HEAD'], checkoutRoot);
  return { remoteRaw: remote, head };
}

async function runGit(args: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    // `input-manifest.md` §5 and FR-018's offline constraint: the two identity
    // reads are local git state, so the subprocess is denied any terminal prompt
    // that could reach for a credential helper and therefore the network.
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd} (exit ${exitCode}): ${stderr.trim()}`);
  }
  return stdout.trim();
}

/**
 * Compare the manifest's declared identity and revision against observed state.
 *
 * Pure. Both comparisons are `===` on strings; there is deliberately no prefix,
 * case-insensitive, or normalized comparison anywhere in this function, because
 * FR-010 requires exactly that absence.
 *
 * The manifest's declared id is normalized through the *same* R6 algorithm as the
 * observed remote before comparison, per `input-manifest.md` §3's "applied
 * identically to (a) the manifest's declared `repository.id` ... and (b) the value
 * read from the checkout's actual `origin` ... so the two are compared on equal
 * footing".
 */
export function compareRepositoryIdentity(
  manifest: { readonly id: string; readonly revision: string },
  observed: ObservedRepositoryState,
): Validated<RepositoryIdentityCheck, RepositoryIdentityReason> {
  const observedRepositoryId = normalizeRepositoryId(observed.remoteRaw);
  const manifestRepositoryId = normalizeRepositoryId(manifest.id);

  const idMatches = manifestRepositoryId === observedRepositoryId;
  const revisionMatches = manifest.revision === observed.head;

  const check: RepositoryIdentityCheck = {
    manifestRepositoryId,
    manifestRevision: manifest.revision,
    observedRemoteRaw: observed.remoteRaw,
    observedRepositoryId,
    observedHead: observed.head,
    outcome: idMatches && revisionMatches ? 'match' : 'repository-mismatch',
  };

  if (check.outcome === 'match') return accepted(check);

  // The detail names *which* half disagreed, because "partial match still aborts"
  // is only demonstrable if the record can distinguish a partial from a total one.
  const disagreements: string[] = [];
  if (!idMatches) {
    disagreements.push(
      `repository id: manifest ${JSON.stringify(manifestRepositoryId)} !== observed ${JSON.stringify(observedRepositoryId)}`,
    );
  }
  if (!revisionMatches) {
    disagreements.push(
      `revision: manifest ${JSON.stringify(manifest.revision)} !== observed ${JSON.stringify(observed.head)}`,
    );
  }
  return rejected('repository-mismatch', 'repository-mismatch', disagreements.join('; '));
}
