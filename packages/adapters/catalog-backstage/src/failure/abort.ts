/**
 * T073 — whole-operation abort: no partial envelope, no partial file, no truncated
 * stream, and a non-zero exit status.
 *
 * # The rule, and the mistake it forecloses
 *
 * `atomic-fail-closed.md` §1: any invalid input "MUST abort the **entire** run with
 * non-zero status and produce **no usable partial snapshot**, including for entities
 * that would otherwise have validated cleanly in the same run." §1 then names the one
 * implementation mistake this exists to prevent: *"skip the bad entity and keep
 * going"* — "explicitly wrong under this contract, regardless of how reasonable it
 * might seem as a convenience."
 *
 * # How "no usable partial output" is made structural rather than promised
 *
 * Three separate mechanisms, because each closes a different route to a partial
 * artifact and none of them closes the others:
 *
 * 1. **The failure branch carries no envelope.** {@link GenerationOutcome} is a
 *    discriminated union whose `ok: false` arm has no `envelope` member at all. There
 *    is no field a caller could read a half-built snapshot out of, so "use the
 *    partial output" is not a thing a caller can express.
 * 2. **Nothing is written before the whole pipeline has succeeded.** `pipeline.ts`
 *    assembles the envelope in memory and only then hands it to `envelope/write.ts`.
 *    An abort therefore happens strictly before any write is attempted, so there is
 *    no partial file to clean up — which matters, because cleanup can fail.
 * 3. **The write itself is atomic.** `envelope/write.ts` writes to a temporary file in
 *    the destination directory and `rename`s it into place. A crash mid-write leaves
 *    the temporary file, never a truncated envelope at the destination path. This is
 *    what closes "no truncated stream", which mechanisms 1 and 2 do not: they prevent
 *    an *intentional* partial write, not an interrupted complete one.
 *
 * # Exit status
 *
 * FR-034 requires a non-zero **process** exit status. This module owns the mapping
 * from an outcome to that status; it deliberately does not call `process.exit` itself,
 * because a library that terminates its host process cannot be tested by the host it
 * terminated. {@link exitCodeFor} is the seam, and `test/abort.test.ts` spawns a real
 * subprocess through it so the non-zero status is an observed process exit rather than
 * an asserted constant.
 *
 * @see `specs/010-catalog-backstage/contracts/atomic-fail-closed.md` §1, §2, §3
 * @see `specs/010-catalog-backstage/spec.md` FR-034
 */

import type { Rejection, TriggerClass } from './triggers.ts';

/** `data-model.md` §8. */
export interface AtomicFailureRecord {
  readonly triggerClass: TriggerClass;
  /** Human-readable. `data-model.md` §8: "never load-bearing". */
  readonly detail: string;
  readonly sourcePath: string | undefined;
  readonly documentIndex: number | undefined;
  /**
   * The validator's own fine-grained reason.
   *
   * Beyond `data-model.md` §8's four fields, and carried deliberately: ADR-0016
   * records the **exact emitted string**, and fifteen trigger classes cannot
   * distinguish which of seven lexical path rules fired. `src/diagnostics.ts` makes
   * the same argument for carrying both on a {@link Rejection}. Reported as a §8
   * extension rather than treated as settled.
   */
  readonly reason: string;
  /** The pipeline stage that produced the abort. See `pipeline.ts`. */
  readonly stage: string;
}

/** Where a rejection happened, when the pipeline knows. */
export interface FailureLocation {
  readonly sourcePath?: string | undefined;
  readonly documentIndex?: number | undefined;
}

/**
 * Turn one validator {@link Rejection} into the run's single
 * {@link AtomicFailureRecord}.
 *
 * Exactly one record per abort — see `failure/classify.ts`, which owns the
 * exactly-one and correct-class properties. This function is the constructor those
 * properties are asserted about.
 */
export function abortRecord(
  rejection: Rejection,
  stage: string,
  location: FailureLocation = {},
): AtomicFailureRecord {
  return {
    triggerClass: rejection.triggerClass,
    detail: rejection.detail,
    sourcePath: location.sourcePath,
    documentIndex: location.documentIndex,
    reason: rejection.reason,
    stage,
  };
}

/** The exit status a successful run reports. */
export const EXIT_OK = 0;

/**
 * The exit status **every** abort reports, whichever of the fifteen triggers fired.
 *
 * One value rather than a per-trigger code, because `atomic-fail-closed.md` §4.2 says
 * the consequence "applies identically regardless of which named trigger, or the
 * backstop, fired". A per-trigger exit code would make the consequence vary by
 * trigger, which is exactly what the contract denies.
 */
export const EXIT_ABORT = 1;

/**
 * The result of one generation run.
 *
 * The failure arm has no `envelope` field. That absence is the type-level statement of
 * §1's "no usable partial snapshot": a caller cannot read one out because there is
 * nowhere for one to be.
 */
export type GenerationOutcome<TEnvelope> =
  | {
      readonly ok: true;
      readonly envelope: TEnvelope;
      /** Every stage entered, in order. See `pipeline.ts`. */
      readonly stages: readonly string[];
    }
  | {
      readonly ok: false;
      readonly failure: AtomicFailureRecord;
      readonly stages: readonly string[];
    };

/** FR-034's non-zero status, as a pure mapping. */
export function exitCodeFor(outcome: GenerationOutcome<unknown>): number {
  return outcome.ok ? EXIT_OK : EXIT_ABORT;
}

/**
 * The envelope produced by a run, or `undefined` if it aborted.
 *
 * A helper rather than a property access, so that the one place a caller is tempted to
 * write `outcome.envelope` unconditionally has a total function to reach for instead.
 * It returns `undefined` on the failure branch because there is no partial envelope —
 * not because one is being withheld.
 */
export function envelopeOf<TEnvelope>(
  outcome: GenerationOutcome<TEnvelope>,
): TEnvelope | undefined {
  return outcome.ok ? outcome.envelope : undefined;
}
