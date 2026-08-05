/**
 * T043 — per-source digest verification, run **before any entity is processed**.
 *
 * `input-manifest.md` §4: every `sources[]` entry's `digest` is the expected
 * SHA-256 of that file's raw bytes, computed at manifest-authoring time. At
 * generation time each listed file is read, its actual digest **independently
 * recomputed**, and compared. A mismatch, or a manifest-listed path absent from
 * disk, is an `incomplete-required-source` rejection — a property of the
 * manifest/generation request that aborts before any entity's paths are derived,
 * **never a per-entity skip**.
 *
 * FR-011 adds a third condition to §4's two: a **wrongly typed** digest. A digest
 * that is not 64 lowercase hex characters cannot be the SHA-256 of anything, so
 * comparing bytes against it would be theatre — it is rejected as its own reason
 * before any file is opened.
 *
 * **Why "before any entity is processed" is a structural claim here.**
 * {@link verifySourceDigests} verifies *every* source and returns on the first
 * failure, and it returns digests rather than content. It has no way to hand a
 * caller one verified file while another is still unchecked, because it never
 * yields anything until the whole set has passed. That is what makes the ordering
 * a property of the shape rather than of the caller's discipline.
 *
 * @see `specs/009-catalog-binding-viability/contracts/input-manifest.md` §4
 * @see `specs/010-catalog-backstage/spec.md` FR-011
 */

import { type Validated, accepted, rejected } from '../diagnostics.ts';
import type { ManifestSource } from './schema.ts';

/** 64 lowercase hex characters — the only well-formed `sha256` digest. */
export const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** Fine-grained reasons. All map to `incomplete-required-source`. */
export type SourceDigestReason =
  | 'digest-malformed'
  | 'source-missing'
  | 'source-unreadable'
  | 'digest-mismatch';

/** One verified source: its manifest path and the digest observed on disk. */
export interface VerifiedSource {
  readonly path: string;
  readonly observedDigest: string;
}

/** Compute the lowercase hex SHA-256 of raw bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex');
}

/**
 * Reject a digest that is not 64 lowercase hex characters.
 *
 * Pure, and exported separately so the malformed-digest case can be observed
 * failing without touching the filesystem at all.
 */
export function checkDigestShape(
  source: ManifestSource,
): Validated<ManifestSource, SourceDigestReason> {
  if (!SHA256_HEX.test(source.digest)) {
    return rejected(
      'digest-malformed',
      'incomplete-required-source',
      `${source.path}: digest must be 64 lowercase hex characters; observed ${JSON.stringify(source.digest)}`,
    );
  }
  return accepted(source);
}

/**
 * Compare one already-read file's bytes against its declared digest.
 *
 * Pure. Split out from {@link verifySourceDigests} so the mismatch case is
 * observable without staging a file on disk.
 */
export function verifySourceBytes(
  source: ManifestSource,
  bytes: Uint8Array,
): Validated<VerifiedSource, SourceDigestReason> {
  const shape = checkDigestShape(source);
  if (!shape.ok) return shape;

  const observedDigest = sha256Hex(bytes);
  if (observedDigest !== source.digest) {
    return rejected(
      'digest-mismatch',
      'incomplete-required-source',
      `${source.path}: declared ${source.digest}, observed ${observedDigest}`,
    );
  }
  return accepted({ path: source.path, observedDigest });
}

/**
 * Verify every declared source digest against bytes on disk.
 *
 * `resolveSourcePath` maps a manifest-relative source path to an absolute path.
 * It is a parameter rather than a hard-coded join because `manifest/paths.ts`
 * (T044) owns path resolution and must have already accepted the path: this
 * function verifies digests and does not decide what a path is allowed to be.
 *
 * Returns on the first failure. Sources are processed in manifest order, so the
 * reported failure for a manifest with two bad sources is deterministic.
 */
export async function verifySourceDigests(
  sources: readonly ManifestSource[],
  resolveSourcePath: (path: string) => string,
): Promise<Validated<readonly VerifiedSource[], SourceDigestReason>> {
  const verified: VerifiedSource[] = [];

  for (const source of sources) {
    const shape = checkDigestShape(source);
    if (!shape.ok) return shape;

    const absolute = resolveSourcePath(source.path);
    const file = Bun.file(absolute);
    if (!(await file.exists())) {
      return rejected(
        'source-missing',
        'incomplete-required-source',
        `${source.path}: listed in the manifest but absent from the checkout`,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      return rejected(
        'source-unreadable',
        'incomplete-required-source',
        `${source.path}: could not be read: ${(error as Error).message}`,
      );
    }

    const result = verifySourceBytes(source, bytes);
    if (!result.ok) return result;
    verified.push(result.value);
  }

  return accepted(verified);
}
