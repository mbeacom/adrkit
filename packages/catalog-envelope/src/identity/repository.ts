/**
 * Repository identity — **two outcomes that must never be conflated**
 * (`snapshot-envelope.md` §5 and §6; `data-model.md` §13 and §14;
 * `spec.md` FR-048).
 *
 * ## The line this module draws
 *
 * | Situation | Correct behaviour |
 * |---|---|
 * | A consumer expected **exactly one** repository and is handed an envelope declaring a different one | **Reject**, naming the mismatch (§5) |
 * | A tool deliberately holds **several** independently-generated, individually-valid single-repository envelopes and queries them scoped to one | **Accept all of them**; the query returns only the scoped repository's entities (§6) |
 *
 * Conflating these turns a legitimate multi-repository index into a rejection,
 * or turns a genuine mismatch into a silent filter that returns an empty result
 * and looks like "no matches". Both failures are quiet, which is why the two
 * paths are separate exported functions with separate result types rather than
 * one function with a flag.
 *
 * **Isolation is a property of the query, not an error condition.** Neither
 * envelope is rejected in the §6 case; both remain independently valid.
 * Generation itself never produces a federated or multi-repository snapshot —
 * that remains an absolute constraint on the generator, and this module
 * describes only downstream consumer behaviour across separately-generated
 * files.
 */

import type { SnapshotEntityRecord } from '../envelope-shape.ts';
import { envelopeOf, type StructurallyValidEnvelope } from '../validate/index.ts';

// ---------------------------------------------------------------------------
// §5 — mismatch and reject, for a consumer that expected exactly one repository
// ---------------------------------------------------------------------------

export interface RepositoryIdentityCheckResult {
  readonly expectedRepositoryId: string | undefined;
  readonly declaredRepositoryId: string;
  /**
   * `not-configured` is distinct from `ok` for the same reason it is in the
   * staleness check: an unchecked envelope must not render identically to a
   * checked one.
   */
  readonly outcome: 'ok' | 'repository-identity-mismatch' | 'not-configured';
  readonly detail: string;
}

/**
 * Reject an envelope declaring a repository other than the single one this
 * consumer expects.
 *
 * Takes a `StructurallyValidEnvelope` because `snapshot-envelope.md` §2 forbids
 * any repository-identity check before all five validation steps pass.
 */
export function checkRepositoryIdentity(
  validated: StructurallyValidEnvelope,
  expectedRepositoryId?: string,
): RepositoryIdentityCheckResult {
  const declaredRepositoryId = envelopeOf(validated).repository.id;

  if (expectedRepositoryId === undefined) {
    return {
      expectedRepositoryId: undefined,
      declaredRepositoryId,
      outcome: 'not-configured',
      detail: `no expected repository id was configured, so ${declaredRepositoryId} was not compared against anything`,
    };
  }

  if (declaredRepositoryId !== expectedRepositoryId) {
    return {
      expectedRepositoryId,
      declaredRepositoryId,
      outcome: 'repository-identity-mismatch',
      detail: `envelope declares repository ${declaredRepositoryId}, which is not the repository ${expectedRepositoryId} this consumer expects`,
    };
  }

  return {
    expectedRepositoryId,
    declaredRepositoryId,
    outcome: 'ok',
    detail: `envelope declares the expected repository ${declaredRepositoryId}`,
  };
}

// ---------------------------------------------------------------------------
// §6 — filter and isolate, for a consumer deliberately holding several
// ---------------------------------------------------------------------------

/** `data-model.md` §14. Every loaded envelope here is individually valid. */
export interface RepositoryIsolationQueryResult {
  readonly scopedRepositoryId: string;
  readonly returnedEntities: readonly SnapshotEntityRecord[];
  /**
   * Every repository id present across the loaded envelopes, in load order.
   *
   * Reported so a caller can tell *"the query looked across three envelopes and
   * two of them were out of scope"* from *"the query saw nothing"*. An empty
   * result is otherwise indistinguishable from a query that never ran
   * (ADR-0016).
   */
  readonly repositoriesConsidered: readonly string[];
  /** Envelopes whose repository id was not the scoped one. **Not** rejections. */
  readonly envelopesOutOfScope: number;
}

/**
 * Query several individually-valid single-repository envelopes, scoped to one
 * repository id.
 *
 * **Nothing is rejected here.** An envelope for another repository is not an
 * error; it simply contributes no entities. That is the whole of §6.
 */
export function queryEntitiesForRepository(
  loadedEnvelopes: readonly StructurallyValidEnvelope[],
  scopedRepositoryId: string,
): RepositoryIsolationQueryResult {
  const repositoriesConsidered: string[] = [];
  const returnedEntities: SnapshotEntityRecord[] = [];
  let envelopesOutOfScope = 0;

  for (const validated of loadedEnvelopes) {
    const envelope = envelopeOf(validated);
    repositoriesConsidered.push(envelope.repository.id);
    if (envelope.repository.id !== scopedRepositoryId) {
      envelopesOutOfScope += 1;
      continue;
    }
    returnedEntities.push(...envelope.entities);
  }

  return {
    scopedRepositoryId,
    returnedEntities,
    repositoriesConsidered,
    envelopesOutOfScope,
  };
}
