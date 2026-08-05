# Phase 0 Research: Production Backstage Catalog Adapter

**Feature**: `010-catalog-backstage` | **Companion to**: `plan.md`,
`data-model.md`, `contracts/`, `quickstart.md`
**Authorizing record**:
[ADR-0020](../../docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md)
(`status: accepted`, 2026-08-04) — authorizes the **work**, not the **release**.

## How to read this document

Every entry below records a **Decision**, its **Rationale**, the
**Alternatives considered**, and — where the decision rests on a fact about
this repository rather than on a normative record — the **file and line** at
which that fact was read. Numbers are never asserted from memory; where a
count appears, its source is cited.

Three standing constraints govern every entry:

1. **No claim about Backstage-the-running-system.** The only warrant this
   feature has is what a **pure validator predicate returns when invoked** at
   Backstage commit `1121a4facd9e321179d0402c3f355e4a649e84d9`
   ([ADR-0015](../../docs/adr/0015-treat-descriptor-admissibility-as-a-precondition-of-canonicalization.md)).
   No statement here asserts that any deployment installs that validator, or
   that any catalog backend behaves in any particular way.
2. **No evidence claimed.** This feature has produced nothing. Every
   behavioural statement below is a **requirement on future work**, never a
   report of an observation.
3. **Unknowns are marked, not invented.** Genuine unknowns carry
   `[NEEDS CLARIFICATION: …]` and are carried forward unresolved.

---

## R1. Where the consumer package lives, and whether the workspace globs change

**Decision.** The envelope validator and `CatalogSnapshot` deriver live in a
new workspace package at **`packages/catalog-envelope/`** (working name
`@adrkit/catalog-envelope`). Root `package.json` `workspaces` is **not**
changed.

**Rationale.** Root `package.json` (read at `package.json` lines 20–23)
declares:

```json
"workspaces": [
  "packages/*",
  "packages/adapters/*"
]
```

`packages/catalog-envelope/` is matched by the existing `packages/*` glob, so
the package is picked up with **zero** change to the workspace configuration.
This matters for two reasons beyond convenience:

- `scripts/check-deps.ts`'s `isAdapterPackage()` (read at
  `scripts/check-deps.ts` lines 92–94) classifies a workspace as an adapter
  **solely** by whether its `package.json` path starts with
  `packages/adapters/`. A package at `packages/catalog-envelope/` is therefore
  **not** an adapter, by construction rather than by exception — so the
  `core-has-no-adapter-deps` rule (the violation reason at
  `scripts/check-deps.ts` line 179, `'non-adapter workspace depends on an
  adapter package'`) is satisfied structurally, not by an allowlisted carve-out.
- Constitution Principle III explicitly permits core and the CLI to depend on
  "their own workspace packages", so a future decision to wire the consumer
  into a first-party surface is not foreclosed by placement — while remaining
  **out of scope here** (see R7).

**Alternatives considered.**

- *Put the validator inside `packages/adapters/catalog-backstage/`.* Rejected:
  it would make every consumer of a validated envelope depend on an adapter,
  which is exactly what `core-has-no-adapter-deps` forbids, and it would
  couple the consumer's version to Backstage's semver contract (ADR-0007,
  lines 76–79: adapters "are versioned independently, and are permitted to
  break on upstream churn. Their semver contract is with their upstream, not
  with our core.").
- *Put the validator inside `@adrkit/core`.* Rejected: ADR-0012's
  composition rule and spec FR-020 both require that this feature change
  **nothing** in `packages/core/src/affects/**`, and adding an envelope
  validator to core would grow core's published surface for a capability
  whose release is explicitly deferred (ADR-0020 clause 9).
- *A single package containing both generator and consumer.* Rejected by spec
  FR-044 and the spec's "Where the consumer lives" note: the adapter and the
  consumer must depend on neither each other nor anything but the envelope
  file.

**Explicitly not decided here.** Whether `@adrkit/catalog-envelope` is ever
published, and if so whether in lockstep with `@adrkit/core` or independently,
is **deliberately undecided and out of scope** (spec, Resolved-question
section). Nothing in this plan may be read as having decided it, and no
artifact this feature produces may add a `publishConfig`, a release-manifest
entry, or a version-bump path that presumes an answer.

---

## R2. Which canonicalization function is reused

**Decision.** Reuse **`canonicalStringify` exported from `@adrkit/core`**,
defined at `packages/core/src/fingerprint/index.ts` line 16 and re-exported
from the package's public surface at `packages/core/src/index.ts` line 24. Its
key ordering comes from `compareCodeUnits`, defined at
`packages/core/src/ordering/index.ts` line 12 and likewise exported from
`@adrkit/core` (`packages/core/src/index.ts`). **No second canonicalization
implementation is written, and no general RFC 8785 library is added.**

**Rationale.** The requirement (spec FR-041, and
`specs/009-catalog-binding-viability/contracts/snapshot-envelope.md` §3) is a
deterministic canonical byte sequence over the envelope's **closed** scalar
value domain — strings, booleans, `null`, and bounded non-negative integers.
`canonicalStringify` already implements exactly the three steps that contract
names: recursive key sort by code-unit order, arrays serialized in declaration
order, compact separators, `undefined` fields omitted
(`packages/core/src/fingerprint/index.ts` lines 16–27). Both functions are
covered by `packages/core/test/surface.test.ts`'s exported-surface list (lines
35 and 39), so they are part of core's committed public API rather than an
internal detail that could move without notice.

**Note on a same-named sibling.** A **second, different** `canonicalStringify`
exists at `packages/evaluator/src/report/serialize.ts` line 38, with the
signature `(root: unknown, pretty = false)`. It is **not** the one to reuse:
importing it would put an `@adrkit/evaluator` dependency on a package that has
no other reason to hold one. The core function's signature is
`(value: unknown)` — single argument, no pretty mode. Implementations must
import from `@adrkit/core`, never from `@adrkit/evaluator`.

**Scope of the claim that must be preserved.** The 009 contract's own
qualification is carried forward verbatim in effect: for the envelope's closed
scalar value domain these bytes are **equivalent to** RFC 8785/JCS output; **no
claim is made** that `canonicalStringify` is a general-purpose RFC 8785
implementation for arbitrary JSON values. Any artifact this feature produces
that describes the digest MUST carry that qualification.

**Alternatives considered.** Adding a dedicated JCS/RFC-8785 dependency —
rejected: it enlarges the dependency surface of a package whose release is
deferred, and `scripts/check-deps.ts`'s allowlist model would need to admit
it for no functional gain over the existing, tested function.

---

## R3. How the glob engine and its version are pinned and recorded

**Decision.** The engine is **`picomatch`**, compiled with options
`{ dot: false, nocase: false, nonegate: true }`. The version written into
`SnapshotEnvelope.globDialect.version` is **read at runtime from the resolved
dependency**, never transcribed from a document.

**Verified fact.** `bun.lock` declares the range `"picomatch": "^4"` (line 47)
and resolves it to **`picomatch@4.0.5`** (line 165). The companion
`yaml` dependency is declared as `"yaml": "latest"` (line 49) and resolves to
**`yaml@2.9.0`** (line 187). Both were read directly from `bun.lock` in this
worktree; neither is taken on trust from prose.

**Rationale for reading rather than transcribing.** The engine version is a
**consumer-checked exact value**: `specs/009-catalog-binding-viability/contracts/snapshot-envelope.md`
§2 step 3 requires the consumer to deep-equal
`{ engine: "picomatch", version: "4.0.5", options: { dot: false, nocase: false, nonegate: true } }`
and states plainly that a `globDialect.version`-only check is **insufficient**.
If the generator transcribes a version string that has drifted from the
lockfile's resolution, the envelope silently misdescribes the matcher that
produced it and the consumer's check passes on a false premise. Reading the
resolved version closes that gap mechanically.

**Consequence to carry into the contracts.** This is a **production delta**
from the spike's contract, which pinned the literal `4.0.5` in a table
(`glob-dialect.md` §1). The value is unchanged today; what changes is its
**provenance** — resolved, not transcribed. Its authority is spec assumption
A6 and the consumer's own exact-value check. Any change to engine, version, or
any option remains a **versioned reclassification** requiring a new
`globDialect.version` in every future envelope, exactly as `glob-dialect.md`
§5 already fixes.

**Alternatives considered.** Introducing a second matcher, or a different
options combination for this feature's validator — rejected by
`glob-dialect.md` §1's no-substitution rule and by the fact that
`scripts/check-deps.ts`'s `@adrkit/core` allowlist already admits exactly
`picomatch`, `semver`, `zod`, `yaml` (lines 98–105), so a second matcher would
be a new dependency requiring its own justification.

---

## R4. What counts as "generator output" for the barrier

**Decision.** For the purposes of the Oracle Freeze Barrier (`plan.md`,
"Barrier B"), **generator output** means:

> a `SnapshotEnvelope` written or returned by the assembled generator, **or**
> any derived-ownership result computed for a descriptor-sourced entity —
> whether persisted, held in memory, or asserted in a test.

**Rationale.** ADR-0020 clause 6 requires the fresh T014 → T014a cycle
"*before* producing generator output", and clause 5 requires the accept
corpus, its overlay and its expected paths to be "frozen and independently
audited … before any generator output is produced." The control these clauses
implement is **anti-backfilling**: it prevents expectations from being written,
or amended, to fit an output that already exists. The contamination vector is
therefore any artifact that **could be compared against, or used to derive,
the frozen expectations**. A `SnapshotEnvelope` is such an artifact. A derived
`derivedPaths` array for a real descriptor's entity is such an artifact.

By the same reasoning, a unit-level classification result whose expected value
is fixed by a **contract already frozen in this repository** — for example
that the pattern `packages/{a,..}/**` is rejected at rule 6 with reason
`"brace"` (`glob-dialect.md` §3 worked example) — is **not** such an artifact:
the oracle is not its source of truth, so it cannot backfill the oracle.

**The distinguishing test, stated so it can be applied by a reviewer:**

> *Where does this test's expected value come from?* If it comes from a
> contract frozen in `specs/` or `docs/adr/`, the work is barrier-free. If it
> comes from — or could be silently adjusted to match — the oracle expectation
> set or the clause-5 accept-corpus expected paths, it is behind the barrier.

**Alternatives considered, and the stricter reading that is left open.**

A stricter reading is available and is **not** foreclosed: that *no code in
`packages/adapters/catalog-backstage/` may execute at all* before the barrier
clears. Under that reading, the pure-validator work in `plan.md` Phase D also
moves behind the barrier, and only Phases A and C remain barrier-free.

`[NEEDS CLARIFICATION: Does ADR-0020 clause 6's "generator output" bar unit-level execution of the adapter's pure validators (glob dialect, annotation decode, admissibility, identity canonicalization) against hand-authored fixtures whose expected values come from frozen contracts rather than from the oracle? This plan adopts the narrower reading defined above, because the anti-backfilling control it implements has no purchase on a test the oracle does not source. If the maintainer prefers the stricter reading, Phase D moves behind Barrier B and the parallel-dispatch envelope in plan.md shrinks to Phases A and C — no other part of the sequence changes.]`

**Belt-and-braces control regardless of which reading applies.** Under either
reading, the barrier is enforced **structurally** rather than by discipline —
see R5.

---

## R5. How the barrier is made structural rather than procedural

**Decision.** Three mechanisms, all required, none sufficient alone:

1. **Input absence.** The oracle expectation set and the clause-5 accept
   corpus overlay + expected paths do **not** exist in the working tree until
   their freeze-and-audit steps complete. The generator has no code path that
   discovers descriptor files: `specs/009-catalog-binding-viability/contracts/input-manifest.md`
   §5 already forbids recursive walking or glob-expansion to "discover"
   descriptors, so the **only** way to reach a corpus is a manifest that names
   its files explicitly. Absent manifest, absent corpus, absent output.
2. **Hash match.** Each freeze records its own content hashes, and a CI check
   re-derives them and fails on drift. This is what makes "the expectations
   were never amended to fit the output" a checkable property rather than an
   assertion.
3. **Ordering of the comparison harness.** The harness that reads *both*
   generator output *and* frozen expectations is written **after** the freeze
   and its audit, never before. ADR-0020 clause 5 requires the pre-output
   freeze/audit and the post-output comparison to be "two distinct steps, each
   recording its own hashes and its own PASS/FAIL"; writing the comparison
   harness first would collapse them.

**Rationale.** ADR-0020 clause 6 is explicit that the repository holds no
existing control here: ADR-0015's Condition of Acceptance 1 "already notes the
scratch bundle is untracked, so nothing in the repository will stop someone
reusing a stale copy. This record adds no control it does not have; it repeats
the clause because repetition is the control." A plan that also relies on
repetition adds nothing. Mechanisms 1–3 are what turn repetition into
structure.

**Alternatives considered.** Relying on task ordering in `tasks.md` alone —
rejected: task order is advisory to a reader and invisible to CI, and the
carry-forward blocker from spike 009 exists precisely because ordering that
was written down was not mechanically enforced.

---

## R6. How ADR-0015 admissibility composes with canonicalization and the trigger set

**Decision.** Admissibility is checked **before** canonicalization, and
`inadmissible-descriptor` is a **fatal whole-operation trigger** — bringing the
closed trigger set from the spike's **fourteen** values to **fifteen** for this
feature.

**Verified counts.** `specs/009-catalog-binding-viability/contracts/atomic-fail-closed.md`
§4 states that every `triggerClass` "MUST be one of exactly these fourteen
values" and lists them (lines 52–67). `inadmissible-descriptor` appears
**nowhere** under `specs/009-catalog-binding-viability/`; its only source is
ADR-0015. Spec FR-035 states the number **fourteen** "is correct for spike 009
and **wrong for this feature**; it MUST NOT be copied across." The production
count is therefore **fifteen**, and `contracts/atomic-fail-closed.md` in this
feature restates the closed set in full rather than referring a reader to a
document that names a different number.

**Ordering rationale.** ADR-0015's decision is that admissibility is a
**precondition of** canonicalization, not a check performed alongside it. The
consequence for implementation order is concrete: `metadata.name`/`namespace`
values that fail the pinned four-field validator predicate are rejected
**before** `stringifyEntityRef`-equivalent lowercasing is applied, so an
inadmissible descriptor never acquires a canonical id and therefore can never
participate in a `duplicate-canonical-id` determination. Reversing the order
would let an inadmissible descriptor collide with an admissible one and be
reported under the wrong trigger class.

**The claim's precise warrant.** The validator table is pinned to Backstage
commit `1121a4facd9e321179d0402c3f355e4a649e84d9`. What is warranted is what
that **predicate returns when invoked**. It is **not** warranted, and must not
be written, that any Backstage deployment installs that policy, that any
catalog backend rejects such a descriptor, or that "Backstage requires" the
four fields. ADR-0015's own review history records that overclaiming phrases
of exactly this kind were found and removed across multiple review rounds; the
qualification is load-bearing, not stylistic.

**Alternatives considered.** Treating inadmissibility as a per-entity skip —
rejected outright by `atomic-fail-closed.md` §1, whose stated purpose is to
foreclose "skip the bad entity and keep going", and by ADR-0015's Condition of
Acceptance 2, which requires `inadmissible-descriptor` to be carried onto the
atomic surfaces as a **fatal** trigger.

---

## R7. How the dependency-boundary check extends to the two new packages

**Decision.** `scripts/check-deps.ts`'s `allowedDependenciesFor()` gains an
explicit closed allowlist entry for **each** new package. Neither package is
left to fall through to the function's `return undefined` default.

**Verified behaviour of the current check.** `allowedDependenciesFor()` (read
at `scripts/check-deps.ts` lines 96–152) returns a per-section allowlist for
exactly five package names — `@adrkit/core`, `@adrkit/cli`,
`@adrkit/evaluator`, `@adrkit/mcp`, `@adrkit/ci` — and **`undefined` for
everything else** (line 151). Where it returns `undefined`, the
`allowed && !allowed[section].has(dependency)` guard (line 200) is skipped
entirely, so a package with no entry is constrained **only** by the
adapter-dependency rule and the GitHub-toolkit rule. A new package left
without an entry is therefore silently unconstrained. Adding entries closes
that gap.

**Proposed allowlists** (to be implemented, not implemented here):

| Package | `dependencies` | `devDependencies` |
|---|---|---|
| `@adrkit/catalog-backstage` (at `packages/adapters/catalog-backstage/`) | `picomatch`, `yaml` | `@types/bun`, `@types/picomatch` |
| `@adrkit/catalog-envelope` (at `packages/catalog-envelope/`) | `@adrkit/core` | `@types/bun` |

The generator's list deliberately **excludes `@adrkit/core`**: ADR-0007's
isolation rule runs in the direction core-must-not-see-adapters, but keeping
the adapter free of a core dependency additionally guarantees that the
adapter's independent versioning (ADR-0007 lines 76–79) is not silently
coupled to core's release cadence. The generator therefore needs its own
canonicalization for the envelope digest — which is a **conflict** with R2's
reuse decision, resolved below.

**Resolution of the R2/R7 conflict.** The digest is computed by the
**consumer**, not only by the generator: the consumer must "independently
recompute this digest and compare it against the envelope's declared `digest`
value before trusting any entity's `derivedPaths`"
(`snapshot-envelope.md` §3). The consumer is `@adrkit/catalog-envelope`, which
**does** depend on `@adrkit/core` and therefore uses core's
`canonicalStringify` directly, satisfying R2. The generator must also emit a
`digest` field, and it must be byte-identical to the consumer's recomputation.
Two options exist and this plan does not choose between them at Phase 0:

- **G1**: the generator depends on `@adrkit/core` solely for
  `canonicalStringify`/`compareCodeUnits`. Cost: couples the adapter to core.
- **G2**: the generator depends on `@adrkit/catalog-envelope` for the
  canonicalization primitives, which in turn holds the core dependency. Cost:
  makes the adapter depend on the consumer, contradicting FR-044's "depend on
  neither each other" requirement.

**G1 is the working assumption**, because G2 is directly forbidden by FR-044
while G1 is only undesirable. G1 is compatible with `check:deps` as written:
`@adrkit/core` is not an adapter, so the adapter-dependency rule does not fire.
The design consequence to record is that under G1 the adapter's allowlist
becomes `@adrkit/core`, `picomatch`, `yaml`, and the adapter's independent
versioning must be documented as **independent of core's semver despite the
dependency**, exactly as `packages/adapters/spec-kit/package.json`'s
`"//versioning"` note already documents for its own case.

**Out of scope, and named so it is not done by accident.** Wiring
`@adrkit/catalog-envelope` into `@adrkit/cli` would require **amending**
`allowedDependenciesFor('@adrkit/cli')`, whose `dependencies` set is currently
exactly `{'@adrkit/core', '@adrkit/evaluator'}` (`scripts/check-deps.ts` lines
107–115). No spec requirement asks for that wiring, and it would extend a
published surface whose release is deferred (ADR-0020 clause 9). **Do not do
it in this feature.**

---

## R8. What ADR-0016 "observed failing first" requires of each check here

**Decision.** Every check this feature introduces is landed by the same
three-move sequence, and its failing observation is recorded:

1. Construct the input that **should** fail.
2. Run the check and **observe it fail**, recording the exact reason string the
   check emits.
3. Correct the input (or land the fix) and observe it pass.

A check that has only ever been observed passing does **not** count as
coverage. This is ADR-0016's rule, and ADR-0020 clause 8 applies it explicitly
to this feature's own release gate: enforcement "counts as coverage only once
it has been watched failing."

**The inert-assertion trap, stated because it is easy to get wrong.** ADR-0020
clause 8 records that the frontmatter assertion on ADR-0020 itself is
**currently inert**: `engine: custom` resolves through an optional registry
port, and with no port registered the evaluator returns `status: 'inert'`,
`reason: 'assertions-compile.engine-absent'` — "It records the rule; it does
not enforce it." Any artifact of this feature that cites that assertion as
enforcement is wrong. The enforcement must be a **real CI check**, and it must
be observed failing before it counts.

**Where the checks sit.** The full placement table is in `plan.md`
("ADR-0016 check placement"). The design constraint that shapes it: a check
whose failing observation would require generator output over a corpus is
itself behind Barrier B; a check whose failing observation can be produced from
a hand-authored fixture is not.

**Alternatives considered.** Recording "the test suite is green" as coverage —
rejected by ADR-0016's numbered clauses, and by its "report what was examined,
not only what was concluded" requirement.

---

## R9. What this feature can and cannot clear of ADR-0012's production gates

**Verified gate list.** ADR-0012 names **four** gates on production of
`packages/adapters/catalog-backstage` (read at `docs/adr/0012-*.md` lines
202–220). Their status, as recorded by ADR-0020's own gate table:

| # | Gate | Status per ADR-0020 | What this feature does to it |
|---|---|---|---|
| 1 | Phase 6 `specs/007-arb-queue/tasks.md` T048-R/T049 clearing | **Satisfied** (2026-07-22) | Nothing. Unchanged in both directions. |
| 2 | Non-shipping spike evidence from `specs/009-catalog-binding-viability/` | **Satisfied** | Nothing. `specs/009-*` is a frozen historical record and is not modified. |
| 3 | A maintainer-authored reference oracle validating real entity/path outcomes | **Unmet** — "The oracle exists but carries a known-wrong expected result and must be re-frozen" | **Directly addressed** by Barrier B steps: the fresh T014 → T014a cycle re-freezes it. Clearing is a *possible outcome* of this feature, not a claim it may make in advance. |
| 4 | Clean-clone / offline / adapter-boundary / **release** evidence passing | **Unmet, and not yet testable** | **Partially addressable**: clean-clone, offline and adapter-boundary components are producible here. The **release** component is not. |

**The open question this leaves.**

`[NEEDS CLARIFICATION: What constitutes the "release evidence" component of ADR-0012 gate 4, given that ADR-0020 clause 9 defers both the release vehicle and the decision to release at all? This feature can produce the clean-clone, offline, and adapter-boundary components of that gate. Whether gate 4 is therefore *partially* clearable, or whether it is atomic and remains wholly unmet until a release decision exists, is not resolvable from ADR-0012, ADR-0014, or ADR-0020 as written. Carried forward from spec.md unresolved.]`

**Binding consequence for every artifact of this feature.** ADR-0020's closing
paragraph authorizes work toward **rung 1 only**, which ADR-0014 calls
"necessary, never sufficient on its own to land a phase whose value is an
operational surface." No artifact may claim `reference-verified`, `landed`,
`released`, `externally validated`, or `adopted`. ADR-0014's state vocabulary
is binding and its synonyms ("production-ready", "authoritative go",
"release-ready") are forbidden unless the precise state is also named. The
maintainer's own isolated reference verification is **rung 2** and MUST NOT be
described as external, third-party, or community adoption — only the corpus
**data** is third-party, never the validation (ADR-0020 clause 5).

---

## R10. Offline and clean-clone posture

**Decision.** The generator performs **no network access of any kind** at
generation time. Its entire input boundary is: the manifest file; each
descriptor path the manifest's `sources` array lists (digest-verified before
trust); and two git-identity values read via subprocess. This is
`specs/009-catalog-binding-viability/contracts/input-manifest.md` §5, adopted
without change.

**Verified CI shape.** `.github/workflows/ci.yml` already runs a job named
`clean-clone-builds` (line 12) whose steps include `bun install
--frozen-lockfile`, `bun run typecheck`, `bun run build`, `bun run lint`,
`bun test`, and `bun run check:deps` (lines 23–40). A new workspace package is
picked up by `bun run --filter='*' build` and `bun run --filter='*' lint`
(root `package.json` `scripts.build` / `scripts.lint`) without a workflow
change, and by `bun test` without one either. The **only** CI edit this
feature needs is the clause-8 enforcement check (R8), and that edit is scoped
to adding a check — never to changing the release workflow, which ADR-0020
clause 9 defers.

**Bounded scope of the repository-identity check, restated so it is not
overclaimed.** The manifest-vs-checkout comparison confirms the manifest
agrees with the checkout's **own locally-configured git state**. It never
confirms agreement with a live, network-verified remote. A network-verified
provenance check is out of scope.

**A carried-forward test-construction constraint.** `input-manifest.md` §3.1
records that a `git worktree add` linked worktree shares its remote
configuration with the repository it was created from, so a repository-mismatch
test cannot be constructed inside one — it requires a **standalone scratch git
repository**. This constraint applies with equal force here, and applies to
this very worktree: any mismatch fixture must be a fresh disposable `git init`
directory with its own `origin`, never a worktree of `mbeacom/adrkit`.

---

## R11. YAML parsing and duplicate-key detection

**Decision.** Parse descriptor documents with the workspace's existing `yaml`
package, using `parseDocument`, and rely on its `uniqueKeys` option — which
**defaults to `true`** — to surface duplicate mapping keys. Never set
`uniqueKeys: false`, and never post-hoc re-serialize and compare keys.

**Verified facts.** `bun.lock` resolves `yaml` to **`2.9.0`** (line 187).
`@adrkit/core` already uses this package's `parseDocument` with `{ strict:
true, prettyErrors: false }` at `packages/core/src/parse/frontmatter.ts` lines
1 and 53, so the dependency and the API are both already in use in this
repository rather than newly introduced. `specs/009-catalog-binding-viability/research.md`
lines 385–408 records the `uniqueKeys` default and the requirement that it not
be overridden anywhere in the generator.

**Why this matters to the trigger set.** `duplicate-yaml-key` and
`invalid-yaml-syntax` are **two distinct** trigger classes
(`atomic-fail-closed.md` §4 and its note at lines 72–78): a document that
fails to parse for a YAML syntax reason *other than* a duplicate key must not
be reported under the duplicate-key trigger. Both are fatal; conflating them
loses a diagnostic the closed type exists to preserve.

**The step-2 coercion trap that shapes the reader.** The annotation node must
be checked as a **YAML string scalar on the raw node**, before `JSON.parse` is
reached (`owned-paths-annotation.md` §1 step 2). `JSON.parse` coerces a
non-string argument via `ToString`, so the YAML sequence `["[]"]` would be
stringified to `"[]"`, parse cleanly as an empty array, and be **misclassified
as `explicit-empty`**. The parser therefore must expose the raw node's type —
which `parseDocument` does and a plain `parse()` to a POJO does not. This is a
concrete constraint on the parsing API choice, not a stylistic preference.

---

## R12. The `allRefs` population question

**Status: open, carried forward from `spec.md` unresolved.**

**What is verified.** `specs/009-catalog-binding-viability/contracts/entity-identity.md`
§2 states that `fixtureAuthoredAliasRefs` "is supplied **directly by a
synthetic fixture's own construction**", that "Backstage itself defines no
standard field for declaring such an alias", and that therefore "**no
real-corpus entity from `community-plugins` or `rhdh-plugins` ever has a
non-empty `fixtureAuthoredAliasRefs`**". It explicitly defers the production
mechanism: "A future production adapter's own mechanism (if any) for sourcing
aliases from real descriptors is an explicitly separate, later, out-of-scope
design decision this contract does not make."

**Why it cannot be resolved by guess.** The envelope's entity record requires
a **non-empty** `allRefs` string array (`snapshot-envelope.md` §2 step 2). If
`allRefs` is only ever `[canonicalId]` for real descriptors, then the
`duplicate-canonical-ref` trigger — which fires when one entity's alias
collides with a different entity's primary id — is **unreachable outside
synthetic fixtures**. That has a direct consequence for coverage claims: a
`duplicate-canonical-ref` check exercised only on synthetic fixtures must be
reported as such, never as corpus-exercised.

`[NEEDS CLARIFICATION: How, if at all, is allRefs populated beyond the primary canonicalId in production? Spike 009 sourced alias refs from synthetic fixtures only; no real-corpus entity carries one; Backstage defines no standard alias field; and no ADR decides the question. Consequence: it is unknown whether duplicate-canonical-ref is reachable outside synthetic fixtures. Carried forward from spec.md unresolved.]`

**Interim design instruction that does not resolve it.** The envelope shape
still requires `allRefs` to be present and non-empty, so the generator emits
`[canonicalId]` as the minimum. That is a **shape** decision forced by the
envelope contract, and it must not be recorded anywhere as an answer to the
question above.

---

## R13. What is deliberately **not** carried forward from spike 009

**Decision.** The following spike-009 material is **excluded** from this
feature's design, with authority:

| Excluded | Authority |
|---|---|
| The B / C / D comparison heuristics (descriptor-parent, repository-root, identity-only) | ADR-0020 clause 7: "No B/C/D comparison heuristic carries into production. Those were measurement instruments, labelled `non-authoritative` by their own contract." Spec FR-061 additionally forbids them "as inferred, authoritative, default, or opt-in ownership behavior". |
| `contracts/comparison-heuristics.md` | Same. |
| The evidence-bundle / three-way-verdict machinery (`go-explicit` / `no-go` / `blocked`, `NonBindingRecommendation`) | Spike apparatus for producing a viability verdict. This feature is authorized work, not a viability question; ADR-0020 already delivered the verdict. |
| `contracts/evidence-bundle-and-verdict.md` | Same. |
| `contracts/scale-and-security-measurement.md` | Measurement apparatus. ADR-0012 lines 222–226 hold that production limits "are **not** guessed now; they must be ratified from evidence" — this feature does not ratify them. |
| The spike's twelve-envelope evidence-bundle inventory (`snapshot-envelope.md` §1's count of 3 required + 9 derivative artifacts) | That inventory is a property of the spike's evidence bundle, not of the envelope contract. The **shape** and the **five validation steps** carry forward; the artifact count does not. |

**What is carried forward** is enumerated with per-file adoption status in
`contracts/README.md`.

---

## R14. Corpus facts, recorded with their counts and their qualifications

These are carried from `spec.md`'s Assumptions section. They are recorded here
because several of them are counting traps the repository has failed documents
over, and because the clause-5 accept corpus will be selected against them.

| Fact | Value | Qualification that must travel with it |
|---|---|---|
| `community-plugins` descriptor files @ `92e9e4e09c76cc57f3475029b73e5ec84498a459` | **156** files / **167** entity documents | File count ≠ entity-document count. Never substitute one for the other. |
| `rhdh-plugins` descriptor files @ `3b355ddfedb23c6656bd9effc8510f9926b765c1` | **38** files / **39** entity documents | 38/39 holds **only** for exact `catalog-info.yaml` basename match; a looser path-suffix match over-counts (spec A5). |
| Descriptors in `community-plugins` carrying **any** `metadata.annotations` | **23** of 156 | Of those, **zero** carry `adrkit.io/owned-paths`. |
| Unsubstituted skeleton descriptors across both corpora | **16** files (5 in `community-plugins`, 11 in `rhdh-plugins`) | Carrying **3** distinct placeholder forms. |
| Placeholder descriptors sharing `${{ values.name \| dump }}` | **14** of those 16 | These **collide** on canonicalization. The two outliers — `bulk-import` (`${{ values.name }}`) and `orchestrator` (`${{ values.entityName }}`), both in `rhdh-plugins` — canonicalize distinctly and **collide with nothing**. |
| Invalid `metadata.name` in `community-plugins` | **7** | **5** on character class, **2** on **length alone**. |
| Invalid `metadata.name` in `rhdh-plugins` | **11** | All on character class. |

**The trap to avoid in every downstream artifact.** "Over 63 characters" is
**not** the same population as "invalid". A name may be invalid on character
class while being short, and invalid on length while using only permitted
characters. Any statement that conflates the two is wrong.

**Consequence for the clause-5 accept corpus.** ADR-0020 clause 5 requires the
accept corpus to be "**admissible** under ADR-0015, and free of duplicate
canonical ids". The placeholder-collision and invalid-name populations above
are therefore **selection constraints**, not incidental facts: a corpus
selected without regard to them would fail its own gate on inputs that were
known in advance to fail. The selection basis must record how they were
handled, and that record is part of what the clause-5 audit inspects.

---

## Summary of open items carried into Phase 1

| # | Item | Status |
|---|---|---|
| 1 | `allRefs` population beyond `canonicalId` (R12) | **Open.** Carried from `spec.md`. Not resolved by guess. |
| 2 | ADR-0012 gate 4's "release evidence" component (R9) | **Open.** Carried from `spec.md`. Not resolved by guess. |
| 3 | Whether ADR-0020 clause 6's "generator output" bars unit-level execution of pure validators (R4) | **Open, with a stated conservative default** so work is not blocked. Resolving it strictly shrinks the parallel envelope; it changes nothing else. |

No other unknown is left unmarked. Where this document states a number, the
file and line at which it was read is cited; where it states a requirement, the
normative record imposing it is named.
