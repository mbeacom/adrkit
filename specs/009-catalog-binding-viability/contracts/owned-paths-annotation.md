# Contract: `adrkit.io/owned-paths` Annotation Decoding, Validation, and Three-State Diagnostics

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-003, FR-008,
User Story 1 (all 8 acceptance scenarios), SC-001, SC-004. Companion to
`data-model.md` §1 (`OwnedPathsAnnotation`), §8 (`CatalogEntityRecord`).
Normative source: ADR-0012 "The annotation."

## 1. Decode-Then-Validate Order (FR-003)

The annotation value MUST be processed in exactly this order, never reversed
and never short-circuited by a type coercion:

1. **Presence check.** If `metadata.annotations['adrkit.io/owned-paths']` is
   absent from the descriptor entirely, stop here: `ownershipState =
   "annotation-absent"` (§3). No JSON parsing is attempted.
2. **JSON decode.** If present, attempt `JSON.parse(rawValue)`. A decode
   failure (malformed JSON — e.g. an unescaped quote inside the string) is
   rejected with the distinct reason `"parse-error"` — **not** the same
   reason as step 3's shape failure, and never coerced into a fallback empty
   array.
3. **Shape validation.** The decoded value MUST be exactly `array<string>`.
   Any of the following is rejected with the distinct reason `"wrong-shape"`:
   a JSON object; a bare string (not wrapped in an array); a bare number or
   boolean; an array containing any non-string element (a number, an object,
   `null`, a nested array). None of these is ever coerced (e.g. a bare string
   is never treated as a single-element array).
4. **Per-pattern validation.** Only after steps 1–3 succeed does each string
   element proceed to `contracts/glob-dialect.md`'s validator.

**Worked example — the shape-error/parse-error distinction**:

| Raw annotation value | Step 2 outcome | Step 3 outcome | Final rejection reason |
|---|---|---|---|
| `'["packages/payments/**"]'` | parsed | array of strings | none — proceeds to per-pattern validation |
| `'{"paths": ["a/**"]}'` | parsed | not an array | `"wrong-shape"` |
| `'"packages/payments/**"'` | parsed | bare string, not an array | `"wrong-shape"` |
| `'["packages/payments/**", 3]'` | parsed | array containing a non-string element | `"wrong-shape"` |
| `'["packages/payments/**"` (missing closing bracket) | fails to parse | n/a | `"parse-error"` |

## 2. Order Independence From Atomicity (FR-007 Interaction)

This contract defines only the **per-annotation** classification. Whether a
classification failure aborts the entire snapshot-generation run (it always
does, per `contracts/atomic-fail-closed.md`) is a separate, whole-operation
concern — User Story 1 tests per-pattern/per-annotation classification "in
isolation" (Acceptance Scenario 2's own wording); User Story 2 separately
tests that introducing exactly one such failure into an otherwise-valid batch
aborts the whole run. This contract MUST NOT be read as implying a
classification failure is ever recoverable at the single-entity level.

## 3. The Three-State Ownership Discriminator (FR-008; SC-004)

Every entity's derived ownership, once its annotation (if any) has passed
validation, is recorded as **exactly one** of three discriminator values —
never a fourth state, never left recoverable only from prose:

| State | Condition | `derivedPaths` |
|---|---|---|
| `explicit-paths` | The annotation is present, decodes and validates successfully, and the resulting array is **non-empty** after every element passes `contracts/glob-dialect.md`'s validator. | Sorted (`compareCodeUnits`), deduplicated, non-empty. |
| `explicit-empty` | The annotation is present and **decodes** (via `JSON.parse`, per §1 step 2) to an array of length zero. **This is a decoded-value check, never a raw-string equality check** — `'[]'`, `'[ ]'`, `'[\n]'`, and any other JSON text that decodes to `[]` all qualify identically; the classification happens strictly after JSON decoding, exactly as §1's decode-then-validate order requires, never before it. | `[]` |
| `annotation-absent` | The annotation key is wholly absent from `metadata.annotations`. | `[]` |

**Non-string annotation values are rejected before JSON decoding is
attempted.** A descriptor's `adrkit.io/owned-paths` annotation value, as read
from the surrounding YAML, MUST itself be a YAML string scalar — Backstage's
own annotation model requires every annotation value to be a string
(`metadata.annotations` is `Record<string, string>`). If a synthetic fixture
deliberately authors a non-string YAML value under this key (e.g. a YAML
sequence or mapping, rather than a quoted JSON-in-a-string), that is rejected
with the distinct reason `"annotation-value-not-a-string"` — **before** step
2's `JSON.parse` is even attempted, since `JSON.parse` itself requires a
string input and passing a non-string value to it would be a language-level
type error, not a JSON parse error. This is a fourth possible
`OwnedPathsAnnotation.jsonParseOutcome` value alongside `"parsed"` and
`"parse-error"` (`data-model.md` §1), never silently coerced (e.g. by
stringifying the YAML value first).

**Non-conflation rule**: `explicit-empty` and `annotation-absent` both
produce an empty `derivedPaths` array, but they MUST NOT be treated as
equivalent anywhere in the evidence bundle or the snapshot envelope — each
entity's record carries the discriminator as its own explicit field (never
inferring the distinction from `derivedPaths` alone, which is identical `[]`
for both). This mirrors ADR-0012's own explicit instruction: "snapshot/
evidence metadata MUST preserve `explicit-empty` versus `annotation-absent`
for diagnostics."

**`explicit-paths` is this spec's own added label, not the maintainer's
literal text.** ADR-0012 and the Ratification Record name only
`explicit-empty` and `annotation-absent` explicitly; `spec.md`'s Overview adds
`explicit-paths` as the third, complementary label so every entity has a
defined discriminator value, not only the two states the maintainer's
decision named. A future execution session MUST use `explicit-paths` for the
non-empty, valid case — never leave it unlabeled or invent an alternate term.

## 4. Single-Element Empty-String Edge Case (Spec Edge Cases Section)

`["", "packages/**"]` and `[""]` are **not** `explicit-empty` — an
`explicit-empty` value is `[]` exactly. A single empty-string *element*
inside an otherwise well-formed, non-empty array is rejected per
`contracts/glob-dialect.md`'s `"empty"` pattern rule (a per-pattern
validation failure), which — per `contracts/atomic-fail-closed.md` — aborts
the whole operation. This is a distinct failure mode from the `[]` vs.
absent distinction in §3 and MUST NOT be conflated with it.

## 5. Determinism (SC-001)

For any fixed, valid annotation input, running steps 1–4 above (and
`contracts/glob-dialect.md`'s sort/dedupe) three or more times MUST produce
byte-identical `derivedPaths` output every time — including sort order and
deduplication. Non-determinism anywhere in this pipeline (e.g. an
unstable-sort artifact, or a `Set` iteration order dependency) is itself an
`SC-012`/`no-go`-triggering finding.
