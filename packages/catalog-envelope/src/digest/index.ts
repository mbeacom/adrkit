/**
 * Independent recomputation of the envelope's self-digest
 * (`snapshot-envelope.md` §3; `data-model.md` §12; `spec.md` FR-040, FR-041).
 *
 * ## What this check proves, stated before anything else
 *
 * **Accidental-corruption and naive-mutation detection only.** It does not
 * resist an adversary who mutates content and also recomputes the same digest
 * with the same algorithm. A cryptographically-signed tamper-evidence
 * mechanism — with its own key-management, trust-anchor, and
 * deterministic-output questions — is an explicitly **open question** that
 * neither this package nor feature `010-catalog-backstage` attempts.
 *
 * **And a second scope statement, from ADR-0020 clause 5.** A populated,
 * digest-verified envelope proves **integrity, not correctness**: a
 * semantically wrong envelope can carry a perfectly valid self-digest. A
 * `match` here means the bytes are the bytes the generator wrote. It does not
 * mean the ownership those bytes record is the ownership that should have been
 * recorded, and no output of this module may be read as having established
 * that.
 *
 * Both statements travel with every mention of this check, in code, in tests,
 * and in evidence. That is a requirement of FR-041, not editorial caution.
 *
 * ## Why the primitive is imported rather than written here
 *
 * `canonicalStringify` comes from `@adrkit/core`
 * (`packages/core/src/fingerprint/index.ts`, re-exported from
 * `packages/core/src/index.ts`), per `data-model.md` §12's implementation
 * instruction. Writing a second canonicalizer would create a second definition
 * of "canonical" that could drift silently from the generator's — which is
 * precisely the failure this digest exists to detect.
 *
 * Note that this is *not* the same-named function at
 * `packages/evaluator/src/report/serialize.ts`, which has a different signature
 * and is explicitly excluded by `package-boundary.md` §2.1.
 *
 * For the envelope's closed scalar domain — strings, booleans, null, and
 * bounded non-negative integers — these bytes are *equivalent to* RFC 8785/JCS
 * output. That equivalence is scoped to the domain; no claim is made that
 * `canonicalStringify` is a general-purpose RFC 8785 implementation
 * (`package-boundary.md` §2.2).
 */

import { createHash } from 'node:crypto';
import { canonicalStringify } from '@adrkit/core';
import type { SnapshotEnvelope } from '../envelope-shape.ts';
import { envelopeOf, type StructurallyValidEnvelope } from '../validate/index.ts';

/** `data-model.md` §12. */
export interface DigestCheckResult {
  readonly declaredDigest: string;
  readonly recomputedDigest: string;
  readonly outcome: 'match' | 'digest-mismatch';
  /**
   * The exact scope of what a `match` establishes, carried on the result itself
   * so that a caller serializing this into evidence cannot drop it (FR-041).
   */
  readonly guaranteeScope: typeof DIGEST_GUARANTEE_SCOPE;
}

export const DIGEST_GUARANTEE_SCOPE =
  'Detects accidental corruption and naive mutation only. Does not resist an adversary who mutates content and recomputes the same digest. A digest match proves integrity, not correctness: a semantically wrong envelope can carry a valid self-digest.' as const;

/**
 * The canonical form the digest is taken over: every field of the envelope
 * **including `schemaVersion`**, **excluding only `digest` itself**, with keys
 * recursively sorted by `compareCodeUnits`, arrays left in declaration order,
 * compact separators, and `undefined` fields omitted.
 */
export function canonicalFormOf(envelope: SnapshotEnvelope): string {
  const { digest: _excluded, ...rest } = envelope;
  return canonicalStringify(rest);
}

/** SHA-256 over the UTF-8 bytes of the canonical form; 64 lowercase hex. */
export function recomputeEnvelopeDigest(envelope: SnapshotEnvelope): string {
  return createHash('sha256').update(canonicalFormOf(envelope), 'utf8').digest('hex');
}

/**
 * Recompute and compare.
 *
 * The parameter type is `StructurallyValidEnvelope`, not `SnapshotEnvelope`, and
 * that is the point: `snapshot-envelope.md` §2 forbids attempting *any* digest
 * check before all five validation steps pass, and the only way to obtain this
 * token is to have passed them. The ordering is enforced by the signature
 * rather than by a comment asking the caller to be careful.
 *
 * The declared digest is **never** trusted unconditionally — it is recomputed
 * here from the envelope's own remaining fields and compared.
 */
export function checkEnvelopeDigest(validated: StructurallyValidEnvelope): DigestCheckResult {
  const envelope = envelopeOf(validated);
  const recomputedDigest = recomputeEnvelopeDigest(envelope);
  return {
    declaredDigest: envelope.digest,
    recomputedDigest,
    outcome: recomputedDigest === envelope.digest ? 'match' : 'digest-mismatch',
    guaranteeScope: DIGEST_GUARANTEE_SCOPE,
  };
}
