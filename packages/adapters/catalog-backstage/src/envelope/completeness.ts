/**
 * T070 — `completeness.wholeCatalog` is `false` **unconditionally**, in every
 * envelope, on every path.
 *
 * # There is no input that can make it true
 *
 * FR-014 and `input-manifest.md` §5's fourth bullet: generation never "[c]laims or
 * implies whole-catalog completeness — `SnapshotEnvelope.completeness.wholeCatalog` is
 * always `false` for every envelope". That is not a default; it is the only value.
 *
 * The reason is structural rather than stylistic. FR-013 and `input-manifest.md` §5
 * forbid recursive walking and glob-based discovery, so a run reads exactly the files
 * one manifest names and cannot have observed anything else. An envelope claiming
 * whole-catalog completeness would be asserting an observation the input boundary made
 * impossible.
 *
 * # How "no configuration can change it" is enforced
 *
 * {@link completeness} takes **one** parameter, and it is not `wholeCatalog`. There is
 * no flag, option, or override to thread through, so the value cannot be made
 * configurable by a caller without changing this signature — which is a visible,
 * reviewable edit rather than a call-site someone quietly passed `true` at.
 *
 * `manifest/boundary.ts` already exports `WHOLE_CATALOG_COMPLETENESS`, stating the
 * same fact as a property *of the input boundary*. This module consumes that constant
 * rather than restating `false`, so the two cannot drift into disagreeing.
 *
 * # `identityOnly` is a different question and is not pinned here
 *
 * `snapshot-envelope.md` §2 step 5 makes `identityOnly` the consumer's one signal for
 * rejecting a partial envelope, "determined **solely** from this boolean field, never
 * by scanning the entity list's `ownershipState` distribution". It is a real input to
 * this function because a future generation mode could legitimately produce an
 * identity-only envelope. `wholeCatalog` has no such future, which is why only one of
 * the two is a parameter.
 *
 * @see `specs/010-catalog-backstage/spec.md` FR-014
 * @see `specs/009-catalog-binding-viability/contracts/input-manifest.md` §5
 */

import { WHOLE_CATALOG_COMPLETENESS } from '../manifest/boundary.ts';

/** `data-model.md` §9's `completeness` object. */
export interface EnvelopeCompleteness {
  readonly wholeCatalog: boolean;
  readonly identityOnly: boolean;
}

/**
 * Build the `completeness` object.
 *
 * @param identityOnly whether this envelope carries identity without derived
 * ownership. `false` for every envelope this pipeline produces today; it is a
 * parameter because the consumer's step 5 treats it as the one authoritative signal
 * and a value that could never be `true` would make that step untestable from the
 * generator side.
 */
export function completeness(identityOnly: boolean): EnvelopeCompleteness {
  return { wholeCatalog: WHOLE_CATALOG_COMPLETENESS, identityOnly };
}

/**
 * The one value `wholeCatalog` may take, re-exported for a check to assert against.
 *
 * Re-exported rather than redeclared: a second `false` here could stay `false` while
 * the boundary's own constant changed, and the check would then pass against a
 * constant nothing uses.
 */
export { WHOLE_CATALOG_COMPLETENESS };
