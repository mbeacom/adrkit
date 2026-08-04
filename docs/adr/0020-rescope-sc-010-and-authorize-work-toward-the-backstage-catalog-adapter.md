---
schemaVersion: 0.1.0
id: "0020"
title: Rescope SC-010 and authorize work toward the Backstage catalog adapter
status: proposed
date: 2026-08-03
deciders: ["@mbeacom"]
tags: [catalog, governance, evidence, integration, strategy]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0007", "0009", "0012", "0013", "0014", "0015", "0016", "0019"]
affects:
  - type: path
    pattern: "packages/adapters/catalog-backstage/**"
  - type: path
    pattern: "specs/009-catalog-binding-viability/spec.md"
provenance:
  authoredBy: agent-drafted
review:
  tier: arb
  tierReason: >-
    Rescopes a success criterion of a completed, independently audited spike, and
    opens implementation work against ADR-0012's production gate list. ADR-0015
    attached the rescope to its own conditions of acceptance and required a record
    for it. It is also the second time in three days that a recorded verdict has
    been set aside, so the precedent's boundaries matter more than the work does.
assertions:
  - id: catalog-adapter-accept-path-needs-annotated-real-corpus
    description: >-
      The Backstage catalog adapter may not be released, and may not claim
      ADR-0014 rung 2, until its accept path has produced a populated,
      digest-verified SnapshotEnvelope from a catalog corpus whose descriptors
      are real and third-party-sourced — authored upstream and otherwise
      unmodified — and which is admissible under ADR-0015 and free of duplicate
      canonical ids. That corpus must carry at least one non-empty
      adrkit.io/owned-paths annotation. The annotation MAY be a
      maintainer-authored overlay and is NOT contingent on third-party adoption;
      no descriptor in the pinned corpora carries the annotation, so requiring an
      externally-authored one would gate release on external adoption, which
      ADR-0014 forbids. Two distinct steps are required, each recording its own
      hashes and its own PASS/FAIL. Before any generator output is produced, the
      corpus, its overlay, its expected path matches, and its recorded selection
      basis and size are frozen and independently audited in the same cycle as
      the ADR-0012 gate 3 reference oracle, and that audit must record an
      explicit finding that the corpus is adequate for the claim being made; no
      minimum entity count is fixed, because ADR-0012 requires production limits
      be ratified from evidence rather than guessed. After the run, the
      generator's derived ownership for every annotated entity is diffed against
      those frozen expectations and must match with zero false positives and zero
      false negatives; any mismatch fails this assertion, and the expectations
      are never amended to fit the output. A populated envelope alone does not
      satisfy this, because a digest proves integrity and not correctness. A
      corpus in which every entity is annotation-absent does not satisfy it
      either, because it yields a populated envelope while exercising none of the
      ownership derivation. Nor do wholly synthetic entities; spike 009 already
      proved that path.
    engine: custom
    expression: catalog-adapter-accept-path-needs-annotated-real-corpus
    input: catalog
    severity: error
externalRefs:
  - type: issue
    id: "25"
    url: "https://github.com/mbeacom/adrkit/issues/25"
    label: Decide catalog entity-to-path binding before feature 009
reviewBy: 2027-08-03
---

# ADR-0020: Rescope SC-010 and authorize work toward the Backstage catalog adapter

## Context

ADR-0012 gates production of `packages/adapters/catalog-backstage` on four
items, enumerated in its own text rather than in an action item:

| ADR-0012 gate | Status |
|---|---|
| 1. Phase 6 `specs/007-arb-queue/` T048-R/T049 clearing | **Satisfied** 2026-07-22, as ADR-0012 itself records |
| 2. Non-shipping spike evidence from `specs/009-catalog-binding-viability/` (go / explicit-heuristic-only / blocked), including a versioned envelope and the security/scale measurements | **Satisfied.** The spike ran, recorded one of the three enumerated verdicts, produced a versioned envelope, and captured scale evidence for all three passes. The envelope was produced on the synthetic pass; the real-corpus populated envelope is a separate open item, tracked as the clause-5 release gate |
| 3. A maintainer-authored reference oracle validating real entity/path outcomes, under independent adversarial review | **Unmet.** The oracle exists but carries a known-wrong expected result and must be re-frozen — see below |
| 4. Clean-clone / offline / adapter-boundary / release evidence passing | **Unmet, and not yet testable.** No package exists from which to collect the evidence |

Gate 2 is worth reading carefully, because it is easy to misremember as a
demand for success. It enumerates `blocked` among the verdicts that satisfy it.
ADR-0012 asked the spike to *produce evidence*, not to *return a particular
answer*.

The spike ran and recorded **`blocked`**, `blockedShortfall =
"envelope-or-scale-evidence-incomplete"`. Under
`contracts/evidence-bundle-and-verdict.md` §4 that forces `recommendation =
null`, and `spec.md`'s Output Recommendation section says even a `go-explicit`
would not have authorized a package: that "remains a separate, later,
explicitly-scoped feature." So the spike authorizes nothing on its own, and no
other artifact in the repository can supply the authorization in its place.

### The shortfall is one thing, and it is not the generator

`envelope-or-scale-evidence-incomplete` names two possible gaps. Only one fired.

**Scale evidence was captured for all three passes** — T052, T056 and T060 are
all `[X]`, aggregated by T061. The gap is entirely the envelope: of the three
required passes, only `synthetic` produced a populated `SnapshotEnvelope` (9
entities). Both real-corpus passes produced an honest rejection record instead,
because the generator correctly refused to emit a snapshot from a corpus it is
required to reject.

### SC-010 cannot be satisfied under the frozen inputs

This is the load-bearing finding, and it is not this record's discovery.
ADR-0015 established it while explicitly declining to benefit from it.

`community-plugins` at `92e9e4e09c76cc57f3475029b73e5ec84498a459` contains
`workspaces/nexus-repository-manager/plugins/nexus-repository-manager/catalog-info.yaml`:
two YAML documents, both `kind: Component`, both declaring
`metadata.name: backstage-community-nexus-repository-manager`. That name is 44
characters of lowercase alphanumerics and hyphens; it satisfies
`isValidObjectName`, as does every field the ADR-0015 admissibility check
examines on both documents.

Both documents are therefore fully admissible. This is a genuine duplicate of
*valid* entities — exactly the case `entity-identity.md` §3 exists to catch — and
ADR-0012's `owned-paths-fail-closed-atomic` assertion **requires** the whole
operation to abort. Two further facts close the door:

1. No admissibility rule can reach it. ADR-0015 says so in its own Trade-offs,
   and adds that none should: it is not a validity defect.
2. It cannot be substituted away. SC-010 names its three required passes
   explicitly — "community-plugins-derived, rhdh-plugins-derived, primary
   synthetic" — so the `community-plugins` pass is not fungible.

So SC-010 demands, from a named corpus, an outcome that the contract's own
mandated correct behaviour forbids. No implementation can satisfy it under
FR-001's frozen inputs, and no further evidence-gathering can change that. It is
not a bar the spike failed to clear; under those inputs it is a bar with no
clearance.

**The scope of that claim matters.** SC-010 is unsatisfiable *under the frozen
FR-001 pin*, not unsatisfiable in principle. Whether some other commit of
`community-plugins` lacks the duplicate is not established here — the duplicate
is present at the pin and on upstream's default branch, but this record does not
assert that no clean commit exists anywhere in that repository's history. The
reason not to go looking is governance, not impossibility; see Option D.

### ADR-0015 left a rescope route open, and named its toll

ADR-0015's Conditions of Acceptance 3 reads, in full:

> 3. **Feature 009 remains blocked.** Adopting this record reduces the number of
>    collisions and reclassifies the placeholder descriptors correctly. It does not
>    produce a populated `SnapshotEnvelope` for `community-plugins`. Feature 009 may
>    only leave `blocked` when the residual valid duplicate is separately resolved
>    or the success criterion is rescoped — and rescoping SC-010 is itself a
>    decision requiring a record.

Two routes, and a toll on the second. This record does not claim ADR-0015
*required* it; ADR-0015 expressly permits it, and would have been equally
satisfied by resolving the residual duplicate. But that duplicate is upstream's,
in a repository we do not control, and ADR-0015 itself holds that no
admissibility rule should reach it. Resolving it is not ours to do. So the
second route is the one available to us, and this record is the toll it named.

ADR-0015 also warned: "Anyone reading this record as a route to unblocking
feature 009 is reading it wrong." That warning is about ADR-0015's *own*
mechanism — admissibility does not clear the corpora, and this record does not
claim it does. The rescope clause is a separate provision of the same document,
which permits this route subject to a separate decision. This record is that
decision.

### What the criterion got wrong

SC-010 conflated two propositions: *the generator works* and *the corpus is
clean*. On synthetic input, where both held, they were indistinguishable. The
Nexus pair is the case that pulls them apart — a generator behaving exactly as
specified, against a corpus that cannot be snapshotted, producing a criterion
failure that says nothing whatever about the generator.

A criterion that a correct implementation cannot pass is measuring something
other than what it names.

### What the spike did establish

Against real third-party input — 156 `community-plugins` descriptor files (167
entity documents) and 38 `rhdh-plugins` descriptor files (39 entity documents),
not fixtures:

| Property | Evidence |
|---|---|
| Determinism (SC-001) | 11/11 gated invocations byte-identical |
| Whole-operation atomicity (SC-002) | 13/13 `runAborted=true`, `partialSnapshotProduced=false` |
| Trigger-class coverage | all 13 required `AtomicFailureRecord.triggerClass` values genuinely exercised through the full pipeline |
| Envelope rejection | tampered, stale, wrong-repository and malformed-kind all rejected |
| Repository isolation | demonstrated |
| Offline execution (FR-018) | rank-1 rootless Podman `--network none`, live-verified as genuinely blocking |
| Credential isolation | structural and empirical: zero credentials forwarded |
| Accept path, end to end | `synthetic` pass produced a populated 9-entity envelope |
| Scale evidence | captured for all three passes |
| Independent audit (T085) | fresh-context Claude Opus 4.8 — **PASS, zero defects** |

The reject path is proven on real corpora. The accept path is proven on
synthetic input only. That asymmetry is the real residual gap, and this record
gates on it rather than papering over it.

### The finding that matters most, and is not about safety at all

Of 156 `community-plugins` descriptor files, 23 carry any `metadata.annotations`
and **zero** carry `adrkit.io/owned-paths`. The annotation ADR-0012 pinned is
adrkit's own, and no third-party descriptor in the pinned corpora uses it.

Two consequences follow. First, against these two corpora a future adapter would
derive no owned paths at all, because neither corpus carries the annotation;
whether that generalizes to catalogs beyond the pin is not established here, and
this record does not assert it. The adapter's value is contingent on adopters
adding the annotation. Second — and this is why clause 5 below is worded as it is
— a real corpus in which every entity is annotation-absent would yield a
*populated envelope* while exercising none of the ownership derivation. "Ran
against real data" and "derived ownership from real data" are not the same claim,
and only the second evidences the mechanism. Neither, on its own, evidences that
anyone wants the annotation — that is a third claim, which clause 5 does not
attempt and this record does not make.

## Decision

**Rescope SC-010, and authorize the implementation work required to clear
ADR-0012's remaining production gates. This record does not itself authorize
releasing the adapter.**

1. **Spike 009 stands unmodified.** Its `blocked` verdict, `blockedShortfall`,
   evidence bundle, evidence index, task checkboxes and audit history are not
   retro-edited. No checkbox is flipped and no verdict is rewritten. It remains
   the honest record of what that contract returned, and this record does not
   re-run, re-open or re-decide it.

2. **The defect is located in SC-010**, not in the generator, not in ADR-0012's
   fail-closed contract, not in ADR-0015's admissibility rule, and not in the
   pinned Backstage field-format model. Each of those is correct: the generator
   aborted as required, and the pinned validators return the correct predicate on
   both Nexus documents. The criterion asked for something that correctness
   excludes.

3. **SC-010 is rescoped.** Its requirement of a populated `SnapshotEnvelope` from
   each of the three named passes is replaced by: *each required pass produces
   either a populated `SnapshotEnvelope`, or a deterministic, atomic,
   correctly-classified fail-closed rejection with no partial output; and at
   least one pass over a real corpus meeting clause 5's conditions produces a
   populated envelope.* A correct rejection of a defective corpus satisfies the
   criterion. Fabricating an envelope from one never does.

   This rescope is recorded here rather than applied by editing
   `specs/009-catalog-binding-viability/spec.md` in place. The spike's frozen
   text is its historical record; a future execution cites this record.

4. **Every other spike finding continues to bind.** In particular the eight
   `no-go` conditions, all of which were checked and none of which fired, remain
   the safety contract. This record overrides one criterion on the strength of a
   proof that it cannot be met under the frozen inputs. It is not authority to
   set aside a finding that is merely inconvenient, and emphatically not
   authority to rescope a criterion that an implementation simply failed.

5. **The accept-path gap is a release gate, not a waiver.** Before the adapter is
   released, and before any ADR-0014 rung-2 claim, it must have produced a
   populated, digest-verified envelope from a real corpus that is:
   - **third-party-sourced as input** — the descriptors are real, authored
     upstream, and otherwise unmodified — while the validation itself remains
     maintainer-owned and isolated. Per ADR-0014's honesty rules, maintainer
     reference verification is rung 2 and MUST NOT be described as external,
     third-party or community adoption; only the corpus data is third-party,
     never the validation;
   - **admissible** under ADR-0015, and free of duplicate canonical ids;
   - **genuinely annotated** — at least one non-empty `adrkit.io/owned-paths`
     annotation on a real entity, with the expected path matches specified
     independently and frozen in advance.

   **The annotation may be a maintainer-authored overlay, and this gate does not
   depend on anyone else adopting it.** No third-party descriptor in the pinned
   corpora carries `adrkit.io/owned-paths`, so requiring an externally-authored
   annotation would make release contingent on external adoption — which ADR-0014
   forbids as a blocker and ADR-0012 gate 3 calls "welcome as an optional later
   production-maturity signal … **not** a hard gate." ADR-0012 gate 3 already
   names the permitted construction: "synthetic explicit annotations over pinned
   public corpora under independent adversarial review." This clause adopts that
   same input-provenance construction — annotations added by us, over real
   upstream descriptors left otherwise untouched — and inherits its control as
   well as its shape: **the accept corpus, its overlay and its expected paths are
   frozen and independently audited as part of clause 6's fresh T014 → T014a
   cycle, before any generator output is produced.** A one-off overlay on a
   hand-picked descriptor, audited by nobody, does not satisfy this clause. The
   corpus's selection basis and size are fixed and recorded in that same cycle,
   not chosen afterwards, and **that audit must record an explicit finding that
   the corpus is adequate for the claim being made**; an audit that passes on
   integrity without reaching adequacy does not satisfy this clause. No minimum
   entity count is fixed here, deliberately: ADR-0012 holds that production
   limits are "**not** guessed now; they must be ratified from evidence," so
   adequacy is a recorded judgement by an independent reviewer against the frozen
   corpus, never a number invented by this record.

   **Freezing the expected paths is not enough; the output must be compared
   against them.** A populated, digest-verified envelope proves integrity, not
   correctness — a semantically wrong envelope can carry a perfectly valid
   self-digest. The gate is met only when the generator's derived ownership for
   every annotated entity is diffed against the frozen expectations and matches
   with **zero false positives and zero false negatives**; any mismatch fails the
   gate, and the expectations are never amended to fit the output. This is the
   standard ADR-0012 already names as production-readiness evidence — "bounded
   zero false positives/negatives across positive/negative/overlap/absent/
   collision/repo-mismatch cases" — and it is stated explicitly here because
   spike 009's own oracle was, on its evidence index's admission, "not an
   executed test harness": expectations were frozen and then never diffed against
   anything. The pre-output freeze/audit and the post-output comparison are two
   distinct steps, each recording its own hashes and its own PASS/FAIL.

   What that construction buys, and what it does not: it exercises the ownership
   derivation against real descriptor structure and real field shapes, at
   whatever scale the audited corpus fixes — an increment over the spike's
   fabricated entities, and the reason "at least one annotated entity" is a floor
   rather than a target. It gates technical compatibility only. It does not
   evidence that the mapping reflects anyone's actual ownership, that anyone else
   wants the annotation, or that adoption risk has fallen; adoption remains
   entirely ungated, as ADR-0014 permits. An all-`annotation-absent` corpus
   satisfies none of this, since it yields a populated envelope while exercising
   no derivation at all; and wholly synthetic entities satisfy none of it, since
   the spike already proved that path.

6. **ADR-0012 gate 3 remains open and is not waived.** The reference oracle must
   be re-frozen before it can validate anything: any future feature-009
   execution, and any implementation work deriving from one, begins with a fresh
   T014 → T014a cycle — correct the `derivedPathPatterns` ordering, re-freeze,
   re-hash, obtain a new independent pre-output audit — *before* producing
   generator output. ADR-0015's Condition of Acceptance 1 already notes the
   scratch bundle is untracked, so nothing in the repository will stop someone
   reusing a stale copy. This record adds no control it does not have; it repeats
   the clause because repetition is the control.

7. **The work inherits, as requirements rather than as guidance:**
   - ADR-0012 — the `adrkit.io/owned-paths` contract, the restricted glob
     dialect, whole-operation atomic fail-closed semantics, the single-repository
     boundary, and the versioned envelope.
   - ADR-0015 — admissibility before canonicalization, with
     `inadmissible-descriptor` as a fatal whole-operation trigger.
   - ADR-0013 — a standalone offline generator; **no dynamic runtime
     adapter/plugin loader**.
   - ADR-0007 — adapter isolation. `packages/core`, `packages/cli` and `schema/`
     import nothing from it; it is versioned independently, its semver contract
     being with Backstage rather than with `@adrkit/core`.
   - FR-021 — a `CatalogSnapshot`-shaped artifact is derived from the envelope
     only after that envelope independently passes every validation and digest
     check. The generator writes the envelope and nothing else.
   - No B/C/D comparison heuristic carries into production. Those were
     measurement instruments, labelled `non-authoritative` by their own contract.

8. **Clause 5 gets an executable gate, observed failing first** (ADR-0016). The
   frontmatter assertion on this record is **currently inert** and must not be
   mistaken for enforcement: `engine: custom` resolves through an optional
   registry port, and with no port registered the evaluator returns
   `status: 'inert'`, `reason: 'assertions-compile.engine-absent'` — it never
   fails. It records the rule; it does not enforce it. Enforcement is a CI check
   tied to release, and like every other gate here it counts as coverage only
   once it has been watched failing.

9. **Release vehicle and release authorization are both deferred.** Publish
   target, tag and channel are a separate decision, as they were for
   `@adrkit/spec-kit`. So is the decision to release at all, which belongs to a
   later record made once clause 5 and ADR-0012 gates 3 and 4 are all
   demonstrably met.

Per ADR-0014 this authorizes work toward rung 1, which that record calls
"necessary, never sufficient on its own to land a phase whose value is an
operational surface." A catalog adapter is such a surface. Nothing here is
reference-verified or externally validated, and neither this record nor the
package may claim otherwise. Phase 6's status is unchanged in both directions.

## Options considered

### Option A: Rescope SC-010, and authorize the work but not the release (chosen)

Costs one ADR. States plainly which criterion was set aside, on what proof, and
what was not set aside with it. The override is reviewable, and the reasoning
survives for whoever later finds a `blocked` verdict in the history and an
adapter beside it.

The two halves are separable — the rescope alone is actionable, since a future
feature-009 execution would cite it — but they are recorded together because
they share one warrant and one set of conditions. Splitting them would duplicate
the Nexus analysis across two records and invite the second to be read without
the first's limits. What is *not* bundled is the release decision, which rests on
evidence nobody has yet, and which clause 9 defers.

### Option B: Treat `blocked` as binding; leave the adapter unbuilt

Maximally deferential to the record. But it lets a criterion that no correct
implementation can pass permanently veto a capability, on the strength of a
defect in someone else's repository that ADR-0015 already established is not
ours to fix. It also teaches that a criterion outranks a proof that the criterion
cannot be met.

### Option C: Re-run spike 009 and try to reach `go-explicit`

The right option if the mechanism evidence were thin. It is not, and under the
frozen inputs the re-run cannot succeed: SC-010 names `community-plugins`
explicitly, the Nexus duplicate is fully admissible, and the abort is mandatory.
A re-run pays a full spike cycle — fresh oracle, fresh audit, eleven gated
invocations — to reach the same verdict by the same route. Rejected as ceremony,
and recorded so the choice is visible.

### Option D: Re-pin the corpora to a commit without the duplicate

Rejected on governance grounds, not on a claim that no such commit exists. FR-001
freezes the three research commits and requires re-verification of *those* SHAs,
never reselection; changing them is a spec re-ratification. And selecting a
corpus because it produces the desired outcome is corpus-shopping, which would
impair comparability with every measurement already recorded against the pin. The
duplicate is present at the pin and on upstream's default branch, which is why
re-pinning is not a cheap fix — but "there is no clean commit anywhere in that
history" is a claim this record does not make and does not need.

### Option E: Rescope SC-010 to accept synthetic evidence alone

The smallest edit that turns the verdict green, and the wrong one. It would
discard the only requirement that keeps the adapter honest about real input.
Clause 5 exists precisely to prevent this reading of clause 3 — and its
annotation requirement exists to prevent the subtler version, where a real but
wholly unannotated corpus produces a populated envelope that proves nothing.

## Trade-offs

**This is the second recorded verdict to be set aside, and the first is two days
old** — ADR-0019 is dated 2026-08-01. ADR-0019 was careful to say it "does not
establish that verdicts are advisory." Two such records in three days establish
more of a pattern than one, whatever either says about itself, and that pattern
is the real cost here.

The mitigation is the shape of the warrant, which differs from ADR-0019's. That
record rested on the spike's *own disclosure* that its bar was misapplied. This
one rests on a proof, established by a different record (ADR-0015) that
explicitly refused to draw this conclusion from it, that the criterion admits no
passing implementation under its own frozen inputs. That is checkable by anyone
against a pinned commit, without deferring to a reviewer's judgement.

The distinction worth preserving for the next such record: **a criterion that a
correct implementation cannot pass may be rescoped; a criterion an
implementation merely did not pass may not.** A record citing this one without
carrying that sentence is over-reading it.

**The adoption problem is unsolved and this record does not solve it.** Zero
third-party descriptors in the pinned corpora carry the annotation. Building the
adapter does not create demand for it, and it may sit correct and unused. Clause
5 does **not** gate that risk: it gates technical compatibility against real
descriptor structure, and it is satisfiable by a maintainer-authored overlay, so
the adapter could clear every gate in this record and still release into zero
demand. Adoption remains entirely ungated, which is what ADR-0014 requires — rung
3 may never block release. The underlying bet is strategic, not evidentiary, and
should be recognised as such.

**Rescoping a spike's criterion after seeing its results is exactly the shape of
motivated reasoning.** The check ADR-0015 applied to itself applies here: does
the reasoning survive not delivering the convenient outcome? It does. Clause 1
leaves the `blocked` verdict standing, clause 5 leaves release gated on evidence
nobody has, clause 6 leaves ADR-0012 gate 3 open, and clause 8 concedes that this
record's own assertion currently enforces nothing. A rescope that delivered an
unconditional green would deserve the suspicion.

## Consequences

- Easier: implementation work can begin against a named, still-open gate list
  rather than against a `blocked` verdict with no route out; ADR-0009's
  `CatalogPort` gets a real producer in prospect; ADR-0007's isolation boundary
  will be exercised on a package with runtime code.
- Harder: an upstream to track; a second override precedent to keep narrow; an
  accept-path obligation that cannot be discharged from the pinned corpora; and
  an executable release gate to build and watch fail before it is trusted.
- Unchanged: spike 009's `blocked` verdict; ADR-0012 gates 3 and 4; the
  frozen-oracle blocker; Phase 6's landed / reference-verified status with rung 3
  open; ADR-0015's admissibility rule and its conditions of acceptance.
- Revisit if: no corpus meeting clause 5 can be identified or constructed, which
  would leave real uptake unverified and the clause-5 gate unmet, and would put
  shipping the adapter back in question; Backstage's catalog model or entity
  validators change shape at a new pinned commit; or a third override of a
  recorded verdict is proposed, at which point the pattern needs its own record
  rather than a third precedent-by-instance.

## Review history

Two independent adversarial reviews from fresh contexts, across two model
lineages, over four rounds before ratification — eight reviews in total. Each
round after the first was bounded to the diff the round before it produced.

**Round 1: both returned FAIL.** Every finding was accepted; none was argued
away.

The round-1 reviews **disagreed on the central question**, and the disagreement
is recorded rather than resolved silently. One judged the production
authorization a disclosed strategic bet and therefore acceptable. The other
judged it unwarranted and traced ADR-0012's four-item production gate — which the
draft had never cited, having instead misattributed the gate to ADR-0012's action
item 1, a framing inherited from `specs/009-catalog-binding-viability/plan.md`'s
prose rather than read from ADR-0012 itself. That gate list is objective, and
gate 3 is unmet. The second review was upheld: the draft's outright authorization
of a production adapter became clauses 5, 6 and 9 of the present record, which
authorize the work and defer the release.

Other round-1 findings corrected: the claim that ADR-0015 *required* this record
(it expressly permits it, subject to a separate record — the residual duplicate
may alternatively be resolved); "unsatisfiable by construction" narrowed to the
frozen inputs, and Option D's rejection re-grounded on FR-001 and comparability
rather than on an unsupported claim that no clean commit exists; "Backstage
behaved correctly" narrowed to the pinned validators' predicate — the same class
of system-level overclaim found repeatedly across ADR-0015's own five-round
review history; the frontmatter assertion disclosed as inert rather than implied
to enforce; the rung-2 wording separated from ADR-0014's prohibition on calling
maintainer verification third-party; descriptor *file* counts distinguished from
entity-document counts; silent bold emphasis removed from the ADR-0015
blockquote; and Option A's argument for bundling corrected, since it had
contradicted clause 3 by claiming the rescope alone was unactionable.

One further round-1 defect, found independently by both reviews: the draft called
ADR-0019 "barely a month old" when the two records are dated two days apart — a
false claim about a frozen artifact, and the sharper figure strengthens the point
it appears in.

**Round 2 split: one PASS, one FAIL.** The PASS verified all fifteen corrections
against source and confirmed the two riskiest additions — the rescope-route
argument and clause 8's inert-assertion mechanism claim — including checking the
latter's exact reason code against the evaluator source and its test. The FAIL
raised seven findings, all accepted, of which one was blocking and had been
**introduced by the round-1 corrections**: clause 5 required a corpus that was
both third-party-authored and carried `adrkit.io/owned-paths`, which no
third-party descriptor does — making the gate either unmeetable or dependent on
external adoption, contrary to ADR-0014 and to ADR-0012 gate 3's own "not a hard
gate." Clause 5 now explicitly permits a maintainer-authored overlay, in the
construction ADR-0012 gate 3 already names, and states plainly what that buys and
what it does not.

Also corrected in round 2: the release decision in clause 9 and action item 7 had
omitted clause 5 from its own prerequisites, a loophole in the record's central
safeguard; gate 4's status read "not yet applicable" when it is unmet and not yet
testable, which contradicted Consequences; a claim about "real-world Backstage
catalogs today" generalized beyond the two pinned corpora and used the present
tense for a package that does not exist; "no real uptake" overstated what an
unsuccessful corpus search could establish; the new section's heading said
"exactly one door" while its own next sentence said "two routes"; and this
section had attributed all five of ADR-0015's review failures to a single defect
class.

The convergence pattern is worth recording, since ADR-0015 flagged it first:
round 2's blocking finding existed only because round 1's correction created it.

**Round 3: both returned FAIL, converging on one defect.** Independently, both
reviewers found that the round-2 fix to clause 5 had been applied to the body and
the action items but **not to the frontmatter assertion**, which still demanded a
third-party-sourced corpus that itself carried the annotation — re-encoding the
round-2 blocking defect in the one artifact this project treats as the
enforceable rule of record. Two lineages reaching the same finding from separate
reads is the strongest signal any round produced. The assertion now carries the
overlay allowance, the audit requirement, and the non-contingency on adoption.

One reviewer additionally found, and the other did not, that clause 5 claimed
"the same shape" as ADR-0012 gate 3's *independently audited* oracle while
requiring no audit, no selection basis and no size — so a single hand-picked
descriptor with one overlaid annotation would have cleared the release gate,
and the accompanying claim to exercise "real cardinality" was false at that
floor. Upheld: clause 5 now binds the accept corpus, its overlay and its expected
paths into clause 6's fresh T014 → T014a cycle, inheriting the audit rather than
merely citing the construction. The same reviewer found two passages still
crediting a maintainer overlay with evidencing ownership or reducing adoption
risk, contradicting clause 5's own concession; both are corrected, and the
Trade-offs section now states plainly that adoption is entirely ungated and the
adapter could clear every gate here and release into zero demand.

Three rounds found substantive defects in every round, and in two of three the
defect was created by the previous round's correction.

**Round 4 split: one PASS, one FAIL — and the FAIL prevailed on the merits.**
The PASS verified every round-3 correction against source, checked the assertion
line-by-line against clause 5, and cleared the circularity question (the gating
is a partial order: freeze/audit → generator output → gates → release decision).
But it never asked the question the FAIL asked, and that question found the
sharpest defect of the whole process: **clause 5 froze the expected paths and
then never required anything to be compared against them.** A populated,
digest-verified envelope proves integrity, not correctness; a semantically wrong
envelope carries a perfectly valid self-digest. The gate could have been cleared
by output that was simply wrong. Worse, this reproduced a defect the record was
written to avoid — spike 009's own oracle was, on its evidence index's
admission, "not an executed test harness," expectations frozen and never diffed.
Clause 5 now requires a post-output comparison at zero false positives and zero
false negatives, the standard ADR-0012 already names, as a step distinct from the
pre-output audit.

The same review found that "at least one annotated entity … a floor rather than a
target" set no enforceable adequacy bar, so an audited single hand-picked
descriptor still satisfied the letter. The defect is accepted; its proposed
remedy — fix an exact minimum count — is **not**, because ADR-0012 requires that
production limits "must be ratified from evidence" rather than guessed, and
inventing a number here would breach the record it relies on. Instead the
independent audit must now record an explicit adequacy finding, which converts an
aspiration into a named judgement by a named party without guessing a threshold.

Both reviews also considered whether the frontmatter assertion had drifted from
clause 5 again, and **disagreed**. The PASS found the assertion "less detailed …
but asserts nothing the body denies" and cleared it. The FAIL held that an
assertion omitting the body's selection-basis and size controls is enforceable
as written and therefore weaker than the clause it encodes. The FAIL was upheld:
clause 8 designates this assertion as the rule a future CI gate compiles from, so
"less detailed" is precisely the defect, and the PASS's own round-3 review had
demanded the assertion be self-contained. The drafting session had independently
found the same omission before either review returned. The assertion now carries
the selection basis, the size, the adequacy finding and the post-output
comparison.

Four rounds, eight reviews, and every round found at least one substantive defect
— three of them in the accept-path gate, each created by the previous round's fix
to it. Review rounds here are not reliably convergent, and the ratification
standard is the maintainer's to set rather than inherit. Round 4's own
corrections have not themselves been reviewed.

## Action items

1. [ ] Open the production feature spec for `packages/adapters/catalog-backstage/`
       under the constraints above, citing this record for the SC-010 rescope
2. [ ] Begin any generator-derived work from a fresh T014 → T014a oracle
       re-freeze and independent pre-output audit — ADR-0012 gate 3 (clause 6)
3. [ ] Freeze and independently audit the clause-5 accept corpus — real
       third-party descriptors, admissible, collision-free, carrying a
       maintainer-authored `adrkit.io/owned-paths` overlay with expected paths
       fixed in advance — as part of the same T014 → T014a cycle as action item
       2, recording its selection basis and size and an explicit adequacy finding
4. [ ] After the run, diff the generator's derived ownership for every annotated
       entity against those frozen expectations, requiring zero false positives
       and zero false negatives, and record that comparison's own PASS/FAIL
       separately from the pre-output audit (clause 5)
5. [ ] Build the clause-5 release gate as an executable CI check, and observe it
       failing before trusting it (ADR-0016)
6. [ ] Enforce the ADR-0007 isolation boundary for the new package with a check
       observed failing first
7. [ ] Clear ADR-0012 gate 4 (clean-clone / offline / adapter-boundary / release
       evidence) once the package exists
8. [ ] Decide release authorization and release vehicle in their own record, once
       clause 5 and ADR-0012 gates 3 and 4 are all met — not here
