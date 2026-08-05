/**
 * T040 — the three manifest-level version and capability rejections.
 *
 * `input-manifest.md` §2 fixes exactly three, and fixes what each one is *about*:
 * all three are properties of the **manifest / generation request as a whole**,
 * never of an individual entity within a batch. Each aborts generation, non-zero,
 * **before any entity's paths are derived**. Together with `incomplete-required-source`
 * (`manifest/digests.ts`, T043) they are the four manifest-request-level rejections
 * `atomic-fail-closed.md` §5 enumerates.
 *
 * | Field | Only accepted value | Trigger class |
 * |---|---|---|
 * | `manifestSchemaVersion` | exactly `"1"` | `unsupported-manifest-version` |
 * | `requestedSnapshotSchemaVersion` | exactly `"1"` | `unsupported-snapshot-version` |
 * | `requiredCapabilities` | no member other than `"pathOwnership"` | `unsupported-capability` |
 *
 * **The capability rule is a rule about strings that are present, not about
 * cardinality.** `input-manifest.md` §2 defines the trigger parenthetically and
 * precisely: it is *"triggered by any string other than `"pathOwnership"` appearing
 * in the array"*. An array containing no offending string therefore does not
 * trigger it — this module implements that rule as written rather than inventing a
 * stricter arity check the contract does not authorize. `data-model.md` §1 types
 * the field as the one-element tuple `readonly ["pathOwnership"]`, which is a
 * narrower shape than §2's rejection rule; the divergence is reported rather than
 * resolved here, because inventing a rejection is as much a contract violation as
 * omitting one.
 *
 * Pure. Takes a manifest that has already cleared `manifest/schema.ts`.
 *
 * @see `specs/009-catalog-binding-viability/contracts/input-manifest.md` §2
 * @see `specs/009-catalog-binding-viability/contracts/atomic-fail-closed.md` §5
 */

import { type Validated, accepted, rejected } from '../diagnostics.ts';
import type { InputManifest } from './schema.ts';

/** The only accepted `manifestSchemaVersion`. */
export const SUPPORTED_MANIFEST_SCHEMA_VERSION = '1';

/** The only accepted `requestedSnapshotSchemaVersion`. */
export const SUPPORTED_SNAPSHOT_SCHEMA_VERSION = '1';

/** The only defined capability. */
export const SUPPORTED_CAPABILITY = 'pathOwnership';

/**
 * The three fine-grained reasons.
 *
 * Deliberately spelled identically to the trigger classes they map onto: unlike
 * the schema reasons, these three are 1:1 with their trigger class, so a second
 * distinct spelling would be a synonym rather than information.
 */
export type ManifestVersionReason =
  | 'unsupported-manifest-version'
  | 'unsupported-snapshot-version'
  | 'unsupported-capability';

/**
 * Apply the three rejections, in the order `input-manifest.md` §2's table lists
 * them.
 *
 * The order is fixed so that a manifest violating two of the three always reports
 * the same one — the same first-match-wins discipline `glob-dialect.md` §3 imposes
 * on patterns, and for the same reason: a reported reason that depends on
 * evaluation order is not reproducible evidence.
 */
export function checkManifestVersions(
  manifest: InputManifest,
): Validated<InputManifest, ManifestVersionReason> {
  if (manifest.manifestSchemaVersion !== SUPPORTED_MANIFEST_SCHEMA_VERSION) {
    return rejected(
      'unsupported-manifest-version',
      'unsupported-manifest-version',
      `manifestSchemaVersion must be ${JSON.stringify(SUPPORTED_MANIFEST_SCHEMA_VERSION)}; observed ${JSON.stringify(manifest.manifestSchemaVersion)}`,
    );
  }

  if (manifest.requestedSnapshotSchemaVersion !== SUPPORTED_SNAPSHOT_SCHEMA_VERSION) {
    return rejected(
      'unsupported-snapshot-version',
      'unsupported-snapshot-version',
      `requestedSnapshotSchemaVersion must be ${JSON.stringify(SUPPORTED_SNAPSHOT_SCHEMA_VERSION)}; observed ${JSON.stringify(manifest.requestedSnapshotSchemaVersion)}`,
    );
  }

  for (const [index, capability] of manifest.requiredCapabilities.entries()) {
    if (capability !== SUPPORTED_CAPABILITY) {
      return rejected(
        'unsupported-capability',
        'unsupported-capability',
        `requiredCapabilities[${index}] is ${JSON.stringify(capability)}; the only defined capability is ${JSON.stringify(SUPPORTED_CAPABILITY)}`,
      );
    }
  }

  return accepted(manifest);
}
