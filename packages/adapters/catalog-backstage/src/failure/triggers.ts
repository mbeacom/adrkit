/**
 * T074 · T075 — the closed **fifteen**-value fatal trigger enumeration, presented to
 * the failure surface, and the `other-invalid-input` backstop.
 *
 * # This module re-exports the enumeration; it does not declare a second one
 *
 * `tasks.md` T074 asks for the enumeration "at `<ADAPTER>/src/failure/triggers.ts`".
 * It is *presented* here and **declared** exactly once, in `../diagnostics.ts`,
 * which Phase D authored for that purpose and whose own module note says so: "Phase E
 * should import {@link TriggerClass} from here rather than redeclare it — a second
 * declaration of a closed enumeration is the drift this file exists to prevent."
 *
 * A transcribed copy would satisfy the letter of "declare the union here" and defeat
 * its purpose. Two closed enumerations of the same thing can disagree, and the first
 * symptom of disagreement is a trigger that one module can produce and the other
 * cannot name. `contracts/atomic-fail-closed.md` §4 requires the type be closed; it
 * does not require it be closed twice.
 *
 * # The count is fifteen
 *
 * Verified in this worktree, not restated from memory:
 *
 * | Source | Read at | Says |
 * |---|---|---|
 * | `contracts/atomic-fail-closed.md` §4 | heading and body | "Closed Type of **Fifteen** Values" |
 * | `data-model.md` §8 | lines 334–351 | fifteen union members, `inadmissible-descriptor` marked "added for this feature" |
 * | `src/diagnostics.ts` | `TRIGGER_CLASSES` | fifteen entries |
 *
 * `specs/009-catalog-binding-viability/contracts/atomic-fail-closed.md` §4 says
 * **fourteen**, and that remains correct *about spike 009*. It is wrong about this
 * feature, and spec FR-035 says so in terms. {@link FATAL_TRIGGER_COUNT} is derived
 * from the array rather than written as a literal, so the number cannot be asserted
 * independently of the membership it is meant to count.
 *
 * @see `specs/010-catalog-backstage/contracts/atomic-fail-closed.md` §4, §4.2
 * @see `specs/010-catalog-backstage/data-model.md` §8
 */

import { TRIGGER_CLASSES, type Rejection, type TriggerClass } from '../diagnostics.ts';

export { TRIGGER_CLASSES, type Rejection, type TriggerClass };

/**
 * How many fatal trigger classes this feature has.
 *
 * Derived, never transcribed. A literal `15` here could stay right while the
 * enumeration changed underneath it, which is the failure mode the whole
 * fourteen-versus-fifteen trap consists of.
 */
export const FATAL_TRIGGER_COUNT: number = TRIGGER_CLASSES.length;

/**
 * The deliberate, always-present backstop.
 *
 * `atomic-fail-closed.md` §4.2: it "exists specifically to honour the 'including but
 * not limited to' hedge in the prose rule without leaving the data model's own type
 * open-ended". FR-036 adds that it "MUST remain a deliberate always-present backstop,
 * never a substitute for a more specific class that applies".
 *
 * **It is not dead code, and it must never be deleted as unreachable.** See
 * {@link otherInvalidInput} for the route by which this implementation actually
 * reaches it.
 */
export const BACKSTOP_TRIGGER = 'other-invalid-input' satisfies TriggerClass;

/**
 * The fourteen classes that are **not** the backstop.
 *
 * Exported so a check can assert that a rejection carrying one of these is never
 * rewritten to the backstop — FR-036's "never a substitute for a more specific class
 * that applies", expressed as data rather than as a rule in prose.
 *
 * Fourteen appears here as *fifteen minus the backstop*, which is a different
 * quantity from spike 009's fourteen-member enumeration. Both numbers are real and
 * they are not the same number.
 */
export const NAMED_TRIGGERS: readonly TriggerClass[] = TRIGGER_CLASSES.filter(
  (trigger) => trigger !== BACKSTOP_TRIGGER,
);

/**
 * Build a rejection under the backstop.
 *
 * # Why this is reachable, and not a formality
 *
 * The backstop's stated purpose is a genuinely invalid input that none of the
 * fourteen named classes describes. This implementation has exactly one such input,
 * and it is not contrived: the **annotation-provenance declaration** that
 * `envelope/provenance.ts` requires of every generation request. FR-043 makes the
 * declaration load-bearing, `data-model.md` §1's closed manifest schema has no field
 * to carry it, and so it arrives as part of the generation request rather than in the
 * manifest file.
 *
 * A request that omits a listed source's provenance, or declares one for a source the
 * manifest never listed, is invalid input. Walk the fourteen named classes and none
 * fits: it is not the manifest failing to parse or shape-check
 * (`invalid-manifest-shape` — the manifest is well-formed), not a version or
 * capability value, not a source digest or path, not YAML, not an annotation, not a
 * pattern, not a repository identity, not admissibility, and not a duplicate. That is
 * precisely the case §4.2 describes, so it records `other-invalid-input` and does not
 * invent a sixteenth string inline.
 *
 * @param reason a fine-grained reason string; kept distinct from the trigger class so
 * an ADR-0016 negative case can record the exact emitted string
 */
export function otherInvalidInput<TReason extends string>(
  reason: TReason,
  detail: string,
): Rejection<TReason> {
  return { reason, triggerClass: BACKSTOP_TRIGGER, detail };
}

/**
 * Whether `value` is a member of the closed enumeration.
 *
 * Used at the boundary where a trigger class arrives as data rather than as a typed
 * value — reading a recorded failure back, for instance. A closed type erased at
 * runtime is not closed at runtime, and this is what closes it there.
 */
export function isTriggerClass(value: unknown): value is TriggerClass {
  return typeof value === 'string' && (TRIGGER_CLASSES as readonly string[]).includes(value);
}
