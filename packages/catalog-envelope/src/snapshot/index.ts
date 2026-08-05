/**
 * `CatalogSnapshot`-shaped derivation, reachable **only** after every check has
 * passed (`spec.md` FR-049; `data-model.md` §15; ADR-0020 clause 7).
 *
 * ## The gate
 *
 * Derivation requires an `AdmittedEnvelope`, and the only way to obtain one is
 * {@link admitEnvelope}, which runs — in this order, stopping at the first
 * failure:
 *
 * 1. the five ordered validation steps (`snapshot-envelope.md` §2),
 * 2. independent digest recomputation (§3),
 * 3. staleness as exact revision inequality (§4),
 * 4. repository identity (§5).
 *
 * The token is branded with a module-private symbol, so it cannot be forged by
 * assembling an object literal. {@link deriveCatalogSnapshot} accepts `unknown`
 * and **refuses** anything without that brand, at runtime, by throwing. An
 * adapter's raw output cannot be handed to core directly and unvalidated under
 * any composition arrangement, because there is no code path that accepts it.
 *
 * ## What derivation does not establish
 *
 * Admission proves the envelope is intact, intelligible, current, and about the
 * repository that asked. It proves nothing about whether the ownership recorded
 * in it is right. The derived snapshot inherits exactly that standing.
 *
 * ## The mapping is lossy by design
 *
 * `CatalogSnapshotEntity` is `{ id, refs?, paths? }` — it has **no**
 * `ownershipState` field. So `explicit-empty` (an annotation that decoded to an
 * empty array) and `annotation-absent` (no annotation at all) both map to an
 * entity with an empty `paths`, and the distinction the envelope preserves is
 * simply **not representable** in the core type.
 *
 * That distinction is therefore kept on the envelope side and is **not**
 * smuggled into `CatalogSnapshot`. Changing `CatalogSnapshot` to carry it is out
 * of scope (`spec.md` FR-004, FR-020). A caller that needs the ownership state
 * must read it from the envelope, which {@link admittedEnvelopeOf} exposes.
 */

import type { CatalogSnapshot, CatalogSnapshotEntity } from '@adrkit/core';
import type { SnapshotEnvelope } from '../envelope-shape.ts';
import { checkEnvelopeDigest, type DigestCheckResult } from '../digest/index.ts';
import {
  checkRepositoryIdentity,
  type RepositoryIdentityCheckResult,
} from '../identity/repository.ts';
import { checkStaleness, type StalenessCheckResult } from '../identity/staleness.ts';
import {
  envelopeOf,
  validateEnvelope,
  type EnvelopeValidationResult,
  type StructurallyValidEnvelope,
} from '../validate/index.ts';

const ADMITTED: unique symbol = Symbol('adrkit.catalog-envelope.admitted');

/** An envelope that has passed all five steps, the digest, staleness, and identity. */
export interface AdmittedEnvelope {
  readonly [ADMITTED]: true;
  readonly envelope: SnapshotEnvelope;
  readonly digestCheck: DigestCheckResult;
  readonly stalenessCheck: StalenessCheckResult;
  readonly identityCheck: RepositoryIdentityCheckResult;
}

export interface AdmitOptions {
  /** Directory `sources[].path` entries are resolved against for step 4. */
  readonly sourceBaseDir: string;
  /** When supplied, an envelope declaring a different repository is refused. */
  readonly expectedRepositoryId?: string;
  /**
   * When supplied, an envelope declaring any other revision **for the expected
   * repository** is refused as stale. Scoped by `expectedRepositoryId` when that
   * is also supplied, per `snapshot-envelope.md` §4 — see `identity/staleness.ts`.
   */
  readonly expectedRevision?: string;
}

/** Named stage at which admission stopped. */
export type AdmissionStage = 'validation' | 'digest' | 'staleness' | 'repository-identity';

export interface AdmissionAdmitted {
  readonly outcome: 'admitted';
  readonly admitted: AdmittedEnvelope;
  readonly validation: EnvelopeValidationResult;
  readonly refusedAt: undefined;
  readonly reason: undefined;
  readonly detail: undefined;
}

export interface AdmissionRefused {
  readonly outcome: 'refused';
  readonly admitted: undefined;
  readonly validation: EnvelopeValidationResult;
  readonly refusedAt: AdmissionStage;
  readonly reason: string;
  readonly detail: string;
}

export type AdmissionResult = AdmissionAdmitted | AdmissionRefused;

/**
 * Run the whole ordered pipeline over raw envelope text.
 *
 * Nothing is derived here — this only decides whether derivation is permitted.
 */
export function admitEnvelope(text: string, options: AdmitOptions): AdmissionResult {
  const validation = validateEnvelope(text, { sourceBaseDir: options.sourceBaseDir });
  if (validation.outcome === 'rejected') {
    return {
      outcome: 'refused',
      admitted: undefined,
      validation,
      refusedAt: 'validation',
      reason: validation.reason,
      detail: `step ${validation.failedStep}: ${validation.detail}`,
    };
  }

  const validated: StructurallyValidEnvelope = validation.validated;

  const digestCheck = checkEnvelopeDigest(validated);
  if (digestCheck.outcome === 'digest-mismatch') {
    return {
      outcome: 'refused',
      admitted: undefined,
      validation,
      refusedAt: 'digest',
      reason: 'digest-mismatch',
      detail: `envelope declares digest ${digestCheck.declaredDigest} but its canonical form hashes to ${digestCheck.recomputedDigest}`,
    };
  }

  const stalenessCheck = checkStaleness(validated, options.expectedRevision, options.expectedRepositoryId);
  if (stalenessCheck.outcome === 'stale-revision') {
    return {
      outcome: 'refused',
      admitted: undefined,
      validation,
      refusedAt: 'staleness',
      reason: 'stale-revision',
      detail: stalenessCheck.detail,
    };
  }

  const identityCheck = checkRepositoryIdentity(validated, options.expectedRepositoryId);
  if (identityCheck.outcome === 'repository-identity-mismatch') {
    return {
      outcome: 'refused',
      admitted: undefined,
      validation,
      refusedAt: 'repository-identity',
      reason: 'repository-identity-mismatch',
      detail: identityCheck.detail,
    };
  }

  return {
    outcome: 'admitted',
    admitted: {
      [ADMITTED]: true,
      envelope: envelopeOf(validated),
      digestCheck,
      stalenessCheck,
      identityCheck,
    },
    validation,
    refusedAt: undefined,
    reason: undefined,
    detail: undefined,
  };
}

/**
 * Thrown when derivation is attempted on anything that has not been admitted.
 *
 * A thrown refusal rather than a returned one, deliberately: a caller can
 * ignore a returned rejection value and carry on to read `derivedPaths` anyway,
 * and FR-046 does not permit that.
 */
export class EnvelopeDerivationRefusedError extends Error {
  readonly reason = 'derivation-refused-envelope-not-admitted' as const;

  constructor(what: string) {
    super(
      `derivation refused: ${what} has not passed the five validation steps, digest recomputation, staleness, and repository-identity checks`,
    );
    this.name = 'EnvelopeDerivationRefusedError';
  }
}

/** True only for a token {@link admitEnvelope} minted. */
export function isAdmittedEnvelope(value: unknown): value is AdmittedEnvelope {
  return (
    typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[ADMITTED] === true
  );
}

/** The envelope behind an admission token, for callers that need the lossy fields. */
export function admittedEnvelopeOf(admitted: AdmittedEnvelope): SnapshotEnvelope {
  return admitted.envelope;
}

/** `data-model.md` §15. */
export interface DerivedCatalogSnapshot {
  /** The **existing** `@adrkit/core` type, unmodified. */
  readonly snapshot: CatalogSnapshot;
  readonly derivedFrom: {
    readonly repositoryId: string;
    readonly revision: string;
    readonly envelopeDigest: string;
  };
}

/**
 * Derive a `CatalogSnapshot`-shaped artifact.
 *
 * Accepts `unknown` on purpose. The type system already prevents an unadmitted
 * value from reaching here in well-typed code; accepting `unknown` and checking
 * the brand at runtime means the refusal also holds for a caller that reached
 * this function through a cast, through JavaScript, or through a future edit
 * that widened a type somewhere upstream.
 *
 * @throws {EnvelopeDerivationRefusedError} when the value carries no admission brand.
 */
export function deriveCatalogSnapshot(admitted: unknown): DerivedCatalogSnapshot {
  if (!isAdmittedEnvelope(admitted)) {
    throw new EnvelopeDerivationRefusedError(
      admitted === null || admitted === undefined ? String(admitted) : `a ${typeof admitted} value`,
    );
  }

  const envelope = admitted.envelope;
  const entities: CatalogSnapshotEntity[] = envelope.entities.map((record) => ({
    id: record.identity.canonicalId,
    refs: [...record.identity.allRefs],
    // Always emitted, empty array included, so the output is deterministic.
    // `explicit-empty` and `annotation-absent` are indistinguishable here by
    // design — the discriminator stays on the envelope.
    paths: [...record.derivedPaths],
  }));

  return {
    snapshot: { entities },
    derivedFrom: {
      repositoryId: envelope.repository.id,
      revision: envelope.repository.revision,
      envelopeDigest: envelope.digest,
    },
  };
}
