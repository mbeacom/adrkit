/**
 * T071 — **global canonical uniqueness over every ref**, with three distinct
 * collision classes and no first-wins or last-wins resolution anywhere.
 *
 * # The rule
 *
 * `entity-identity.md` §3: "Within one snapshot-generation run, every string appearing
 * in **any** entity's `allRefs` (`canonicalId` plus every `fixtureAuthoredAliasRefs`
 * entry) MUST be globally unique." Its table gives four collision kinds mapping onto
 * three trigger classes:
 *
 * | Collision kind | Class |
 * |---|---|
 * | Two entities' `canonicalId` values are identical | `duplicate-canonical-id` |
 * | One entity's alias ref collides with a **different** entity's primary id | `duplicate-canonical-ref` |
 * | A case-only variant of either collision above | `duplicate-canonical-ref` |
 * | Duplicate YAML mapping key within one descriptor document | `duplicate-yaml-key` |
 *
 * The fourth is detected far earlier — `descriptor/read.ts` branches on the `yaml`
 * library's own `DUPLICATE_KEY` code before any identity exists to compare. It is
 * named in {@link COLLISION_CLASSES} anyway, because §3 groups it as a collision kind
 * and a reader who found only two here would reasonably conclude one was missing.
 *
 * # First-wins and last-wins are both forbidden
 *
 * §3: "none may be silently merged, and none may be resolved by first-wins or
 * last-wins." This module has no branch that keeps one member of a colliding group —
 * {@link checkGlobalUniqueness} returns a rejection, and its caller aborts the whole
 * run. The accept-corpus freeze's selection basis makes the same point about its own
 * construction: "EVERY member of any colliding group excluded rather than one member
 * kept — keeping one would be last-wins resolution."
 *
 * # Case-only variants, and why comparison is case-folded
 *
 * `identity/canonicalize.ts` lowercases the **entire** canonical id, so two primary
 * ids that differ only by case are already byte-identical by the time they reach this
 * module — they collide as `duplicate-canonical-id` without any case handling here.
 * A case-only variant can therefore only arise in a ref that is *not* the primary id,
 * which is not lowercased. Comparison is keyed on the case-folded ref so those are
 * caught, and §3's third row assigns them `duplicate-canonical-ref`.
 *
 * **This does not change any matcher's case sensitivity.** `entity-identity.md` §5 is
 * explicit that ADR-0012 leaves `packages/core/src/affects/**`'s `nocase: false`
 * semantics untouched. The fold here is a uniqueness comparison at the generator
 * boundary, and nothing else.
 *
 * # `duplicate-canonical-ref`'s reachability, stated rather than implied
 *
 * `identity/canonicalize.ts` populates `allRefs` as `[canonicalId]` and nothing more,
 * because `data-model.md` §5 records — as an unresolved `[NEEDS CLARIFICATION]` — that
 * how `allRefs` is populated beyond the primary id in production is undecided.
 * `entity-identity.md` §2 adds that alias refs are supplied "directly by a synthetic
 * fixture's own construction" and that "no real-corpus entity from `community-plugins`
 * or `rhdh-plugins` ever has a non-empty `fixtureAuthoredAliasRefs`".
 *
 * **Consequence, recorded plainly:** with `allRefs` populated only by `canonicalId`,
 * no descriptor-sourced input can reach `duplicate-canonical-ref` — two descriptors
 * that canonicalize alike collide as `duplicate-canonical-id`. The class is reachable
 * only by handing this kernel a synthetic identity set. That is why this module takes
 * a plain identity list rather than descriptors: the class stays exercisable without
 * inventing a production alias mechanism that `entity-identity.md` §2 says is "an
 * explicitly separate, later, out-of-scope design decision".
 *
 * @see `specs/009-catalog-binding-viability/contracts/entity-identity.md` §2, §3, §5
 * @see `specs/010-catalog-backstage/spec.md` FR-023
 */

import { compareCodeUnits } from '@adrkit/core';
import type { Rejection, TriggerClass } from '../failure/triggers.ts';

/**
 * The three classes `entity-identity.md` §3's table produces.
 *
 * `duplicate-yaml-key` is detected at descriptor read, not here. It is listed because
 * §3 lists it, and its absence would read as a missing case rather than as a case
 * handled elsewhere.
 */
export const COLLISION_CLASSES = [
  'duplicate-canonical-id',
  'duplicate-canonical-ref',
  'duplicate-yaml-key',
] as const satisfies readonly TriggerClass[];

/** The reasons this module emits. Both are 1:1 with their trigger class. */
export type UniquenessReason = 'duplicate-canonical-id' | 'duplicate-canonical-ref';

/** The minimum an entity must present to participate in the uniqueness comparison. */
export interface IdentityUnderTest {
  readonly canonicalId: string;
  /** Non-empty; `canonicalId` is always a member (`data-model.md` §5). */
  readonly allRefs: readonly string[];
}

/** One ref occurrence, retained so a collision can name both sides. */
export interface RefOccurrence {
  /** Index into the input list, so two occurrences of one entity are distinguishable. */
  readonly entityIndex: number;
  readonly canonicalId: string;
  /** The ref as written, before case folding. */
  readonly ref: string;
  /** True when `ref` is this entity's own `canonicalId`. */
  readonly primary: boolean;
}

/** A collision between two ref occurrences. */
export interface Collision {
  readonly reason: UniquenessReason;
  readonly first: RefOccurrence;
  readonly second: RefOccurrence;
}

/** The outcome of the whole comparison. */
export type UniquenessOutcome =
  | { readonly ok: true; readonly refCount: number }
  | { readonly ok: false; readonly collision: Collision; readonly rejection: Rejection<UniquenessReason> };

/**
 * Which class a collision between two occurrences falls under.
 *
 * `duplicate-canonical-id` is the **narrow** case, and deliberately so: §3's first row
 * is "Two **entities'** `canonicalId` values are identical", so all three of these must
 * hold — the two occurrences belong to **different entities**, both are primary
 * canonical ids, and they are byte-identical. Anything else is
 * `duplicate-canonical-ref`: an alias on either side, two refs agreeing only after case
 * folding (§3's second and third rows), or a ref repeated **within one entity**, which
 * violates §3's "every string appearing in any entity's `allRefs` MUST be globally
 * unique" without being two entities claiming one id.
 *
 * The within-entity clause was added after a check caught this function reporting such
 * a repeat as `duplicate-canonical-id`, which would have named two entities where there
 * was one.
 *
 * Getting the breadth backwards is the failure mode worth naming: a rule that reported
 * every collision as `duplicate-canonical-id` would pass any test that only checked
 * "the run aborted", while making the alias and case-variant rows of §3's table
 * unobservable.
 */
export function collisionReason(first: RefOccurrence, second: RefOccurrence): UniquenessReason {
  const distinctEntities = first.entityIndex !== second.entityIndex;
  const bothPrimary = first.primary && second.primary;
  const byteIdentical = first.ref === second.ref;
  return distinctEntities && bothPrimary && byteIdentical
    ? 'duplicate-canonical-id'
    : 'duplicate-canonical-ref';
}

function occurrences(identities: readonly IdentityUnderTest[]): readonly RefOccurrence[] {
  return identities.flatMap((identity, entityIndex) =>
    identity.allRefs.map((ref) => ({
      entityIndex,
      canonicalId: identity.canonicalId,
      ref,
      primary: ref === identity.canonicalId,
    })),
  );
}

/**
 * Enforce global uniqueness across every ref of every entity.
 *
 * Occurrences are walked in `(entityIndex, refIndex)` order and the **first** repeat
 * of a case-folded key aborts. That order is a property of the input list, which
 * `pipeline.ts` builds in manifest-source order and then document order — so the
 * reported collision for an input with several is reproducible rather than a function
 * of hash iteration.
 *
 * A ref repeated **within one entity** is also a violation: §3 says every string
 * appearing in any entity's `allRefs` must be globally unique, and a within-entity
 * repeat is not unique. It is reported as `duplicate-canonical-ref`, because it is a
 * ref-level uniqueness failure and not two entities claiming one canonical id. That
 * reading is recorded here because §3's table lists only cross-entity kinds and is
 * silent on this one.
 */
export function checkGlobalUniqueness(
  identities: readonly IdentityUnderTest[],
): UniquenessOutcome {
  const seen = new Map<string, RefOccurrence>();
  const all = occurrences(identities);

  for (const occurrence of all) {
    const key = occurrence.ref.toLowerCase();
    const previous = seen.get(key);

    if (previous !== undefined) {
      const reason = collisionReason(previous, occurrence);
      const collision: Collision = { reason, first: previous, second: occurrence };
      return {
        ok: false,
        collision,
        rejection: {
          reason,
          triggerClass: reason,
          detail: describeCollision(collision),
        },
      };
    }

    seen.set(key, occurrence);
  }

  return { ok: true, refCount: all.length };
}

function describeCollision(collision: Collision): string {
  const render = (occurrence: RefOccurrence): string =>
    `entity ${occurrence.entityIndex} (${occurrence.canonicalId}) ${
      occurrence.primary ? 'canonicalId' : 'ref'
    } ${JSON.stringify(occurrence.ref)}`;

  const caseOnly =
    collision.first.ref !== collision.second.ref &&
    collision.first.ref.toLowerCase() === collision.second.ref.toLowerCase();

  return (
    `${render(collision.first)} collides with ${render(collision.second)}` +
    (caseOnly ? ' (case-only variant)' : '') +
    '; entity-identity.md \u00a73 forbids resolving this by first-wins or last-wins'
  );
}

/**
 * Every ref in the run, case-folded, sorted and deduplicated.
 *
 * Diagnostic rather than load-bearing, and sorted with `compareCodeUnits` so that two
 * runs over the same input produce the same list — FR-042's byte-identical requirement
 * reaches anything a run can report, not only the envelope.
 */
export function foldedRefs(identities: readonly IdentityUnderTest[]): readonly string[] {
  return [...new Set(occurrences(identities).map((occurrence) => occurrence.ref.toLowerCase()))].sort(
    compareCodeUnits,
  );
}
