/**
 * @adrkit/ci — the decision-portal Action's logic
 * ([ADR-0054](../../../docs/adr/0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md)
 * clauses 2, 9, 10).
 *
 * Everything here takes its collaborators as arguments: the inputs, the event payload's
 * `repository`, the generator, and the four `@actions/core` calls it makes. The entrypoint
 * (`portal-action-entrypoint.ts`) is the only file that imports `@actions/*`, as
 * `queue-action-entrypoint.ts` is for the queue Action, so this module is tested with stubs.
 *
 * The Action builds the bundle into `out` and nothing else. It holds no token and makes no
 * GitHub API call; uploading and deploying are the consumer workflow's separate steps.
 *
 * - **Clause 10, a private repository fails closed.** The bundle carries every record body
 *   and the governed file paths, so the Action publishes only when the event payload
 *   affirmatively says the repository is public, or when `publish-private` is exactly
 *   `true`. A payload marking it private (`private: true`) or `visibility` `private` or
 *   `internal` is refused; so is a payload with no `repository` object, or one that states
 *   neither field. That last case is the conservative choice: the Action cannot tell a
 *   public repository from a private one, and guessing public would publish private text.
 *   A refusal never calls the generator, so nothing is written.
 * - **Clause 9, exit codes.** `0` succeeds; `1` succeeds (the complete bundle was written
 *   with the corpus errors shown in its banner) with a warning annotation; `2` or above
 *   fails with the generator's own fixed message, and the generator wrote nothing. The
 *   `exit-code` output is set whenever the generator ran: its exit code, or `2` when it
 *   threw. A clause-10 refusal sets none, because the generator never ran.
 * - **Nothing unbounded reaches an annotation.** A throw from the generator (a bug, not a
 *   result) fails with a fixed message: no `error.message`, no stack. The generator's exit-2
 *   messages are its own fixed strings.
 */

import type { GeneratePortalOptions, GeneratePortalResult } from '@adrkit/portal/src/generate.ts';

/** The Action's inputs, as `core.getInput` returns them (an absent input is `''`). */
export interface PortalActionInputs {
  readonly dir: string;
  readonly out: string;
  readonly baseUrl: string;
  readonly asOf: string;
  readonly publishPrivate: string;
}

/** The four `@actions/core` calls this Action makes. */
export interface PortalActionCore {
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}

export interface PortalActionDependencies {
  readonly inputs: PortalActionInputs;
  /** `github.context.payload.repository`, unvalidated: whatever the event payload carried. */
  readonly repository: unknown;
  /** Absolute workspace directory (`GITHUB_WORKSPACE`). */
  readonly workspace: string;
  readonly generate: (options: GeneratePortalOptions) => Promise<GeneratePortalResult>;
  readonly core: PortalActionCore;
}

/** What the run did, for tests; the Action's observable effects are the `core` calls. */
export type PortalActionOutcome =
  | { readonly kind: 'refused'; readonly reason: RepositoryVisibility }
  | { readonly kind: 'generated'; readonly exitCode: number }
  | { readonly kind: 'crashed' };

export type RepositoryVisibility = 'public' | 'private' | 'internal' | 'unknown';

export const PRIVATE_REPOSITORY_MESSAGE =
  'adrkit portal: this repository is private, and the portal bundle carries every record body and the governed file paths. ' +
  'Nothing was written. Check who can read the GitHub Pages site, then set `publish-private: true` to publish it anyway.';

export const INTERNAL_REPOSITORY_MESSAGE =
  'adrkit portal: this repository is internal, and the portal bundle carries every record body and the governed file paths. ' +
  'Nothing was written. Check who can read the GitHub Pages site, then set `publish-private: true` to publish it anyway.';

export const UNKNOWN_VISIBILITY_MESSAGE =
  "adrkit portal: the event payload does not say whether this repository is public, so the Action treats it as private. " +
  'Nothing was written. Check who can read the GitHub Pages site, then set `publish-private: true` to publish it anyway.';

export const CRASH_MESSAGE =
  'adrkit portal: the portal generator stopped unexpectedly; nothing is known to have been written. Re-run the job, and report it if it repeats.';

export function corpusErrorWarning(count: number): string {
  return (
    `adrkit portal: the corpus has ${count} error finding(s). The complete bundle was written, with every error shown in a banner ` +
    'on every page and governance by path withheld. Run `adr lint` to see and fix them.'
  );
}

/**
 * The repository's visibility according to the event payload. `public` only when the
 * payload says so: `private: false` with a `visibility` that is absent or `public`.
 */
export function repositoryVisibility(repository: unknown): RepositoryVisibility {
  if (repository === null || typeof repository !== 'object') return 'unknown';
  const { private: isPrivate, visibility } = repository as { private?: unknown; visibility?: unknown };
  if (visibility === 'internal') return 'internal';
  if (isPrivate === true || visibility === 'private') return 'private';
  if (isPrivate === false && (visibility === undefined || visibility === 'public')) return 'public';
  if (isPrivate === undefined && visibility === 'public') return 'public';
  return 'unknown';
}

const REFUSALS: Record<Exclude<RepositoryVisibility, 'public'>, string> = {
  private: PRIVATE_REPOSITORY_MESSAGE,
  internal: INTERNAL_REPOSITORY_MESSAGE,
  unknown: UNKNOWN_VISIBILITY_MESSAGE,
};

/** An optional input: `''` (absent) is `undefined`, because the generator treats `''` as a value. */
function optional(value: string): string | undefined {
  return value === '' ? undefined : value;
}

export async function runPortalAction(deps: PortalActionDependencies): Promise<PortalActionOutcome> {
  const { inputs, core } = deps;

  // Clause 10 first: a refused run never reaches the generator, so nothing is written.
  const visibility = repositoryVisibility(deps.repository);
  if (visibility !== 'public' && inputs.publishPrivate !== 'true') {
    core.setFailed(REFUSALS[visibility]);
    return { kind: 'refused', reason: visibility };
  }

  let result: GeneratePortalResult;
  try {
    result = await deps.generate({
      cwd: deps.workspace,
      dir: optional(inputs.dir) ?? 'docs/adr',
      out: optional(inputs.out) ?? '_site',
      asOf: optional(inputs.asOf),
      baseUrl: optional(inputs.baseUrl),
    });
  } catch {
    // Deliberately not the error's text: a stack or a path is not an annotation.
    core.setOutput('exit-code', '2');
    core.setFailed(CRASH_MESSAGE);
    return { kind: 'crashed' };
  }

  core.setOutput('exit-code', String(result.exitCode));
  if (result.exitCode === 0) {
    core.info(`adrkit portal: wrote the decision portal to ${inputs.out || '_site'}.`);
  } else if (result.exitCode === 1) {
    core.warning(corpusErrorWarning(result.errors.length));
  } else {
    core.setFailed(`adrkit portal: ${result.message ?? 'the portal could not be built; nothing was written.'}`);
  }
  return { kind: 'generated', exitCode: result.exitCode };
}
