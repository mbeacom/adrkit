/**
 * T045 — the closed input boundary.
 *
 * `input-manifest.md` §5 fixes what a single generation invocation may read:
 * the manifest file itself, each descriptor path the manifest's `sources` array
 * lists (digest-verified before trust), and the two git-identity values read by
 * subprocess. It **never**:
 *
 * - follows a `Location` entity's `spec.targets` to a file the manifest does not
 *   itself list;
 * - invokes any catalog processor or plugin of any kind;
 * - recursively walks or glob-expands the tree to *discover* descriptor files,
 *   "even ones that would trivially match a typical `catalog-info.yaml` naming
 *   convention";
 * - claims whole-catalog completeness.
 *
 * **Why this is a module and not only a test.** A boundary asserted purely by the
 * absence of forbidden code is the shape ADR-0016 clause 3 warns about: a scan that
 * examined nothing reports the same green as a scan that looked properly. So the
 * boundary is made into a **value that can be computed and compared** —
 * {@link admissibleReadSet} derives the entire permitted read set from the manifest
 * alone, and {@link classifyLocationTarget} decides, for a concrete `Location`
 * target, whether that target is inside it. A test can then assert a specific
 * observed value rather than an absence. The source-level scan in
 * `test/input-boundary.test.ts` is the second, independent mechanism; neither is
 * sufficient alone.
 *
 * @see `specs/009-catalog-binding-viability/contracts/input-manifest.md` §5, §6
 * @see `specs/010-catalog-backstage/spec.md` FR-013
 */

import { compareCodeUnits } from '@adrkit/core';
import type { InputManifest } from './schema.ts';

/**
 * The two git reads §5 permits, named as data.
 *
 * Exported so the permitted subprocess surface is enumerable rather than implied
 * by whatever `repository/identity.ts` happens to call.
 */
export const PERMITTED_GIT_READS = [
  ['remote', 'get-url', 'origin'],
  ['rev-parse', 'HEAD'],
] as const;

/** Everything one generation invocation is permitted to read. */
export interface AdmissibleReadSet {
  /** The manifest file's own path, as supplied to the invocation. */
  readonly manifestPath: string;
  /** Exactly the manifest's `sources[].path` values, sorted and deduplicated. */
  readonly sourcePaths: readonly string[];
  /** The git argument vectors permitted as subprocess reads. */
  readonly gitReads: readonly (readonly string[])[];
}

/**
 * Derive the closed read set from the manifest alone.
 *
 * There is deliberately no filesystem parameter and no directory argument: this
 * function *cannot* widen the set by looking around, because it has nothing to look
 * at. Sorting by `compareCodeUnits` and deduplicating makes the set a function of
 * manifest content alone, so two manifests listing the same sources in different
 * orders produce the identical read set.
 */
export function admissibleReadSet(
  manifestPath: string,
  manifest: InputManifest,
): AdmissibleReadSet {
  const sourcePaths = [...new Set(manifest.sources.map((source) => source.path))].sort(
    compareCodeUnits,
  );
  return { manifestPath, sourcePaths, gitReads: PERMITTED_GIT_READS };
}

/** True when `path` is one of the manifest-listed sources. */
export function isManifestListedSource(readSet: AdmissibleReadSet, path: string): boolean {
  return readSet.sourcePaths.includes(path);
}

/**
 * The two outcomes for a `Location` entity's `spec.targets` entry.
 *
 * `zero-derived-paths-never-read` is `input-manifest.md` §6's own required
 * wording, and `data-model.md` §16 records it as the evidence-bundle value. §6 is
 * explicit that it must **never** be recorded as `"invalid-input"`: the target's
 * annotation was not invalid, it was never read at all, and reporting a file that
 * was never opened as invalid asserts an observation that did not happen.
 */
export type LocationTargetOutcome = 'manifest-listed' | 'zero-derived-paths-never-read';

/** One classified `Location` target. */
export interface LocationTargetClassification {
  readonly target: string;
  readonly outcome: LocationTargetOutcome;
}

/**
 * Classify one `Location` `spec.targets` entry against the read set.
 *
 * Note what this function does *not* do: it never opens `target`, never stats it,
 * and never resolves it. A target outside the manifest is not read in order to
 * discover that it should not have been read.
 */
export function classifyLocationTarget(
  readSet: AdmissibleReadSet,
  target: string,
): LocationTargetClassification {
  return {
    target,
    outcome: isManifestListedSource(readSet, target)
      ? 'manifest-listed'
      : 'zero-derived-paths-never-read',
  };
}

/**
 * Classify every `spec.targets` entry a `Location` descriptor carries.
 *
 * `rawTargets` is `unknown` because it comes from a descriptor that has not been
 * shape-checked — `data-model.md` §3 types descriptor content as `unknown` for
 * exactly this reason. A non-array, or a non-string element, yields no
 * classification rather than a coerced one: this function's job is to demonstrate
 * that targets are not followed, and inventing a target string to then not follow
 * would be a fabricated observation.
 */
export function classifyLocationTargets(
  readSet: AdmissibleReadSet,
  rawTargets: unknown,
): readonly LocationTargetClassification[] {
  if (!Array.isArray(rawTargets)) return [];
  return rawTargets
    .filter((target): target is string => typeof target === 'string')
    .map((target) => classifyLocationTarget(readSet, target));
}

/**
 * FR-014 · `input-manifest.md` §5's fourth bullet.
 *
 * A constant rather than a computation, because there is no input under which it
 * could be `true`: FR-013 forbids tree traversal, so no run can ever have seen the
 * whole catalog. Phase E's envelope assembly consumes this; it is stated here
 * because it is a property *of the input boundary*, not of the envelope writer.
 */
export const WHOLE_CATALOG_COMPLETENESS = false;
