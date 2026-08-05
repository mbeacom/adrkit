/**
 * T079 — the versioned envelope is the **only** output: no side files, no logs
 * presented as output, no auxiliary artifacts.
 *
 * # The rule
 *
 * ADR-0020 clause 7, quoted by FR-038: "The generator writes the envelope and nothing
 * else." FR-038 adds the specific prohibition: it "MUST NOT write a
 * `CatalogSnapshot`-shaped artifact directly, under any circumstance."
 *
 * That second half is the one worth restating. Deriving a `CatalogSnapshot` from an
 * envelope is a real and necessary operation — it is simply **not this package's**.
 * It belongs to `@adrkit/catalog-envelope`, on the far side of a boundary whose entire
 * interface is the envelope file (`package-boundary.md` §3). A generator that wrote a
 * derived snapshot would make the consumer's validation optional, and an optional
 * integrity check is not one.
 *
 * # What "only" is enforced by
 *
 * {@link writeEnvelope} performs exactly two filesystem writes — a temporary file and
 * the `rename` that puts it in place — and returns the single path it wrote. There is
 * no logger, no report, no manifest of outputs, and no second destination parameter.
 * A caller wanting diagnostics gets them as a **returned value**
 * (`pipeline.ts`'s `stages`), never as a file, because "logs presented as output" is
 * named in FR-038 as one of the things this forbids.
 *
 * # Atomicity of the write itself
 *
 * `atomic-fail-closed.md` §1 requires "no usable partial snapshot"; T073 spells out
 * "no partial envelope, no partial file, no truncated stream". Two of those are handled
 * before this module runs — `pipeline.ts` assembles the whole envelope in memory and
 * aborts before calling here, so an abort never reaches a write at all.
 *
 * The third is handled here. A single `Bun.write` to the destination can be interrupted
 * part-way and leave a truncated file at the path a consumer will read. So the bytes go
 * to a temporary file **in the destination directory** and are then `rename`d into
 * place: `rename` within one filesystem is atomic, so a reader sees either the previous
 * state or the complete envelope, never a prefix of it. The temporary file is created
 * in the same directory rather than in `/tmp` precisely because a cross-device rename
 * is not atomic — it degrades to copy-then-unlink, which reintroduces the truncation
 * window this exists to close.
 *
 * On an interrupted run the temporary file may survive. That is the intended failure
 * direction: a leftover `.tmp` is inert and visible, whereas a truncated envelope at
 * the real path is neither.
 *
 * @see `specs/010-catalog-backstage/spec.md` FR-038
 * @see `specs/010-catalog-backstage/contracts/atomic-fail-closed.md` §1
 */

import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SnapshotEnvelope } from './shape.ts';

/**
 * The serialized envelope, as the bytes that are written.
 *
 * `JSON.stringify` with no indentation. Two-space indentation would be friendlier to
 * read and would put whitespace into the file whose exact bytes FR-042 requires be
 * identical across runs — reproducible either way, but compact output makes the file's
 * bytes a function of the envelope's content alone rather than of a formatting choice
 * this module could later change.
 *
 * A trailing newline **is** included. It costs one byte, is stable across runs, and
 * makes the file well-formed for the line-oriented tools a maintainer will inevitably
 * point at it.
 *
 * Note this is *not* the canonical form the digest is computed over
 * (`envelope/digest.ts`). The digest's canonical form sorts keys at every level; this
 * preserves the declaration order `envelope/shape.ts` fixes. Both are deterministic,
 * and they are deliberately different serializations for different jobs.
 */
export function serializeEnvelope(envelope: SnapshotEnvelope): string {
  return `${JSON.stringify(envelope)}\n`;
}

/** What a successful write reports. One path, because one file is written. */
export interface WriteResult {
  readonly path: string;
  readonly byteLength: number;
}

/**
 * Write the envelope to `destination`, atomically, and write nothing else.
 *
 * The parent directory is created if absent — that is a directory, not an artifact, and
 * failing because a caller's chosen output directory does not exist yet would be a
 * usability failure with no integrity benefit.
 *
 * @param destination the full path of the envelope file to write
 */
export async function writeEnvelope(
  envelope: SnapshotEnvelope,
  destination: string,
): Promise<WriteResult> {
  const text = serializeEnvelope(envelope);
  const bytes = new TextEncoder().encode(text);

  const directory = dirname(destination);
  await mkdir(directory, { recursive: true });

  // Same directory as the destination: a cross-device rename is not atomic, and a
  // temporary file under the system temp directory is very often on another device.
  const temporary = join(directory, `.${envelope.digest}.envelope.tmp`);

  try {
    await Bun.write(temporary, bytes);
    await rename(temporary, destination);
  } catch (error) {
    // Best-effort only, and deliberately not reported as a failure of its own: the
    // write already failed, and a cleanup error would replace the real cause with a
    // secondary one. A surviving temporary file is inert.
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }

  return { path: destination, byteLength: bytes.byteLength };
}
