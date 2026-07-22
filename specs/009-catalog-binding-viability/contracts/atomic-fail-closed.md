# Contract: Whole-Operation Atomic Fail-Closed Semantics

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-007, User
Story 2 (all 5 acceptance scenarios), SC-002. Companion to `data-model.md`
§6 (`AtomicFailureRecord`). Normative source: ADR-0012 "Atomic fail-closed
semantics."

## 1. The Rule, Stated Precisely

**Any** invalid input encountered during a single snapshot-generation run —
including but not limited to a duplicate canonical ID/ref, a duplicate YAML
key, malformed or wrongly-shaped JSON, a rejected pattern, an unsupported
snapshot version/capability, a repository mismatch, or an incomplete
required source — MUST abort the **entire** run with non-zero status and
produce **no usable partial snapshot**, including for entities that would
otherwise have validated cleanly in the same run. This supersedes any
narrower, per-entity reading of "fail closed." **The single most likely
implementation mistake this contract exists to foreclose is "skip the bad
entity and keep going"** — that behavior is explicitly wrong under this
contract, regardless of how reasonable it might seem as a convenience.

## 2. Distinguishing Per-Rule Validation From Whole-Operation Atomicity

This contract is a **separate, whole-operation property**, distinct from
`contracts/owned-paths-annotation.md`/`contracts/glob-dialect.md`'s
per-pattern/per-annotation classification. User Story 1 tests each
validation rule "in isolation" (one fixture, one violated rule at a time);
User Story 2 separately tests that introducing **exactly one** invalid
entity into an **otherwise-valid batch of five** aborts the whole six-entity
run, producing no snapshot at all — not even for the five that would have
validated cleanly. A future execution session MUST test both properties
independently; passing User Story 1's per-rule tests does not itself
demonstrate this contract.

## 3. Worked Example (User Story 2, Acceptance Scenario 2)

Given five valid entities plus a sixth with a duplicate canonical ID:

| Step | Expected outcome |
|---|---|
| Run generation over all six entities in one invocation | Exits non-zero |
| Inspect for a produced snapshot file | **None exists** — not even one covering the five otherwise-valid entities |
| Evidence bundle | Explicitly records that no snapshot — not even a partial one — was produced or is usable, distinguishing this from a hypothetical (and explicitly rejected) partial-success outcome |

This is the single most consequential correction the 2026-07-21T21:40:53Z
hardening decision made to the initial ratification (`spec.md`'s Ratification
Record), and the property most likely to be gotten wrong by an implementer
who assumes "fail closed" means "skip the bad one."

## 4. Trigger Enumeration (FR-007) — Closed Type, With an Explicit Backstop for FR-007's Own "Including But Not Limited To" Hedge

Every `AtomicFailureRecord.triggerClass` (`data-model.md` §6) MUST be one of
exactly these fourteen values. The type itself is closed (a fixed set of
string literals, never an open string), but the last value,
`other-invalid-input`, is a **deliberate, always-present backstop** that
exists specifically to honor FR-007's own "including but not limited to"
prose without leaving the data model's own type open-ended — mirroring the
same defensive-backstop pattern `contracts/glob-dialect.md` §3 already uses
for `"invalid-glob-compile-failure"`:

```text
duplicate-canonical-id | duplicate-canonical-ref | duplicate-yaml-key |
invalid-yaml-syntax | invalid-manifest-shape | invalid-annotation-shape |
invalid-annotation-parse | invalid-pattern | unsupported-manifest-version |
unsupported-snapshot-version | unsupported-capability |
repository-mismatch | incomplete-required-source | other-invalid-input
```

Two additions beyond the original eleven, closing gaps the reader test
found:

- **`invalid-yaml-syntax`**: a descriptor document that fails to parse for a
  YAML syntax reason **other than** a duplicate key (e.g. a malformed
  scalar, an unterminated flow collection) — `data-model.md` §5's
  `DescriptorDocument.parseOutcome` already names `"yaml-parse-error"` as a
  distinct outcome from `"duplicate-yaml-key"`, but the original eleven
  triggers had no corresponding `AtomicFailureRecord.triggerClass` for the
  non-duplicate-key case. This closes that gap.
- **`invalid-manifest-shape`**: the manifest itself fails to parse as JSON,
  or parses but has a field with the wrong JSON type, or contains an
  unrecognized top-level field (`contracts/input-manifest.md` §1's closed-
  schema rule) — distinct from `unsupported-manifest-version`, which
  presumes the manifest parsed correctly and has the right shape but
  declares an unsupported *value* for `manifestSchemaVersion` specifically.

A future execution session that encounters a genuinely new trigger class not
named by one of the first thirteen values above records it as
`other-invalid-input` (never invents an ad-hoc fifteenth string inline) and
flags this contract for its own future update — the abort/no-partial-output
consequence (§1 above) applies identically regardless of which named trigger
or the `other-invalid-input` backstop fired.

## 5. Four Manifest-Request-Level Rejections (User Story 2, Acceptance Scenario 4)

Distinct from the per-entity/per-annotation triggers above, these four are
properties of the manifest/generation request as a whole and are detailed in
`contracts/input-manifest.md` §2 and §4: `unsupported-manifest-version`,
`unsupported-snapshot-version`, `unsupported-capability`, and
`incomplete-required-source`. All four abort before any entity's paths are
derived, exactly like every other trigger in §4's enumeration.

## 6. What This Contract Does Not Cover

Repository-identity matching's own comparison algorithm is
`contracts/input-manifest.md` §3's concern; this contract only fixes that a
`repository-mismatch` outcome is one of the fourteen triggers and that its
consequence (whole-operation abort, no partial output) is identical to every
other trigger's consequence. Consumer-side envelope rejection (a loaded
envelope failing validation) is a distinct, later-stage concern covered by
`contracts/snapshot-envelope.md` — this contract governs only the
**generation-time** atomicity rule.
