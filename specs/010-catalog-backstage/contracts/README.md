# Phase 1 Contracts: Production Backstage Catalog Adapter

**Feature**: `010-catalog-backstage` | **Companion to**: `plan.md`,
`research.md`, `data-model.md`, `quickstart.md`

## What this directory is, and what it deliberately is not

Spike `009-catalog-binding-viability` already designed the contracts this
feature needs. Its `contracts/` directory holds **eleven** files (counted by
`ls specs/009-catalog-binding-viability/contracts/`). This feature's job is to
**carry them into production with citation**, not to redesign them.

So this directory is small on purpose. It contains:

- **This register** (§1–§3) — the authoritative record of which spike-009
  contract is adopted, which is adopted with a named delta, and which is
  deliberately excluded, with the authority for each.
- **Three normative files** — one restated because a **count changed**, and
  two that are genuinely new because spike 009 had no counterpart.

| File | Why it exists here |
|---|---|
| `atomic-fail-closed.md` | The trigger set changed from **fourteen** to **fifteen**. A reader must not be sent to a document that names a different number. |
| `admissibility.md` | Genuinely new. ADR-0015 postdates the spike's contract set; there is no 009 counterpart. |
| `package-boundary.md` | Genuinely new. Spike 009 built no packages, so it could not specify a boundary between two. |

**Everything else is a citation, not a copy.** Where §2 marks a contract
`Adopted unchanged`, the spike-009 file **is** this feature's contract for
that surface, and it is authoritative in its original location. Copying it
here would create two texts that drift.

---

## §1. How to read the adoption register

Each row carries one of three statuses:

| Status | Meaning |
|---|---|
| **Adopted unchanged** | The 009 file is this feature's contract. Cite it by path and section. Do not restate it. |
| **Adopted with delta** | The 009 file is this feature's contract **except** for the named delta. Every delta names its authority. |
| **Excluded** | Deliberately not carried forward, with the reason. Not an oversight; do not reintroduce. |

A **delta** is a change this feature makes to the spike's design. Every delta
below names the record that authorizes it. A change with no named authority is
not a delta — it is an error.

---

## §2. The adoption register — all eleven spike-009 contracts

### Adopted unchanged (5)

| 009 contract | Sections this feature relies on | Where used |
|---|---|---|
| `glob-dialect.md` | §1 engine/options; §3 the **fifteen** ordered rules, first-match-wins; §4 dotfile policy; §5 migration; §6 compile-once-per-run | `data-model.md` §7.1 |
| `owned-paths-annotation.md` | §1 the **five** ordered decode steps; §3 the **three** ownership states; §4 empty-string edge case; §5 determinism | `data-model.md` §6, §7.2 |
| `entity-identity.md` | §1 canonicalization; §2 alias refs synthetic-only; §3 collisions; §4 overlap-is-not-collision; §5 case-sensitivity boundary | `data-model.md` §5 |
| `input-manifest.md` | §1 closed schema; §2 the **three** version/capability rejections; §3 repository identity and §3.1 scratch-repo; §4 digests and §4.1 two-stage path validation; §5 input boundary | `data-model.md` §1, §2 |
| `snapshot-envelope.md` | §1 envelope shape and the **five-field** entity record; §2 the **five** consumer validation steps; §3 digest; §4 staleness; §5/§6 identity and isolation | `data-model.md` §9–§14 |

**One clarification that is not a delta.** `glob-dialect.md` §1 records the
picomatch version as a fixed string. This feature **reads the version from the
resolved dependency at runtime** rather than transcribing it, so the envelope
cannot silently disagree with the matcher that actually ran. That is an
implementation instruction about how a recorded value is obtained, not a
change to the contract's content — the engine, the options, and the fifteen
rules are all untouched. `research.md` R3 verified the current resolution as
`picomatch@4.0.5` at `bun.lock` line 165.

### Adopted with delta (3)

#### D1 — `atomic-fail-closed.md`: fourteen → **fifteen** trigger classes

- **Delta**: add `inadmissible-descriptor` to the closed trigger set.
- **Authority**: ADR-0015 Condition of Acceptance 2, which requires the
  trigger be carried onto the atomic surfaces; spec FR-035, which states
  that fourteen "is correct for spike 009 and **wrong for this feature**; it
  MUST NOT be copied across."
- **Verification**: `atomic-fail-closed.md` §4 says "exactly these **fourteen**
  values" and lists them at lines 52–67. `inadmissible-descriptor` appears
  **nowhere** under `specs/009-catalog-binding-viability/`.
- **Consequence**: because the count itself changed, this contract is
  **restated in full** at `atomic-fail-closed.md` in this directory. Cite that
  file, not the 009 one, for any trigger enumeration.
- Everything else in the 009 contract — the fail-closed semantics, the
  no-partial-output rule, §5's grouping of the four manifest-request-level
  rejections — is adopted unchanged and restated faithfully.

#### D2 — `composition-and-release-boundary.md`: §4 superseded for **work**, not for **release**

- **Delta**: §4 "No Shipping Artifact — Absolute Scope Boundary" is superseded
  **only** to the extent that this feature is authorized to build two real
  workspace packages. §5 "Release Vehicle Is Explicitly, Permanently
  Undecided" is **not** superseded; it is reinforced.
- **Authority**: ADR-0020, which authorizes the **work** and not the
  **release**; ADR-0020 clause 9, which holds this at ADR-0014 **rung 1**.
- **Precise boundary**: building a package is authorized. Publishing one is
  not. Scheduling, designing toward, or implying a release is not. No artifact
  of this feature may claim any rung beyond rung 1.
- §1 (standalone offline generator), §2 (core/CLI isolation unaffected), §3
  (ADR-0007/ADR-0009 status unaffected) are adopted unchanged.
- §6 ("What This Plan Itself Adds to the Repository (None)") was true of the
  spike's plan and is **not** true of this one: this plan's design artifacts
  are followed by real package construction. Stated so no reader carries the
  spike's zero-artifact claim forward.

#### D3 — `structural-fixtures-and-corpora.md`: pins and protocol carry; fixture inventory does not

- **Delta**: §1's three pinned commits and its **re-verify-before-execution,
  fail-closed-on-drift, never-silently-substitute** protocol are adopted
  unchanged. §§2–10's spike-specific fixture inventory is **not** carried
  wholesale; this feature derives its own fixture set from its own FRs and SCs.
- **Authority**: the fixtures served spike FRs that this feature does not
  restate; ADR-0020 clause 5 imposes a **different** corpus obligation (the
  frozen, independently-audited accept corpus, `data-model.md` §17) that has
  no spike counterpart.
- **Carried forward explicitly** because they remain true and are easy to lose:
  §6 (absent annotation is the overwhelmingly common real-corpus case), §9
  (overlap between distinct entities is not a failure), §10 (never a silent
  skip).

### Excluded (3)

| 009 contract | Reason for exclusion | Authority |
|---|---|---|
| `comparison-heuristics.md` | Spike apparatus. The B/C/D option comparison is a **measurement instrument**, labelled `non-authoritative` by its own contract. This feature has no options to compare — ADR-0020 authorizes one design. | User instruction; ADR-0020 authorizes a single adapter, not a comparison |
| `evidence-bundle-and-verdict.md` | Spike apparatus. The evidence-bundle and three-way-verdict machinery existed to produce a **viability verdict**. That verdict was reached; ADR-0020 **is** its outcome. Re-running the machinery would re-decide a decided question. | User instruction; ADR-0020 is the record that closes it |
| `scale-and-security-measurement.md` | Its §§1–4 scale-measurement instrument is spike apparatus, and its §4 "Not Guessed Now" rule is already carried by ADR-0012 directly. | ADR-0012's own "production limits are not guessed now" |

**One partial retention from an excluded file, stated so it is not lost.**
`scale-and-security-measurement.md` §5 (network denial) describes the protocol
for evidencing that a run performs no network access, and `input-manifest.md`
§3.1 describes the standalone scratch repository. Those two remain relevant to
this feature's offline/clean-clone obligations (spec User Story 9). They are
cited from their original locations; the surrounding measurement instrument is
not carried.

---

## §3. What is genuinely new in this feature

Three surfaces have **no** spike-009 contract, because they did not exist when
the spike was designed:

1. **Admissibility** (`admissibility.md`) — ADR-0015 postdates the spike's
   contract set. §4 of `data-model.md` and this contract are its only
   specification here.
2. **The two-package boundary** (`package-boundary.md`) — spike 009 built no
   packages (`composition-and-release-boundary.md` §6), so it could not
   specify a boundary between two of them.
3. **The pre-output barrier** — ADR-0020 clauses 5 and 6. This is specified in
   `plan.md` as **Barrier B**, because it is a **sequencing** constraint on the
   build rather than a contract on a surface. `data-model.md` §16 and §17
   define the artifacts it produces.

---

## §4. Standing honesty constraints on every file in this directory

These apply to this register and to all three normative files, and they are
repeated in each:

1. **Never assert what Backstage-as-a-running-system does.** The only warrant
   available is **what a pure validator predicate returns when invoked** at the
   pinned Backstage commit `1121a4facd9e321179d0402c3f355e4a649e84d9`.
2. **Never state a count that has not been verified in the cited source.** Every
   count in this directory names where it was read.
3. **This feature has produced no evidence.** Every behavioural statement here
   is a **requirement**, never a report of an observation.
4. **Genuine unknowns are marked** `[NEEDS CLARIFICATION: ...]`, never resolved
   by guess.
5. **ADR-0014 rung 1 only.** Maintainer reference verification MUST NOT be
   called external, third-party, or community. Only corpus *data* is
   third-party — never the validation.
