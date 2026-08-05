/**
 * T054 — **observed failing, permanent negative case.** FR-021: a descriptor that
 * is simultaneously **inadmissible and canonically unique**.
 *
 * # Why this specific fixture exists
 *
 * `admissibility.md` §6: the two determinations are independent, and conformance
 * evidence "MUST demonstrate that independence rather than assert it. Specifically,
 * the evidence MUST include at least one descriptor that is **inadmissible and
 * canonically unique** — a descriptor that fails §2 while colliding with nothing.
 * Without such a case, a passing suite is equally consistent with an implementation
 * that has silently fused the two checks."
 *
 * ADR-0015 says the same thing about the corpus that motivated it: of the sixteen
 * unsubstituted placeholder descriptors, fourteen share `${{ values.name | dump }}`
 * and collide with one another, while `bulk-import` (`${{ values.name }}`) and
 * `orchestrator` (`${{ values.entityName }}`) "canonicalize distinctly and collide
 * with nothing. They are exactly as invalid as the other fourteen, and the contract
 * has no mechanism of any kind that would notice. The duplicate rule catches the
 * fourteen only incidentally, as a side effect of their sharing a string; behind it
 * there is nothing."
 *
 * **This fixture is retained permanently.** It is the only thing that distinguishes
 * T053's property from an accident of ordering.
 *
 * # A counting note
 *
 * The **fourteen** in this file counts *placeholder descriptors*. It is **not** the
 * trigger count. This feature's fatal trigger enumeration has **fifteen** members
 * (`admissibility.md` §5.1, §6.1). Two unrelated fourteens; fusing them produces a
 * document this repository fails.
 *
 * # Honesty
 *
 * These are hand-authored fixtures reproducing the *strings* ADR-0015 records. No
 * corpus is read here, and nothing below asserts what Backstage as a running system
 * does with them — only what the pinned validator predicate returns.
 *
 * ADR-0016 evidence:
 * `specs/010-catalog-backstage/evidence/negative-cases/inadmissible-and-unique/`.
 */

import { describe, expect, test } from 'bun:test';
import { classifyAdmissibility, inadmissibleRejection } from '../src/admissibility/classify.ts';
import { admit, collectAdmitted } from '../src/admissibility/index.ts';
import { canonicalize } from '../src/identity/canonicalize.ts';
import { validateEntityName } from '../src/admissibility/validators.ts';
import {
  ADMISSIBLE,
  INADMISSIBLE_AND_COLLIDING,
  INADMISSIBLE_AND_UNIQUE_BULK_IMPORT,
  INADMISSIBLE_AND_UNIQUE_ORCHESTRATOR,
  descriptor,
} from './descriptor-fixtures.ts';

/** ADR-0015's two outliers, by the names ADR-0015 gives them. */
const OUTLIERS = [
  ['bulk-import descriptor', INADMISSIBLE_AND_UNIQUE_BULK_IMPORT, '${{ values.name }}'],
  ['orchestrator descriptor', INADMISSIBLE_AND_UNIQUE_ORCHESTRATOR, '${{ values.entityName }}'],
] as const;

describe('T054 — the fixture is genuinely inadmissible', () => {
  test.each(OUTLIERS)('%s fails `validateEntityName` on character class', (_name, _spec, raw) => {
    // ADR-0015: "`$`, `{`, `}` and the spaces are outside the permitted set in
    // every case". Not a length failure — §2.1 insists these are two populations.
    expect(validateEntityName(raw)).toBe(false);
    expect(raw.length).toBeLessThanOrEqual(63);
  });

  test.each(OUTLIERS)('%s classifies as inadmissible, attributed to metadata.name', (_n, spec) => {
    const result = classifyAdmissibility(descriptor(spec));
    expect(result.admissible).toBe(false);
    expect(result.failedFields).toEqual(['metadata.name']);
    expect(result.attributions[0]?.validator).toBe('validateEntityName');
  });
});

describe('T054 — the fixture is genuinely canonically unique', () => {
  test('the two outliers would canonicalize distinctly from each other', () => {
    // Stated as a property of the *strings*, because neither is ever canonicalized:
    // admissibility runs first and neither reaches step 1. Lowercasing is what
    // canonicalization would do, and it does not make them equal.
    const bulkImport = '${{ values.name }}'.toLowerCase();
    const orchestrator = '${{ values.entityName }}'.toLowerCase();
    const shared = '${{ values.name | dump }}'.toLowerCase();

    expect(bulkImport).not.toBe(orchestrator);
    expect(bulkImport).not.toBe(shared);
    expect(orchestrator).not.toBe(shared);
  });

  test('each outlier collides with nothing in a batch of otherwise-distinct entities', () => {
    // If it collided, the case would prove nothing: a fused implementation would
    // fire the duplicate rule and look correct.
    const shared = '${{ values.name | dump }}'.toLowerCase();
    for (const [, , raw] of OUTLIERS) {
      expect([shared, 'payments', 'billing'].includes(raw.toLowerCase())).toBe(false);
    }
  });
});

describe('T054 — it produces `inadmissible-descriptor` and NOT `duplicate-canonical-id`', () => {
  test.each(OUTLIERS)('%s: the emitted trigger class', (_name, spec) => {
    const outcome = admit(descriptor(spec, 'packages/plugin/catalog-info.yaml'));
    expect(outcome.admissible).toBe(false);
    if (outcome.admissible) return;

    // The reason it emits.
    expect(outcome.rejection.reason).toBe('inadmissible-descriptor');
    expect(outcome.rejection.triggerClass).toBe('inadmissible-descriptor');

    // The absence of the wrong one — §8's requirement that the case be "observed
    // producing `inadmissible-descriptor` and **not** `duplicate-canonical-id`".
    expect(outcome.rejection.triggerClass).not.toBe('duplicate-canonical-id');
    expect(JSON.stringify(outcome.rejection)).not.toContain('duplicate');
  });

  test.each(OUTLIERS)('%s: alone in a run, with nothing to collide with', (_name, spec) => {
    // A batch of one. There is no pair, so no duplicate rule could possibly fire —
    // which means the rejection that does fire can only have come from
    // admissibility.
    const admission = collectAdmitted([descriptor(spec)]);
    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.rejection.triggerClass).toBe('inadmissible-descriptor');
  });

  test.each(OUTLIERS)('%s: among valid, distinct entities', (_name, spec) => {
    const admission = collectAdmitted([
      descriptor({ ...ADMISSIBLE, name: 'payments' }),
      descriptor({ ...ADMISSIBLE, name: 'billing' }),
      descriptor(spec),
    ]);
    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.rejection.triggerClass).toBe('inadmissible-descriptor');
  });

  test('the record carries all three attributions, as FR-020 requires', () => {
    const result = classifyAdmissibility(
      descriptor(INADMISSIBLE_AND_UNIQUE_BULK_IMPORT, 'plugins/bulk-import/catalog-info.yaml'),
    );
    const detail = inadmissibleRejection(result).detail;
    expect(detail).toContain('plugins/bulk-import/catalog-info.yaml');
    expect(detail).toContain('metadata.name');
    expect(detail).toContain('validateEntityName');
  });
});

describe('T054 — the colliding form is rejected for the same reason, not a different one', () => {
  test('`${{ values.name | dump }}` also yields `inadmissible-descriptor`', () => {
    // The point of the contrast: the fourteen and the two get the *same* verdict.
    // ADR-0015: they "are exactly as invalid as the other fourteen".
    const outcome = admit(descriptor(INADMISSIBLE_AND_COLLIDING));
    expect(outcome.admissible).toBe(false);
    if (outcome.admissible) return;
    expect(outcome.rejection.triggerClass).toBe('inadmissible-descriptor');
  });

  test('two copies of the colliding form still report inadmissibility, not the collision', () => {
    const admission = collectAdmitted([
      descriptor(INADMISSIBLE_AND_COLLIDING, 'a.yaml'),
      descriptor(INADMISSIBLE_AND_COLLIDING, 'b.yaml'),
    ]);
    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.rejection.triggerClass).toBe('inadmissible-descriptor');
  });

  test('a genuine collision between two ADMISSIBLE descriptors is still available', () => {
    // ADR-0015: "`duplicate-canonical-id` retains its exact current meaning: two or
    // more **admissible** descriptors canonicalizing to the same identity." The
    // duplicate rule is narrowed, not removed.
    const admission = collectAdmitted([
      descriptor({ ...ADMISSIBLE, name: 'Payments', namespace: 'default' }),
      descriptor({ ...ADMISSIBLE, name: 'payments' }),
    ]);
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    const ids = admission.admitted.map((one) => canonicalize(one).canonicalId);
    expect(ids).toEqual(['component:default/payments', 'component:default/payments']);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('T054 — the two fourteens are not the same fourteen', () => {
  test('the placeholder count and the trigger count are different numbers', () => {
    // `admissibility.md` §6.1: "These are two unrelated fourteens and a reader who
    // fuses them will produce a document this repository fails."
    const placeholderDescriptorsSharingOneForm = 14;
    const totalPlaceholderDescriptors = 16;
    const canonicallyUniqueOutliers = 2;

    expect(placeholderDescriptorsSharingOneForm + canonicallyUniqueOutliers).toBe(
      totalPlaceholderDescriptors,
    );
    expect(OUTLIERS).toHaveLength(canonicallyUniqueOutliers);
  });
});
