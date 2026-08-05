/**
 * T058 · T059 — the **five** ordered annotation decode steps, each with its own
 * distinct rejection reason.
 *
 * `owned-paths-annotation.md` §1 fixes the order and forbids two shortcuts by name:
 * it is processed "in exactly this order, never reversed and never short-circuited
 * by a type coercion".
 *
 * | # | Step | Distinct rejection |
 * |---|---|---|
 * | 1 | Presence check, via an explicit discriminant | none — yields `annotation-absent` |
 * | 2 | **String-scalar check on the raw node**, before any parse | `annotation-value-not-a-string` |
 * | 3 | `JSON.parse` | `parse-error` |
 * | 4 | Shape: exactly `array<string>` | `wrong-shape` |
 * | 5 | Per-pattern glob validation | the glob dialect's own reasons |
 *
 * # Step 2 is the one that is easy to omit and expensive to omit (T059, FR-027)
 *
 * §1 step 2, and §3's own restatement of it, are unusually emphatic, and the reason
 * is a language-level fact rather than a style preference: ECMA-262 defines
 * `JSON.parse(text)` as first coercing `text` to a string via `ToString`. So a
 * non-string YAML node is **not** rejected by `JSON.parse` — the one-element
 * sequence `["[]"]` is coerced to the string `"[]"`, parses cleanly as an empty
 * array, and is then **misclassified as `explicit-empty`**.
 *
 * A misclassification is worse than a crash here: `explicit-empty` is a *legitimate*
 * state meaning "this entity deliberately owns nothing", so the failure would be
 * silent and would look like a considered decision by the descriptor's author.
 *
 * The TypeScript signature of `JSON.parse` provides **no** runtime protection: it
 * declares a `string` parameter, and a value arriving from YAML is `unknown`. Only
 * the explicit `typeof rawNode === 'string'` pre-parse check does. That check is
 * {@link decodeAnnotation} step 2, and its permanent negative case is
 * `test/annotation-step2-raw-node.test.ts`.
 *
 * @see `specs/009-catalog-binding-viability/contracts/owned-paths-annotation.md` §1, §3
 * @see `specs/010-catalog-backstage/data-model.md` §6
 */

import type { Rejection } from '../diagnostics.ts';

/** The annotation key. Ownership is derived from this key alone (FR-025). */
export const OWNED_PATHS_ANNOTATION = 'adrkit.io/owned-paths';

/** `data-model.md` §6. */
export type AnnotationRejectionReason =
  | 'annotation-value-not-a-string'
  | 'parse-error'
  | 'wrong-shape';

/** `data-model.md` §6's diagnostic record, carrying each step's outcome. */
export interface OwnedPathsAnnotation {
  /** Explicit discriminant. Never inferred from a raw value being `undefined`. */
  readonly annotationPresent: boolean;
  readonly rawNodeIsString: boolean | undefined;
  readonly jsonParseOutcome: 'parsed' | 'parse-error' | 'not-a-string' | undefined;
  readonly shapeOutcome: 'array-of-strings' | 'wrong-shape' | undefined;
  readonly rejectionReason: AnnotationRejectionReason | undefined;
}

/** What steps 1–4 produced, when they produced anything. */
export interface DecodedAnnotation {
  readonly diagnostics: OwnedPathsAnnotation;
  /** `undefined` when the annotation was absent; otherwise the decoded array. */
  readonly patterns: readonly string[] | undefined;
}

/**
 * A decode outcome.
 *
 * The failure branch carries `diagnostics` as well as the rejection, because
 * `data-model.md` §6's record is a *diagnostic* type: it exists to say which step
 * reached which outcome, and discarding it on failure would discard exactly the
 * case it was designed to describe.
 */
export type AnnotationDecodeResult =
  | { readonly ok: true; readonly value: DecodedAnnotation }
  | {
      readonly ok: false;
      readonly rejection: Rejection<AnnotationRejectionReason>;
      readonly diagnostics: OwnedPathsAnnotation;
    };

/** The step number each rejection reason belongs to, for SC-006's per-step claim. */
export const ANNOTATION_REJECTION_STEP: Record<AnnotationRejectionReason, number> = {
  'annotation-value-not-a-string': 2,
  'parse-error': 3,
  'wrong-shape': 4,
};

/**
 * The trigger class each annotation rejection maps to.
 *
 * `data-model.md` §8 carries `invalid-annotation-parse` and
 * `invalid-annotation-shape` as separate classes. Step 2's failure is grouped with
 * the parse class because it is a rejection *of the value handed to the parser* —
 * and it is kept distinct at the `reason` level, which is what
 * `owned-paths-annotation.md` §1 actually requires ("the distinct reason
 * `annotation-value-not-a-string`", "**not** the same reason as step 2's non-string
 * failure or step 4's shape failure").
 */
const REASON_TRIGGER = {
  'annotation-value-not-a-string': 'invalid-annotation-parse',
  'parse-error': 'invalid-annotation-parse',
  'wrong-shape': 'invalid-annotation-shape',
} as const;

const ABSENT: OwnedPathsAnnotation = {
  annotationPresent: false,
  rawNodeIsString: undefined,
  jsonParseOutcome: undefined,
  shapeOutcome: undefined,
  rejectionReason: undefined,
};

function reject(
  reason: AnnotationRejectionReason,
  diagnostics: OwnedPathsAnnotation,
  detail: string,
): AnnotationDecodeResult {
  return {
    ok: false,
    rejection: { reason, triggerClass: REASON_TRIGGER[reason], detail },
    diagnostics,
  };
}

/**
 * Steps 1–4 of `owned-paths-annotation.md` §1.
 *
 * `present` is supplied by the caller as an explicit discriminant rather than
 * derived here from `rawNode === undefined`: §1 step 1 requires exactly that, since
 * a YAML key authored with no value is *present* and `null`, and inferring absence
 * from `undefined` would silently reclassify it.
 *
 * Step 5 (per-pattern glob validation) is deliberately **not** performed here.
 * `glob-dialect.md` owns it, and keeping it in `ownership/derive.ts` is what makes
 * "only after steps 1–4 succeed does each string element proceed" observable rather
 * than assumed.
 */
export function decodeAnnotation(present: boolean, rawNode: unknown): AnnotationDecodeResult {
  // Step 1 — presence.
  if (!present) return { ok: true, value: { diagnostics: ABSENT, patterns: undefined } };

  // Step 2 — string-scalar check on the raw node, BEFORE any JSON.parse.
  if (typeof rawNode !== 'string') {
    return reject(
      'annotation-value-not-a-string',
      {
        annotationPresent: true,
        rawNodeIsString: false,
        jsonParseOutcome: 'not-a-string',
        shapeOutcome: undefined,
        rejectionReason: 'annotation-value-not-a-string',
      },
      `${OWNED_PATHS_ANNOTATION} must be a YAML string scalar; observed ${describe(rawNode)}. ` +
        'It was not passed to JSON.parse, which would have coerced it via ToString.',
    );
  }

  // Step 3 — JSON decode. Only a present string scalar reaches this line.
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawNode) as unknown;
  } catch (error) {
    return reject(
      'parse-error',
      {
        annotationPresent: true,
        rawNodeIsString: true,
        jsonParseOutcome: 'parse-error',
        shapeOutcome: undefined,
        rejectionReason: 'parse-error',
      },
      `${OWNED_PATHS_ANNOTATION} is not valid JSON: ${(error as Error).message}`,
    );
  }

  // Step 4 — shape. Exactly `array<string>`; nothing is ever coerced.
  const shapeFailure = describeShapeFailure(decoded);
  if (shapeFailure !== undefined) {
    return reject(
      'wrong-shape',
      {
        annotationPresent: true,
        rawNodeIsString: true,
        jsonParseOutcome: 'parsed',
        shapeOutcome: 'wrong-shape',
        rejectionReason: 'wrong-shape',
      },
      `${OWNED_PATHS_ANNOTATION} must decode to an array of strings; ${shapeFailure}`,
    );
  }

  return {
    ok: true,
    value: {
      diagnostics: {
        annotationPresent: true,
        rawNodeIsString: true,
        jsonParseOutcome: 'parsed',
        shapeOutcome: 'array-of-strings',
        rejectionReason: undefined,
      },
      patterns: decoded as readonly string[],
    },
  };
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `a YAML sequence (${JSON.stringify(value)})`;
  if (typeof value === 'object') return 'a YAML mapping';
  return `a ${typeof value}`;
}

/** `undefined` when the decoded value is exactly `array<string>`. */
function describeShapeFailure(decoded: unknown): string | undefined {
  if (!Array.isArray(decoded)) {
    if (decoded === null) return 'observed null';
    if (typeof decoded === 'object') return 'observed a JSON object';
    return `observed a bare ${typeof decoded}`;
  }
  for (const [index, element] of decoded.entries()) {
    if (typeof element !== 'string') {
      return `element ${index} is ${element === null ? 'null' : Array.isArray(element) ? 'a nested array' : `a ${typeof element}`}`;
    }
  }
  return undefined;
}
