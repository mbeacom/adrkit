# Quickstart: Validating Feature 010 — Backstage Catalog Adapter

**Feature**: `010-catalog-backstage`
**Companion documents**: [plan.md](./plan.md) (phases and Barrier B),
[spec.md](./spec.md) (FR/SC), [data-model.md](./data-model.md) (entity shapes),
[contracts/](./contracts/) (frozen surfaces).

This is a **validation and run guide**. It says what to run, in what order, and what must be
true afterwards. It deliberately contains no implementation code: the shapes live in
`data-model.md`, the rules live in `contracts/`, and the sequencing lives in `plan.md`.

---

## 0. Status — read this before running anything

**Nothing in this guide runs today.** Neither `packages/adapters/catalog-backstage/` nor
`packages/catalog-envelope/` exists. No manifest, no frozen expectation set, no accept-corpus
freeze, and no envelope has been produced. This feature has generated **no evidence** of any
kind.

Every section below is therefore written in the form *"when phase N is complete, this must
hold"* — never *"this holds."* A reader who converts any of it into a report of a passing state
has produced a false claim.

Sections are ordered to match `plan.md`'s phase sequence. A section cannot be exercised before
its phase exists, and §4 in particular cannot be exercised before Barrier B has cleared.

---

## 1. Prerequisites

| Requirement | Value | Where it comes from |
| --- | --- | --- |
| Toolchain | Bun 1.3.14 | root `package.json` `packageManager` |
| Published artifact target | Node `>=22` | root `package.json` `engines.node`; FR-051 |
| Network | Permitted **only** during `bun install --frozen-lockfile` | Constitution Principle II |
| Credentials / services | None, at any point after install | FR-052 |
| Working tree | Clean; the committed `bun.lock` unmodified | Principle II |

```bash
bun install --frozen-lockfile
```

This is the only step in this guide that may reach the network. Every later command must succeed
with the network unavailable, and §7 turns that from a convention into an enforced condition.

---

## 2. Repository-wide gates

These already exist and must stay green throughout. They are the floor, not the feature.

```bash
bun run typecheck
bun run build
bun run lint
bun test
bun run check:deps
```

**Expected after Phase A**: all five green, with both new packages present and picked up
automatically — the root `workspaces` globs `["packages/*", "packages/adapters/*"]` already match
both new paths, so no workflow or manifest edit is needed to include them.

**The one green result that means nothing.** `bun run check:deps` passes for a package that has
no `allowedDependenciesFor()` entry, because the function returns `undefined` for unknown
packages (`scripts/check-deps.ts:151`) and the allowed-surface guard is then skipped entirely. A
green `check:deps` is evidence only if you have separately confirmed both new packages have
explicit entries. See `contracts/package-boundary.md` §4.

---

## 3. Phase A — package boundary

Confirm placement, then confirm the guard actually guards.

**Placement checks** (no command needed beyond reading the tree):

- `packages/adapters/catalog-backstage/` exists and is an adapter by location.
- `packages/catalog-envelope/` exists and is **not** under `packages/adapters/**`, which is what
  makes it a non-adapter — `isAdapterPackage()` classifies purely by path prefix
  (`scripts/check-deps.ts:92–94`).
- Root `package.json` `workspaces` is unchanged. A change there means the placement is wrong.
- The adapter's `package.json` carries a `"//versioning"` note recording that its version is
  independent of `@adrkit/core` despite depending on it (ADR-0007; precedent in
  `packages/adapters/spec-kit/package.json`).

**Boundary checks, each observed failing first** (ADR-0016):

| Construct this | Run | Must produce |
| --- | --- | --- |
| Add `@adrkit/catalog-backstage` to the consumer's `dependencies` | `bun run check:deps` | violation `non-adapter workspace depends on an adapter package` |
| Add `@adrkit/catalog-envelope` to the adapter's `dependencies` | `bun run check:deps` | an allowed-public-surface violation |
| Add any dependency outside each package's allowlist | `bun run check:deps` | an allowed-public-surface violation for that package |

Revert each, re-run, and observe green. The third row is the only one that closes the §2 trap;
skipping it leaves you unable to distinguish "constrained and satisfied" from "unconstrained."

---

## 4. Phase B — Barrier B

**This section is the barrier. Do not run §5 or §6 until this section's expected outcomes hold.**

Barrier B is defined in `plan.md`; its three enforcement mechanisms come from `research.md` R5.
Verifying it is verifying all three, because none is sufficient alone.

**Mechanism 1 — input absence.** Confirm the generator has no way to discover a corpus: there is
no manifest in the tree, and `input-manifest.md` §5 forbids recursive walking and glob-based
input discovery. This is a design check, not a command. Its point is that the barrier does not
depend on anyone *remembering* not to run something.

**Mechanism 2 — hash match.** The freeze artifacts live under
`specs/010-catalog-backstage/evidence/` and are tracked in git precisely so CI can re-derive
their hashes.

```bash
# the hash-drift check added in Phase B, invoked as CI invokes it
bun test  # includes the freeze-drift check
```

Observed-failing-first: mutate one byte of a frozen artifact, re-run, observe the drift failure,
restore, observe green. A drift check never observed failing has not been shown to be wired in.

**Mechanism 3 — ordering.** Confirm the comparison harness of §6 **does not yet exist**. Its
absence at this point is the mechanism. If it exists, ADR-0020 clause 5's two distinct steps have
already been collapsed into one and step (b) can no longer stand alone.

**Expected outcomes for SC-010** — all four required, and the last is the one that gets skipped:

1. The accept corpus, its maintainer-authored `adrkit.io/owned-paths` overlay, its expected path
   matches, and its recorded selection basis and size are frozen **in the same cycle**.
2. An independent reviewer with no authoring involvement recomputes and matches the hashes.
3. That reviewer confirms `derivedPathPatterns` are recorded in `compareCodeUnits`-sorted order.
4. That reviewer records an **explicit adequacy finding**. *An audit that passes on integrity
   without reaching adequacy is a FAIL,* not a partial pass.

The step records its own hashes and its own PASS/FAIL, inherited from nothing.

Note on the corpus size figure: it is recorded as a fact about the frozen corpus. It is **not** a
production limit, and nothing in this step ratifies a scale bound (FR-055, ADR-0012).

---

## 5. Phases C, D, E — the two packages

### 5.1 Consumer (Phase C) — runnable before the barrier clears

Fixtures are hand-authored envelopes; expected values come from `snapshot-envelope.md`.

```bash
bun test --filter '@adrkit/catalog-envelope'
```

Each of the five ordered validation steps must be observed rejecting its own malformed envelope,
individually — a suite that only ever exercises step 1 cannot distinguish a working step 4 from
an absent one. Then: a mutated payload must fail digest recomputation; a stale envelope must fail
on **exact revision inequality** (never an ordering comparison); a foreign-repository envelope
must be refused; and derivation must be refused unless all five steps have passed (SC-014).

**What a passing envelope means, stated so it is not overstated**: integrity, not correctness
(FR-058, SC-012). A digest match says the bytes were not accidentally corrupted or accidentally
substituted. It says nothing about whether the derived paths are the right paths. That question
is answered only by §6, and only to the strength §6 actually achieves.

### 5.2 Adapter pure validators (Phase D)

```bash
bun test --filter '@adrkit/catalog-backstage'
```

Coverage required by SC-004 through SC-008, with every check observed failing first:

- Each of the four admissibility validators, **separately attributed** to the field it was
  invoked on (`contracts/admissibility.md` §3).
- At least one descriptor that is **inadmissible and canonically unique** — observed producing
  `inadmissible-descriptor` and **not** `duplicate-canonical-id` (FR-021). Without this case a
  green suite is equally consistent with an implementation that has fused the two checks.
- Each annotation decode step, including the coercion case where the YAML sequence `["[]"]` must
  **not** be classified `explicit-empty`.
- All three ownership states kept distinct, with `explicit-empty` decided on the decoded value.
- Glob rules **1–14**, each with its own rule-specific rejection reason.

**Do not report rule 15 as a coverage gap.** The dialect has fifteen ordered rules, but rule 15's
`invalid-glob-compile-failure` is a defensive backstop that `glob-dialect.md` §3 describes as
expected never to occur in practice. Its non-occurrence is conformant. SC-007 requires rules
1–14; fifteen rules is not fourteen required exercises, and neither figure is the trigger count.

**Barrier caveat.** Whether §5.2 may be run before Barrier B clears is the open question carried
in `plan.md`. This guide adopts the narrower reading. If the maintainer takes the stricter
reading, §5.2 moves after §4 and nothing else about this guide changes.

### 5.3 Assembled generator (Phase E) — strictly after §4

All **fifteen** fatal trigger classes must be driven through the full pipeline and each observed
failing (SC-003). Per-rule unit tests from §5.2 do **not** demonstrate whole-operation atomicity;
that is a separate property requiring its own fixtures (`contracts/atomic-fail-closed.md` §2).

Whole-operation atomicity (SC-002): a batch of otherwise-valid entities plus exactly one
triggering entity must produce a non-zero exit, exactly one recorded trigger class, and **no
envelope at all** — not a partial one, and not one containing the valid entities.

Determinism (SC-001): three or more runs over identical inputs must produce byte-identical
output.

Envelope-only output (SC-013): exactly one versioned envelope per successful run, and nothing
else written anywhere.

---

## 6. Phase F — clause-5 post-output comparison

Run only after §4's outcomes hold and §5.3 has produced output. The harness is authored at this
point and not before (mechanism 3).

Derived ownership for **every** annotated entity in the frozen accept corpus is diffed against
the frozen expectations. Required: **zero false positives and zero false negatives** (SC-011).
Any mismatch fails the gate.

**The expectations are never amended to fit the output.** If they diverge, the output is wrong,
or the expectations were wrong when frozen and must be re-frozen through a fresh §4 cycle with a
fresh independent audit — never edited in place.

This step records its own hashes and its own PASS/FAIL, inherited from nothing.

A PASS here is a **possible outcome** for ADR-0012 gate 3, which is open today because the
existing oracle carries a known-wrong expected result. It is never a claim made in advance of
running it.

---

## 7. Phase G — clean clone, offline, and the clause-8 gate

```bash
git clone <repo> /tmp/adrkit-clean && cd /tmp/adrkit-clean
bun install --frozen-lockfile
bun run typecheck && bun run build && bun run lint && bun test && bun run check:deps
```

Then, with the network **actively denied** rather than merely unused, run the generator over a
manifest and confirm it completes with no credential and no service (SC-016). Denial is the
requirement: "no calls were observed" is a weaker claim and does not satisfy SC-016. The
mechanism is the one described in spike 009's `scale-and-security-measurement.md` §5, cited from
its original location.

Also run the cross-package end-to-end: an envelope written by the generator, validated by the
consumer, with no import edge between the two packages in either direction.

Finally, the ADR-0020 clause 8 executable CI gate must be **observed failing** before it is
observed passing. ADR-0020's own frontmatter assertion is currently **inert** —
`status: 'inert'`, `reason: 'assertions-compile.engine-absent'` — so citing it as enforcement is
wrong. Only a real CI check counts.

**ADR-0012 gate 4 remains unmet and not yet testable after all of this.** Its clean-clone,
offline, and adapter-boundary components are producible here; its release component is not, and
ADR-0020 clause 9 defers release entirely.

---

## 8. Fixture construction notes

**The repository-mismatch fixture cannot be a worktree.** A `git worktree add` linked worktree
shares remote configuration with its parent, so a fixture built as a worktree of `mbeacom/adrkit`
would inherit the very identity it is supposed to mismatch. Use a standalone scratch
`git init` repository (`input-manifest.md` §3.1).

This applies to the current checkout, which *is* a linked worktree of `mbeacom/adrkit`.

**Never write to `/Users/markbeacom/github/mbeacom/adrkit`** — the maintainer's main checkout.

**The `picomatch` version is read, never transcribed.** Any fixture or expected value that hard-
codes a version string will pass today and silently mislead after any lockfile resolution
change. Read it from the resolved dependency (R3).

---

## 9. What a fully green run does and does not license

Suppose every section above passes. The warranted sentence is:

> At the pinned Backstage commit, the maintainer observed the generator produce deterministic,
> atomic, fail-closed behaviour over hand-authored fixtures and one frozen accept corpus, and
> observed derived ownership match independently frozen expectations at zero false positives and
> zero false negatives.

It does **not** license any of the following, and a document containing one of them fails review:

- That Backstage-as-a-running-system accepts or rejects anything. The warrant is what a pure
  validator **predicate returns when invoked** at the pinned commit. This feature has never run a
  Backstage instance and will not.
- That the work is *production-ready*, has an *authoritative go*, or is *release-ready* — unless
  the precise state is also named alongside. ADR-0020 authorizes the work, not the release.
- That any external, third-party, or community validation occurred. This is ADR-0014 **rung 1**:
  maintainer verification. Only the corpus *data* is third-party; the validation never is.
- That ADR-0012 gate 4 is met. It is not, and after this feature it is still not testable.
- That the digest establishes correctness. It establishes detection of accidental corruption and
  accidental substitution, and nothing beyond that (FR-041).

Three `[NEEDS CLARIFICATION]` markers remain open across `plan.md`, `research.md`, and `spec.md`
regardless of how green this guide runs. They are gaps at the ADR level. A green run does not
close them, and reporting them as closed is a false claim.
