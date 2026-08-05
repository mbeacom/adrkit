/**
 * Staleness — **exact inequality of revision**, never a chronological or
 * ordering comparison (`snapshot-envelope.md` §4; `data-model.md` §13;
 * `spec.md` FR-047).
 *
 * ## Why there is no comparison operator anywhere in this file
 *
 * A commit SHA is an opaque identifier. It carries no ordering, and recovering
 * one would require git-ancestry data that is explicitly out of scope for this
 * feature. So "stale" here means exactly one thing: *the revision this envelope
 * declares is not the revision the consumer was configured to expect.* It never
 * means "older than", "behind", or "superseded by".
 *
 * The distinction matters because the wrong implementation is easy to write and
 * looks right: a lexicographic `<` on two hex strings produces an ordering, that
 * ordering is meaningless, and nothing in the output would say so. There is no
 * `<`, `>`, `sort`, or date arithmetic in this module, and there must not be.
 *
 * ## Configuration is optional; the check is not a default
 *
 * A consumer *may* be configured with an expected-current revision. When it is
 * not, no staleness verdict is available and this module says so explicitly
 * rather than reporting `ok` — reporting `ok` for "not configured" would render
 * an unchecked envelope identically to a checked one (ADR-0016's central
 * failure shape).
 *
 * ## The expectation is keyed to a repository, and that is load-bearing
 *
 * `snapshot-envelope.md` §4 configures the expected-current revision **for a
 * given repository ID**, and calls an envelope stale when it declares another
 * revision *for that same repository ID*. A revision belonging to repository A
 * therefore says nothing about an envelope describing repository B, and
 * comparing them would be meaningless.
 *
 * This matters because `spec.md` FR-046 fixes the order — digest, then
 * staleness, then repository identity — so staleness is evaluated **before** the
 * identity mismatch has been named. Without the repository scoping, an envelope
 * from a foreign repository would be refused as *stale* rather than as
 * *misidentified*: the right verdict category for the wrong reason, and exactly
 * the §5/§6 conflation the contract warns against. When the envelope is about a
 * different repository, this module returns `not-applicable-different-repository`
 * and leaves the verdict to the identity check that follows it.
 */

import type { SnapshotEnvelope } from '../envelope-shape.ts';
import { envelopeOf, type StructurallyValidEnvelope } from '../validate/index.ts';

export interface StalenessCheckResult {
  readonly expectedRevision: string | undefined;
  readonly declaredRevision: string;
  /**
   * `not-configured` and `not-applicable-different-repository` are both distinct
   * from `ok`. The first means no expectation was supplied; the second means the
   * expectation belongs to a different repository and so nothing comparable was
   * available. Only `ok` means an expectation was supplied, was about this
   * repository, and matched exactly.
   */
  readonly outcome: 'ok' | 'stale-revision' | 'not-configured' | 'not-applicable-different-repository';
  readonly detail: string;
  /**
   * Recorded on the result so evidence generated from it cannot silently imply
   * an ordering judgement was made.
   */
  readonly comparison: typeof STALENESS_COMPARISON;
}

export const STALENESS_COMPARISON =
  'exact string inequality of repository.revision, scoped to the repository the expectation was configured for; never a chronological, ancestry, or ordering comparison' as const;

/**
 * Compare an envelope's declared revision against a configured expectation.
 *
 * Takes a `StructurallyValidEnvelope` because `snapshot-envelope.md` §2 forbids
 * any revision check before all five validation steps pass.
 *
 * @param expectedRevision the expected-current revision, if configured
 * @param expectedRepositoryId the repository that expectation is *about*. When
 *   supplied and the envelope declares a different repository, no staleness
 *   verdict is available — see the note on repository scoping above.
 */
export function checkStaleness(
  validated: StructurallyValidEnvelope,
  expectedRevision?: string,
  expectedRepositoryId?: string,
): StalenessCheckResult {
  const envelope: SnapshotEnvelope = envelopeOf(validated);
  const declaredRevision = envelope.repository.revision;

  if (expectedRevision === undefined) {
    return {
      expectedRevision: undefined,
      declaredRevision,
      outcome: 'not-configured',
      detail: `no expected-current revision was configured, so revision ${declaredRevision} was not compared against anything`,
      comparison: STALENESS_COMPARISON,
    };
  }

  if (expectedRepositoryId !== undefined && envelope.repository.id !== expectedRepositoryId) {
    return {
      expectedRevision,
      declaredRevision,
      outcome: 'not-applicable-different-repository',
      detail: `the expected-current revision ${expectedRevision} is configured for repository ${expectedRepositoryId}, but this envelope declares repository ${envelope.repository.id}, so no staleness verdict is available`,
      comparison: STALENESS_COMPARISON,
    };
  }

  if (declaredRevision !== expectedRevision) {
    return {
      expectedRevision,
      declaredRevision,
      outcome: 'stale-revision',
      detail: `envelope declares revision ${declaredRevision}, which is not exactly equal to the configured expected-current revision ${expectedRevision}`,
      comparison: STALENESS_COMPARISON,
    };
  }

  return {
    expectedRevision,
    declaredRevision,
    outcome: 'ok',
    detail: `envelope revision ${declaredRevision} is exactly equal to the configured expected-current revision`,
    comparison: STALENESS_COMPARISON,
  };
}
