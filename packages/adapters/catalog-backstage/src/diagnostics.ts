/**
 * The shared diagnostic vocabulary every Phase D validator in this package emits.
 *
 * **Why this file exists.** Phase D produces seven independent validator slices
 * (manifest schema, manifest version, repository identity, source digests, source
 * paths, admissibility, annotation decode, glob dialect). Each one reports a
 * *fine-grained* reason of its own, and each one also states which member of
 * `data-model.md` §8's closed trigger enumeration that reason belongs to. Declaring
 * the enumeration once, here, is what stops those two vocabularies from drifting
 * apart across eight files.
 *
 * **This file is not the failure-classification surface.** `tasks.md` Phase E owns
 * `src/failure/triggers.ts` and `src/failure/classify.ts`; those decide what an
 * assembled run *does* with a trigger. This module only names them, so a pure
 * validator can attribute its own rejection without importing anything that runs a
 * pipeline. Phase E should import {@link TriggerClass} from here rather than
 * redeclare it — a second declaration of a closed enumeration is the drift this
 * file exists to prevent.
 *
 * @see `specs/010-catalog-backstage/data-model.md` §8
 * @see `specs/009-catalog-binding-viability/contracts/atomic-fail-closed.md` §4
 */

/**
 * The closed trigger enumeration for **this feature**: exactly **fifteen** values.
 *
 * **The count is fifteen, and writing fourteen here is an error.** Spike 009's
 * `atomic-fail-closed.md` §4 fixes *its* enumeration at fourteen and that statement
 * remains correct as a statement about spike 009. This feature adds
 * `inadmissible-descriptor` (ADR-0015 Condition of Acceptance 2), which appears
 * nowhere under `specs/009-catalog-binding-viability/`. `data-model.md` §8 and
 * `contracts/admissibility.md` §5.1 both record the production count as fifteen.
 *
 * `other-invalid-input` is a **deliberate, always-present backstop**, not an
 * oversight: it exists so the type can stay closed while still honouring FR-007's
 * own "including but not limited to" hedge.
 */
export type TriggerClass =
  | 'duplicate-canonical-id'
  | 'duplicate-canonical-ref'
  | 'duplicate-yaml-key'
  | 'invalid-yaml-syntax'
  | 'invalid-manifest-shape'
  | 'invalid-annotation-shape'
  | 'invalid-annotation-parse'
  | 'invalid-pattern'
  | 'unsupported-manifest-version'
  | 'unsupported-snapshot-version'
  | 'unsupported-capability'
  | 'repository-mismatch'
  | 'incomplete-required-source'
  | 'inadmissible-descriptor'
  | 'other-invalid-input';

/**
 * Every member of {@link TriggerClass}, as data, in the order `data-model.md` §8
 * lists them.
 *
 * Exported so a test can assert the count and the membership against the frozen
 * contract rather than against the type — a type union is erased at runtime and
 * cannot be counted, so a type-only declaration would leave the "fifteen, not
 * fourteen" constraint untested.
 */
export const TRIGGER_CLASSES = [
  'duplicate-canonical-id',
  'duplicate-canonical-ref',
  'duplicate-yaml-key',
  'invalid-yaml-syntax',
  'invalid-manifest-shape',
  'invalid-annotation-shape',
  'invalid-annotation-parse',
  'invalid-pattern',
  'unsupported-manifest-version',
  'unsupported-snapshot-version',
  'unsupported-capability',
  'repository-mismatch',
  'incomplete-required-source',
  'inadmissible-descriptor',
  'other-invalid-input',
] as const satisfies readonly TriggerClass[];

/**
 * A rejection emitted by one Phase D validator.
 *
 * `reason` is the validator's own fine-grained code and is the string an ADR-0016
 * negative case records. `triggerClass` is the enumeration member that reason maps
 * onto. Both are carried because collapsing them loses information in one direction
 * or the other: fifteen trigger classes cannot distinguish which of six lexical
 * path rules fired, and a fine-grained reason alone does not say whether the run
 * aborts under a request-level or an entity-level class.
 */
export interface Rejection<TReason extends string = string> {
  readonly reason: TReason;
  readonly triggerClass: TriggerClass;
  /** Human-readable. Never load-bearing — `data-model.md` §8 says so explicitly. */
  readonly detail: string;
}

/** A validator outcome: either a value, or exactly one {@link Rejection}. */
export type Validated<TValue, TReason extends string = string> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly rejection: Rejection<TReason> };

/** Build a successful {@link Validated}. */
export function accepted<TValue>(value: TValue): Validated<TValue, never> {
  return { ok: true, value };
}

/** Build a rejected {@link Validated}. */
export function rejected<TReason extends string>(
  reason: TReason,
  triggerClass: TriggerClass,
  detail: string,
): Validated<never, TReason> {
  return { ok: false, rejection: { reason, triggerClass, detail } };
}
