/**
 * T081 — the envelope digest: SHA-256 over the canonical form of every field except
 * `digest` itself, rendered as 64 lowercase hexadecimal characters.
 *
 * # Which `canonicalStringify`
 *
 * `@adrkit/core`'s — defined at `packages/core/src/fingerprint/index.ts:16`, exported
 * at `packages/core/src/index.ts:24`, ordering via `compareCodeUnits` at
 * `packages/core/src/ordering/index.ts:12`.
 *
 * **Never** the same-named function at `packages/evaluator/src/report/serialize.ts:38`.
 * `package-boundary.md` §2.1: "It is a different function with a different signature
 * (`(root, pretty = false)`). Importing it would also cross a package boundary the
 * allowlist in §2 does not permit." The adapter's allowlist is `@adrkit/core`,
 * `picomatch`, `yaml` — `@adrkit/evaluator` is not on it, so the mistake is caught by
 * `check:deps` as well as by this note.
 *
 * # The scope qualification travels with every digest claim
 *
 * `package-boundary.md` §2.2 and `snapshot-envelope.md` §3, restated here rather than
 * cited, because a reader who finds this function is the reader who needs it:
 *
 * - For the envelope's **closed scalar domain** — strings, booleans, and bounded
 *   non-negative integers — `canonicalStringify`'s bytes are *equivalent to* RFC 8785 /
 *   JCS output. **No claim is made that `canonicalStringify` is a general-purpose
 *   RFC 8785 implementation for arbitrary JSON values**, and no document under this
 *   feature may make one.
 * - The digest proves **accidental-corruption and naive-mutation detection only**
 *   (FR-041). It does **not** resist an adversary who mutates content and recomputes
 *   the digest with the same algorithm. Adversarial tamper-resistance is an explicitly
 *   open question this feature does not attempt.
 * - Integrity is not correctness. A digest-verified envelope is evidence that the bytes
 *   are the bytes that were written. It is **not** evidence that the derived ownership
 *   in it is right — that is SC-011's question, and SC-012 forbids conflating them.
 *
 * # `digest` is excluded by construction, not by convention
 *
 * {@link computeEnvelopeDigest} takes an {@link UnsignedEnvelope} — the envelope type
 * with `digest` omitted — so a caller cannot hand it a signed envelope by accident. A
 * `delete` on a copy, or a `{ ...envelope, digest: undefined }`, would both compile and
 * both be one edit away from hashing a field that is meant to be the hash.
 *
 * @see `specs/009-catalog-binding-viability/contracts/snapshot-envelope.md` §3
 * @see `specs/010-catalog-backstage/contracts/package-boundary.md` §2.1, §2.2
 * @see `specs/010-catalog-backstage/spec.md` FR-040, FR-041
 */

import { createHash } from 'node:crypto';
import { canonicalStringify } from '@adrkit/core';
import type { SnapshotEnvelope } from './shape.ts';

/** An envelope before its digest exists. The one input the digest is computed over. */
export type UnsignedEnvelope = Omit<SnapshotEnvelope, 'digest'>;

/** 64 lowercase hexadecimal characters. */
export const ENVELOPE_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

/** The algorithm name recorded on each `sources[]` entry, and used here. */
export const DIGEST_ALGORITHM = 'sha256';

/**
 * The canonical form the digest is computed over.
 *
 * Exposed separately from {@link computeEnvelopeDigest} for two reasons that both
 * matter. It lets a check assert the *serialization* — recursive key sort at every
 * nesting level, arrays left in declaration order, compact separators — rather than
 * only the 64 hex characters that come out the far end, where every bug looks the same.
 * And it lets an independent recomputation compare canonical strings, which says
 * *where* two envelopes differ; comparing digests only says *that* they differ.
 */
export function canonicalEnvelopeForm(envelope: UnsignedEnvelope): string {
  return canonicalStringify(envelope);
}

/**
 * SHA-256 over the UTF-8 bytes of the canonical form, as 64 lowercase hex characters.
 *
 * `createHash('sha256').digest('hex')` already yields lowercase hex; the assertion
 * below is not a formality but the guard against a future change to that default going
 * unnoticed. `snapshot-envelope.md` §3 fixes the rendering as part of the contract, and
 * a consumer comparing digests as strings would silently fail on uppercase.
 */
export function computeEnvelopeDigest(envelope: UnsignedEnvelope): string {
  const digest = createHash(DIGEST_ALGORITHM)
    .update(canonicalEnvelopeForm(envelope), 'utf8')
    .digest('hex');

  if (!ENVELOPE_DIGEST_PATTERN.test(digest)) {
    throw new Error(
      `computed digest ${JSON.stringify(digest)} is not 64 lowercase hex characters, which ` +
        'snapshot-envelope.md \u00a73 requires. Refusing to emit an envelope whose digest a ' +
        'conforming consumer would not recognize.',
    );
  }

  return digest;
}

/** The outcome of recomputing a signed envelope's digest. `data-model.md` §12. */
export interface DigestCheckResult {
  readonly declaredDigest: string;
  readonly recomputedDigest: string;
  readonly outcome: 'match' | 'digest-mismatch';
}

/**
 * Recompute a signed envelope's digest and compare it with the declared value.
 *
 * The `digest` field is stripped by destructuring rather than by `delete`, so the
 * envelope handed in is never mutated — a recomputation that modified its input would
 * make the second call disagree with the first.
 *
 * **This is not the independent recomputation SC-013 requires.** SC-013 asks that "the
 * recorded digest matches an **independent** recomputation, not the generator's own",
 * and this function is the generator's own: it shares `canonicalStringify` with the
 * code that produced the digest, so it cannot detect a fault in that shared step. It is
 * useful for detecting corruption *after* generation, which is a different question.
 * `test/sc-013.test.ts` performs the independent recomputation, and
 * `packages/catalog-envelope/` carries the consumer-side one.
 */
export function verifyEnvelopeDigest(envelope: SnapshotEnvelope): DigestCheckResult {
  const { digest: declaredDigest, ...unsigned } = envelope;
  const recomputedDigest = computeEnvelopeDigest(unsigned);
  return {
    declaredDigest,
    recomputedDigest,
    outcome: declaredDigest === recomputedDigest ? 'match' : 'digest-mismatch',
  };
}
