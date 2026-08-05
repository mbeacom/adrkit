# Contract: Descriptor Admissibility

**Feature**: 010-catalog-backstage
**Status**: New in this feature. Spike 009 has no counterpart.
**Freezes**: what "admissible descriptor" means, when the determination runs relative to
canonicalization, what a failed determination does to the run, and what a passed determination
does *not* license anyone to say.
**Normative sources**: ADR-0015 (Condition of Acceptance 2, and the four-field validator table
it fixes); `spec.md` FR-015 through FR-021; `data-model.md` §4 (`AdmissibilityResult`) and §8
(the fatal trigger enumeration); `research.md` R6.
**Supersedes**: nothing. There is no spike-009 admissibility contract to supersede.

---

## 0. Why this contract exists at all

ADR-0015 postdates spike 009. The spike ran a fourteen-value fatal trigger enumeration and had
no notion of an inadmissible descriptor; `contracts/README.md` §2 records this as delta **D1**,
and `specs/009-catalog-binding-viability/contracts/atomic-fail-closed.md` §4 (lines 52–67, read
in this worktree) states its enumeration is "exactly these fourteen values". The string
`inadmissible-descriptor` does not appear anywhere under
`specs/009-catalog-binding-viability/`. ADR-0015 is its only source.

Consequently nothing in the spike's contract set can be pointed at for admissibility. The
surface has to be frozen here or it is not frozen at all.

---

## 1. The warrant, stated before anything else

Every admissibility statement in this contract is a statement about **what a pure validator
predicate returns when invoked**, at Backstage commit
`1121a4facd9e321179d0402c3f355e4a649e84d9`.

It is **not** a statement about what Backstage-as-a-running-system does with a descriptor. A
descriptor this contract calls inadmissible may or may not be rejected by a deployed Backstage
instance; this feature has never run one and will not. A descriptor this contract calls
admissible has not thereby been shown to work anywhere.

The pin is load-bearing. A different commit is a different predicate and therefore a different
contract. Any change of pin invalidates every admissibility determination recorded under this
feature and requires re-derivation, not re-labelling.

---

## 2. The four field validators

Admissibility is the conjunction of exactly four field-level validator predicates, as fixed by
ADR-0015 and restated in `spec.md` FR-016:

| Field | Validator | Character class | Length bound |
| --- | --- | --- | --- |
| `apiVersion` | `validateApiVersion` | — | — |
| `kind` | `validateKind` | — | — |
| `metadata.name` | `validateEntityName` | `[A-Za-z0-9]` plus `-`, `_`, `.` | ≤ 63 characters |
| `metadata.namespace` | `validateNamespace` | `[A-Za-z0-9]` plus `-`, `_`, `.` | ≤ 63 characters |

A descriptor is **admissible** when all four predicates return true for it. It is
**inadmissible** when any one of them returns false.

There is no partial admissibility, no warning tier, and no "admissible except for" state. The
`AdmissibilityResult` type in `data-model.md` §4 is the only carrier of the outcome.

### 2.1 Two populations that are not the same population

"Over 63 characters" and "invalid" are different sets and MUST NOT be reported as one.

At the corpus pins recorded in `research.md` R14, `community-plugins` has **7** descriptors with
an invalid `metadata.name`: **5** fail on character class and **2** fail on length alone.
`rhdh-plugins` has **11**, all of which fail on character class. Any report that collapses these
into a single "too long" or single "invalid characters" figure is wrong even when its total is
right.

---

## 3. The separator rule

Per `spec.md` FR-017, a validator failure MUST be attributed to the field it was invoked on. The
composition therefore splits the descriptor's fields before invoking any predicate and never
after. Two fields failing produce two attributions, not one merged one.

A recorded failure that says only "descriptor invalid", without naming which of the four fields
and which validator produced the false, does not satisfy FR-020 and MUST be treated as a
reporting defect rather than as a determination.

---

## 4. Ordering: admissibility runs before canonicalization

This ordering is fixed by ADR-0015 and is not an implementation preference.

1. Read the descriptor document.
2. Determine admissibility (§2).
3. Only if admissible, canonicalize identity.

### 4.1 The consequence that must be carried

An inadmissible descriptor **never acquires a canonical id**. It therefore can never participate
in a `duplicate-canonical-id` determination, in either direction: it cannot be the first member
of a collision and it cannot be the second.

This is not an optimization. Reversing the order would make some descriptors collide *before*
being found inadmissible, and the trigger class reported for the run would then depend on
document order within the manifest. Order-dependence of the reported trigger is exactly the
failure mode ADR-0015's ordering rule exists to prevent.

---

## 5. Failure semantics

`inadmissible-descriptor` is a **fatal, whole-operation** trigger class. It is the fifteenth
member of this feature's enumeration (`data-model.md` §8; `contracts/atomic-fail-closed.md`
§4.1). Its provenance is ADR-0015 Condition of Acceptance 2.

On any inadmissible descriptor:

- the entire run aborts;
- **no** envelope is written, including a partial one;
- **no** entity from the same run is emitted, including entities already determined admissible;
- the process exits non-zero with a machine-readable reason naming the trigger class.

An inadmissible descriptor is **never skipped**, never downgraded to a warning, and never
excluded-and-continued. "Continue past the bad one" is the precise behaviour this contract
forbids.

### 5.1 The count

This feature's fatal trigger enumeration has **fifteen** members. Writing "fourteen" as this
feature's count is an error against `spec.md` FR-035, which states in terms that fourteen is
wrong for this feature. Fourteen is spike 009's count and remains correct *as a statement about
spike 009*.

---

## 6. Duplicate detection is not a validity check

Per `spec.md` FR-021: canonical-id collision is a statement about a *pair* of descriptors. It is
not a property of either one alone, and it is not an admissibility failure.

The two determinations are independent, and conformance evidence MUST demonstrate that
independence rather than assert it. Specifically, the evidence MUST include at least one
descriptor that is **inadmissible and canonically unique** — a descriptor that fails §2 while
colliding with nothing. Without such a case, a passing suite is equally consistent with an
implementation that has silently fused the two checks.

### 6.1 The placeholder population, and a word that means two things here

At the pins in `research.md` R14 there are **16** unsubstituted skeleton descriptors — **5** in
`community-plugins`, **11** in `rhdh-plugins` — carrying **3** distinct placeholder forms.
**14** of the 16 share the form `${{ values.name | dump }}` and therefore canonicalize to the
same id, colliding with one another. The remaining **2** — `bulk-import`
(`${{ values.name }}`) and `orchestrator` (`${{ values.entityName }}`), both in `rhdh-plugins` —
canonicalize distinctly and collide with nothing.

**The "fourteen" in this subsection counts placeholder descriptors. It is not the trigger
count.** These are two unrelated fourteens and a reader who fuses them will produce a document
this repository fails. This feature's trigger count is fifteen (§5.1).

Those 2 outliers are the natural source of the §6 evidence case: each is inadmissible under §2
and collides with nothing.

---

## 7. What a passed determination does not license

An admissibility pass warrants exactly one sentence: *the four validator predicates at the
pinned commit returned true for this descriptor's four fields.*

It does not warrant, and MUST NOT be written as:

- that the descriptor is valid, correct, well-formed, or accepted;
- that Backstage would ingest it;
- that the entity it describes exists, is reachable, or is owned by anyone;
- that any path derived from it is a path anyone actually owns.

Ownership derivation is a separate contract (`owned-paths-annotation.md`, adopted unchanged from
spike 009 per `contracts/README.md` §2) and inherits its own separate warrant limits.

---

## 8. Observation requirement

Per ADR-0016 and `research.md` R8, each of the four validator predicates and the composition in
§3 lands only by three moves:

1. construct a descriptor that should fail that specific validator;
2. run it and **observe the failure**, recording the exact reason string produced;
3. correct the input and observe the pass.

A validator only ever observed passing has not been shown to be wired in. The §6 evidence case
(inadmissible and canonically unique) is subject to the same discipline: it must be observed
producing `inadmissible-descriptor` and **not** `duplicate-canonical-id`.

These observations use hand-authored fixtures whose expected values come from this contract and
from ADR-0015. Their placement relative to the pre-output barrier is fixed by `plan.md`
(Phase D), including the open question about whether ADR-0020 clause 6 permits them to run
before the barrier clears at all.

---

## 9. Standing honesty constraints

Repeated here per `contracts/README.md` §4, because a contract read in isolation must carry
them:

1. **The warrant is a predicate return value**, not the behaviour of Backstage as a system (§1).
2. **No unverified counts.** Every number in this document names where it was read: ADR-0015 and
   FR-016 for the validator table, `research.md` R14 for corpus figures, `data-model.md` §8 for
   the trigger enumeration.
3. **No evidence is claimed.** This feature has produced none. Every behavioural statement above
   is a requirement on work not yet done, never a report of work done.
4. **ADR-0014 rung 1 only.** Nothing here is external, third-party, or community validation.
   Only the corpus *data* is third-party; the validation is the maintainer's own.
5. **Genuine unknowns are marked**, not smoothed over. This contract carries none of its own;
   the ones it is downstream of are carried in `plan.md` and `research.md`.
