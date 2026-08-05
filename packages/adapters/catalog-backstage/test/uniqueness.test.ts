/**
 * T071 — global canonical uniqueness over **every ref**, three distinct classes, and
 * no first-wins or last-wins resolution.
 *
 * `entity-identity.md` §3. The table there gives four collision kinds mapping onto
 * three trigger classes; the fourth (`duplicate-yaml-key`) is detected at descriptor
 * read and is checked in `test/trigger-classification.test.ts`.
 *
 * # `duplicate-canonical-ref`'s reachability, recorded rather than implied
 *
 * `identity/canonicalize.ts` populates `allRefs` as `[canonicalId]` and nothing else,
 * because `data-model.md` §5 records how `allRefs` is populated beyond the primary id
 * as an unresolved `[NEEDS CLARIFICATION]`, and `entity-identity.md` §2 says alias refs
 * come "directly by a synthetic fixture's own construction" with "no real-corpus entity
 * from `community-plugins` or `rhdh-plugins`" ever having one.
 *
 * **Consequence:** no descriptor-sourced input reaches `duplicate-canonical-ref`. Two
 * descriptors that canonicalize alike collide as `duplicate-canonical-id`. Every case
 * below that produces `duplicate-canonical-ref` hands this kernel a **synthetic**
 * identity set, and is labelled as such. That is stated here rather than left for a
 * reader to infer from the fixtures.
 */

import { describe, expect, test } from 'bun:test';
import {
  COLLISION_CLASSES,
  checkGlobalUniqueness,
  collisionReason,
  foldedRefs,
} from '../src/identity/uniqueness.ts';

const identity = (canonicalId: string, ...aliases: readonly string[]) => ({
  canonicalId,
  allRefs: [canonicalId, ...aliases],
});

describe('T071 — the three collision classes §3 enumerates', () => {
  test('all three are members of the closed trigger enumeration', () => {
    expect([...COLLISION_CLASSES].sort()).toEqual([
      'duplicate-canonical-id',
      'duplicate-canonical-ref',
      'duplicate-yaml-key',
    ]);
  });

  test('a distinct set passes, so the rejections below are not vacuous', () => {
    const outcome = checkGlobalUniqueness([
      identity('component:default/payments'),
      identity('component:default/billing'),
      identity('api:default/payments'),
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.refCount).toBe(3);
  });
});

describe('T071 — row 1: identical canonical ids are `duplicate-canonical-id`', () => {
  test('two descriptors canonicalizing alike collide', () => {
    const outcome = checkGlobalUniqueness([
      identity('component:default/payments'),
      identity('component:default/payments'),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.rejection.reason).toBe('duplicate-canonical-id');
    expect(outcome.rejection.triggerClass).toBe('duplicate-canonical-id');
    expect(outcome.collision.first.entityIndex).toBe(0);
    expect(outcome.collision.second.entityIndex).toBe(1);
  });

  test('the case-only pair §1 canonicalizes together arrives here already identical', () => {
    // `Component:Default/Payments` and `component:default/payments` are one string by
    // the time uniqueness sees them, because `identity/canonicalize.ts` lowercases the
    // entire id. So §1's worked example lands on row 1, not on row 3.
    const outcome = checkGlobalUniqueness([
      identity('Component:Default/Payments'.toLowerCase()),
      identity('component:default/payments'),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejection.reason).toBe('duplicate-canonical-id');
  });
});

describe('T071 — row 2: an alias colliding with a different entity\u2019s id is `duplicate-canonical-ref`', () => {
  test('§3\u2019s worked example, on a synthetic identity set', () => {
    // Synthetic: `allRefs` beyond `canonicalId` has no descriptor-sourced route.
    const outcome = checkGlobalUniqueness([
      identity('component:default/billing', 'component:default/billing-legacy'),
      identity('component:default/billing-legacy'),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.rejection.reason).toBe('duplicate-canonical-ref');
    expect(outcome.rejection.triggerClass).toBe('duplicate-canonical-ref');
    expect(outcome.collision.first.primary).toBe(false);
    expect(outcome.collision.second.primary).toBe(true);
  });

  test('an alias-vs-alias collision is also `duplicate-canonical-ref`', () => {
    const outcome = checkGlobalUniqueness([
      identity('component:default/a', 'component:default/shared'),
      identity('component:default/b', 'component:default/shared'),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejection.reason).toBe('duplicate-canonical-ref');
  });
});

describe('T071 — row 3: a case-only variant is `duplicate-canonical-ref`', () => {
  test('an alias differing only by case collides', () => {
    const outcome = checkGlobalUniqueness([
      identity('component:default/billing', 'Component:Default/Billing-Legacy'),
      identity('component:default/billing-legacy'),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.rejection.reason).toBe('duplicate-canonical-ref');
    expect(outcome.rejection.detail).toContain('case-only variant');
  });

  test('the class is `duplicate-canonical-ref` and specifically not `duplicate-canonical-id`', () => {
    // The distinction §3's second and third rows exist to make. A rule that reported
    // every collision as `duplicate-canonical-id` would pass a test that only asserted
    // "it aborted", and would make rows 2 and 3 unobservable.
    expect(
      collisionReason(
        { entityIndex: 0, canonicalId: 'component:default/a', ref: 'Component:Default/A', primary: false },
        { entityIndex: 1, canonicalId: 'component:default/a', ref: 'component:default/a', primary: true },
      ),
    ).toBe('duplicate-canonical-ref');

    expect(
      collisionReason(
        { entityIndex: 0, canonicalId: 'component:default/a', ref: 'component:default/a', primary: true },
        { entityIndex: 1, canonicalId: 'component:default/a', ref: 'component:default/a', primary: true },
      ),
    ).toBe('duplicate-canonical-id');
  });

  test('two identical primary ids belonging to the SAME entity are not row 1', () => {
    // §3 row 1 is "Two **entities'** `canonicalId` values are identical". One entity
    // repeating its own id is a ref uniqueness failure, not two entities colliding.
    expect(
      collisionReason(
        { entityIndex: 0, canonicalId: 'component:default/a', ref: 'component:default/a', primary: true },
        { entityIndex: 0, canonicalId: 'component:default/a', ref: 'component:default/a', primary: true },
      ),
    ).toBe('duplicate-canonical-ref');
  });
});

describe('T071 — first-wins and last-wins are both forbidden', () => {
  test('a collision returns a rejection, never a surviving member', () => {
    const outcome = checkGlobalUniqueness([
      identity('component:default/a'),
      identity('component:default/a'),
    ]);
    expect(outcome.ok).toBe(false);
    // There is no `kept`, `winner`, `resolved`, or `survivors` field to read, so
    // "which one won" is not a question this type can answer.
    expect(Object.keys(outcome).sort()).toEqual(['collision', 'ok', 'rejection']);
  });

  test('the reported collision does not depend on which member came first', () => {
    const forwards = checkGlobalUniqueness([
      identity('component:default/a'),
      identity('component:default/b'),
      identity('component:default/a'),
    ]);
    const backwards = checkGlobalUniqueness([
      identity('component:default/a'),
      identity('component:default/a'),
      identity('component:default/b'),
    ]);
    expect(forwards.ok).toBe(false);
    expect(backwards.ok).toBe(false);
    if (forwards.ok || backwards.ok) return;
    expect(forwards.rejection.reason).toBe(backwards.rejection.reason);
  });

  test('the detail names the prohibition, so an abort is legible without the contract', () => {
    const outcome = checkGlobalUniqueness([
      identity('component:default/a'),
      identity('component:default/a'),
    ]);
    if (outcome.ok) throw new Error('expected a collision');
    expect(outcome.rejection.detail).toContain('first-wins or last-wins');
  });
});

describe('T071 — uniqueness is over every ref, not only primary ids', () => {
  test('a ref repeated within one entity is a violation', () => {
    // §3: "every string appearing in **any** entity's `allRefs` MUST be globally
    // unique." §3's table lists only cross-entity kinds, so this reading is recorded
    // in `identity/uniqueness.ts` rather than left implicit.
    const outcome = checkGlobalUniqueness([
      { canonicalId: 'component:default/a', allRefs: ['component:default/a', 'component:default/a'] },
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejection.reason).toBe('duplicate-canonical-ref');
  });

  test('the comparison walks aliases as well as primary ids', () => {
    const outcome = checkGlobalUniqueness([
      identity('component:default/a', 'component:default/x', 'component:default/y'),
      identity('component:default/b'),
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.refCount).toBe(4);
  });

  test('folded refs are sorted and deduplicated, so a report is reproducible', () => {
    expect(
      foldedRefs([identity('component:default/b'), identity('component:default/a', 'API:Default/A')]),
    ).toEqual(['api:default/a', 'component:default/a', 'component:default/b']);
  });
});
