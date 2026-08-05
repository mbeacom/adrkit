# Contract: Whole-Operation Atomic Fail-Closed Semantics (Production, **Fifteen** Triggers)

**Feature**: `010-catalog-backstage` | **Freezes**: FR-030 through FR-038,
User Story 3, SC-004, SC-005. Companion to `data-model.md` §8
(`AtomicFailureRecord`), §4 (`AdmissibilityResult`).
**Normative sources**: ADR-0012 "Atomic fail-closed semantics"; ADR-0015
Condition of Acceptance 2.
**Supersedes for this feature**:
`specs/009-catalog-binding-viability/contracts/atomic-fail-closed.md`.

## 0. Why this contract is restated rather than cited

Every other adopted spike-009 contract is **cited** from its original
location (see `README.md` §2). This one is restated in full for exactly one
reason: **the trigger count changed**. The 009 contract says "exactly these
**fourteen** values" at its §4 (lines 52–67). This feature has **fifteen**.
Citing a document that names a different number would leave a reader holding
the wrong closed set.

Everything below other than the added trigger is the 009 contract's content,
carried faithfully.

## 1. The Rule, Stated Precisely

**Any** invalid input encountered during a single snapshot-generation run —
including but not limited to a duplicate canonical ID/ref, a duplicate YAML
key, malformed or wrongly-shaped JSON, a rejected pattern, an unsupported
snapshot version/capability, a repository mismatch, an incomplete required
source, **or an inadmissible descriptor** — MUST abort the **entire** run with
non-zero status and produce **no usable partial snapshot**, including for
entities that would otherwise have validated cleanly in the same run. This
supersedes any narrower, per-entity reading of "fail closed."

**The single most likely implementation mistake this contract exists to
foreclose is "skip the bad entity and keep going"** — that behaviour is
explicitly wrong under this contract, regardless of how reasonable it might
seem as a convenience.

## 2. Distinguishing Per-Rule Validation From Whole-Operation Atomicity

This is a **separate, whole-operation property**, distinct from the
per-pattern/per-annotation classification in
`specs/009-catalog-binding-viability/contracts/owned-paths-annotation.md` and
`.../glob-dialect.md`.

Per-rule tests exercise each validation rule **in isolation** — one fixture,
one violated rule at a time. This contract is tested **separately**: introduce
**exactly one** invalid entity into an **otherwise-valid batch**, and confirm
the whole run aborts, producing no snapshot at all — not even for the entities
that would have validated cleanly.

**Passing the per-rule tests does not demonstrate this contract.** The two
properties MUST be tested independently.

## 3. Worked Example

Given five valid entities plus a sixth with a duplicate canonical ID:

| Step | Required outcome |
|---|---|
| Run generation over all six entities in one invocation | Exits non-zero |
| Inspect the output location for a produced envelope | **None exists** — not even one covering the five otherwise-valid entities |
| Evidence | Explicitly records that no envelope — not even a partial one — was produced or is usable, distinguishing this from a hypothetical (and explicitly rejected) partial-success outcome |

The same table holds with the sixth entity replaced by an **inadmissible**
descriptor (§5). The consequence does not vary by trigger.

## 4. Trigger Enumeration — Closed Type of **Fifteen** Values

Every `AtomicFailureRecord.triggerClass` (`data-model.md` §8) MUST be one of
exactly these **fifteen** values. The type is closed — a fixed set of string
literals, never an open `string`:

```text
duplicate-canonical-id | duplicate-canonical-ref | duplicate-yaml-key |
invalid-yaml-syntax | invalid-manifest-shape | invalid-annotation-shape |
invalid-annotation-parse | invalid-pattern | unsupported-manifest-version |
unsupported-snapshot-version | unsupported-capability |
repository-mismatch | incomplete-required-source |
inadmissible-descriptor | other-invalid-input
```

### 4.1 Provenance of the count

| Source | What it says |
|---|---|
| `specs/009-catalog-binding-viability/contracts/atomic-fail-closed.md` §4, lines 52–67 | "exactly these **fourteen** values", listing all but `inadmissible-descriptor` |
| Search across `specs/009-catalog-binding-viability/**` | `inadmissible-descriptor` appears **nowhere** |
| ADR-0015 Condition of Acceptance 2 | Requires the trigger be carried onto the atomic surfaces; ADR-0015 is its only source |
| Spec FR-035 | Fourteen "is correct for spike 009 and **wrong for this feature**; it MUST NOT be copied across" |

**Fourteen is the spike's number. Fifteen is this feature's number.** An
artifact of this feature that says fourteen is wrong.

### 4.2 `other-invalid-input` is a deliberate backstop, not a spare slot

The last value is a **deliberate, always-present backstop** that exists
specifically to honour the "including but not limited to" hedge in the prose
rule without leaving the data model's own type open-ended — mirroring the same
defensive-backstop pattern used for `"invalid-glob-compile-failure"` at
`glob-dialect.md` §3 rule 15.

An implementation that encounters a genuinely new trigger class not named by
one of the **first fourteen** values records it as `other-invalid-input` — it
**never** invents an ad-hoc sixteenth string inline — and flags this contract
for update. The abort/no-partial-output consequence (§1) applies identically
regardless of which named trigger, or the backstop, fired.

### 4.3 Two triggers that are easy to collapse into one, and must not be

- **`duplicate-yaml-key`** vs **`invalid-yaml-syntax`**: a descriptor that
  fails to parse for a YAML syntax reason **other than** a duplicate key (a
  malformed scalar, an unterminated flow collection) is `invalid-yaml-syntax`.
  `data-model.md` §3's `DescriptorDocument.parseOutcome` carries the same
  two-way distinction.
- **`invalid-manifest-shape`** vs **`unsupported-manifest-version`**: the
  former is the manifest failing to parse as JSON, or parsing with a field of
  the wrong JSON type, or carrying an unrecognized top-level field (the
  closed-schema rule at `input-manifest.md` §1). The latter presumes the
  manifest parsed correctly **and** has the right shape, but declares an
  unsupported *value* for `manifestSchemaVersion` specifically.

## 5. `inadmissible-descriptor` — the added trigger

**Authority**: ADR-0015 and its Condition of Acceptance 2. This feature is
ADR-0015's designated follow-up, and carrying this trigger onto the atomic
surface is the specific obligation being discharged.

**When it fires.** A descriptor document fails the four-field admissibility
predicate specified at `admissibility.md` — that is, `AdmissibilityResult
.admissible === false` (`data-model.md` §4).

**Ordering, and why it is load-bearing.** Admissibility is evaluated **before**
canonicalization (ADR-0015's decision that admissibility is a *precondition
of* canonicalization). The concrete consequence: an inadmissible descriptor
never acquires a `canonicalId`, so it can never participate in a
`duplicate-canonical-id` determination and can never be reported under that
trigger instead of its own. A design that canonicalizes first and checks
admissibility afterwards can produce exactly that misattribution, and is
non-conformant.

**Severity.** Fatal and whole-operation, identical to every other trigger.
Never a per-entity skip, never a warning, never a filtered-out entity. ADR-0015
CoA-2 is explicit that this is the point of carrying it here.

**Warrant limit that travels with this trigger.** What is warranted is **what
the pinned validator predicate returns when invoked** at Backstage commit
`1121a4facd9e321179d0402c3f355e4a649e84d9`. It is **not** warranted that a
Backstage deployment installs the policy, that a catalog backend rejects such a
descriptor, or that "Backstage requires" these fields. See `admissibility.md`
§4.

## 6. Four Manifest-Request-Level Rejections

Distinct from the per-entity/per-annotation triggers, these four are properties
of the manifest/generation request **as a whole**, detailed at
`input-manifest.md` §2 and §4:

```text
unsupported-manifest-version | unsupported-snapshot-version |
unsupported-capability | incomplete-required-source
```

All four abort **before any entity's paths are derived**, exactly like every
other trigger in §4.

**Count check.** `input-manifest.md` §2 supplies **three** of them (the
version/capability table); `input-manifest.md` §4 supplies the fourth
(`incomplete-required-source`). Three plus one is the four grouped here. Both
numbers are load-bearing and neither is a typo for the other.

## 7. What this contract does not cover

- **Repository-identity matching's own comparison algorithm** is
  `input-manifest.md` §3's concern. This contract fixes only that a
  `repository-mismatch` outcome is one of the fifteen triggers and that its
  consequence is identical to every other trigger's.
- **The admissibility predicate itself** is `admissibility.md`'s concern. This
  contract fixes only that its failure is trigger fifteen-of-fifteen by
  enumeration and fatal by severity.
- **Consumer-side envelope rejection** — a loaded envelope failing validation —
  is a distinct, later-stage concern covered by `snapshot-envelope.md` §2 and
  `data-model.md` §11. **This contract governs generation-time atomicity
  only.** A consumer rejecting an envelope is not an instance of this rule.

## 8. Standing honesty constraints

1. Never assert what Backstage-as-a-running-system does; the warrant is the
   pinned predicate's return value.
2. Never state a count not verified in the cited source. Every count above
   names where it was read.
3. This feature has produced no evidence. Every statement here is a
   **requirement**, never a report.
4. Per ADR-0016, none of these triggers counts as covered until its check has
   been **observed failing** against a fixture that violates it, before the
   implementation that makes it pass exists.
