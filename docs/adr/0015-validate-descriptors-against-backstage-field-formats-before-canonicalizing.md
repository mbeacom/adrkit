---
schemaVersion: 0.1.0
id: "0015"
title: Validate descriptors against Backstage field formats before canonicalizing identity
status: proposed
date: 2026-07-25
deciders: ["@mbeacom"]
tags: [catalog, governance, matching, core]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0009", "0012", "0013"]
affects:
  - type: path
    pattern: "packages/core/src/affects/catalog.ts"
  - type: path
    pattern: "packages/adapters/catalog-*/**"
  - type: path
    pattern: "specs/009-catalog-binding-viability/contracts/entity-identity.md"
provenance:
  authoredBy: agent-drafted
review:
  tier: arb
  tierReason: >-
    Adds a precondition to the canonicalization step ADR-0012 pins, and adds a
    trigger condition to its org-scope, one-way-door atomic fail-closed clause.
    ADR-0013 set the precedent that narrowing or extending a frozen clause of an
    org-scope record takes the ARB tier. A misjudged admissibility rule silently
    removes entities from governance reach entirely, so that no ADR assertion
    ever fires against them — an org-wide consequence irrespective of how narrow
    the rule's own mechanism is.
assertions:
  - id: entity-admissibility-precedes-canonicalization
    description: >-
      Every catalog descriptor is checked against Backstage's own field-format
      validators, at the commit pinned by ADR-0012, before any canonical
      identity is computed for it. A descriptor that fails that check aborts the
      entire snapshot operation with a non-zero status, a distinct
      inadmissible-descriptor trigger class, and no usable partial output. It is
      never canonicalized, never compared for identity, and never silently
      dropped or excluded from the input set.
    engine: custom
    expression: entity-admissibility-precedes-canonicalization
    input: catalog
    severity: error
externalRefs:
  - type: issue
    id: "25"
    url: "https://github.com/mbeacom/adrkit/issues/25"
    label: Decide catalog entity-to-path binding before feature 009
reviewBy: 2027-01-25
---

# ADR-0015: Validate descriptors against Backstage field formats before canonicalizing identity

> **Status: `proposed`. This record is a draft for maintainer review and is not
> ratified.** It authorizes nothing on its own. In particular it does not claim
> that feature009 is unblocked, does not authorize any spike task, re-run, or
> generator invocation, and does not sanction any production catalog adapter.

## Context

ADR-0012 pinned the catalog entity-to-path binding contract against a frozen
Backstage commit, `1121a4facd9e321179d0402c3f355e4a649e84d9`, and located the
identity rules in `specs/009-catalog-binding-viability/contracts/entity-identity.md`.
That contract's §1 defines canonicalization as exactly two steps:

1. If `metadata.namespace` is omitted, default it to `default`.
2. `canonicalId := ${K}:${NS}/${N}`, lowercased in full.

**There is no admissibility or validation step anywhere ahead of those two
steps**, and nothing under `specs/009-catalog-binding-viability/**` references
Backstage's entity-name validators at any point. Whatever string appears at
`metadata.name` is accepted as a name and folded into a canonical identity.

At the same pinned commit, Backstage's own catalog model does not treat those
fields as free-form.
`packages/catalog-model/src/validation/makeValidator.ts` binds four **distinct**
per-field validators, and `FieldFormatEntityPolicy` applies them to every entity
it is invoked on:

| Field | Validator binding | Predicate | Applied |
|---|---|---|---|
| `apiVersion` | `isValidApiVersion` → `CommonValidatorFunctions.isValidPrefixAndOrSuffix` | prefix is a DNS **subdomain** (`CommonValidatorFunctions.isValidDnsSubdomain`, ≤253 total, each dot-separated label ≤63); suffix is `/^[a-z0-9A-Z]+$/`, ≤63 | required |
| `kind` | `isValidKind` | `/^[a-zA-Z][a-z0-9A-Z]*$/`, ≤63 | required |
| `metadata.name` | `isValidEntityName` → `KubernetesValidatorFunctions.isValidObjectName` | `/^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/`, ≤63 | required |
| `metadata.namespace` | `isValidNamespace` → `KubernetesValidatorFunctions.isValidNamespace` → `CommonValidatorFunctions.isValidDnsLabel` | `/^[a-z0-9]+(?:\-+[a-z0-9]+)*$/`, ≤63 | **only when present** |

Two further properties of the `apiVersion` binding, since the split is not
obvious from the predicate alone: `isValidPrefixAndOrSuffix` splits on `/` and
**rejects any value containing two or more separators**, and a value with **no**
separator is validated against the suffix predicate alone — so a bare `v1`
passes without the subdomain rule ever being consulted.

Every row in this table was verified by executing the pinned sources directly;
see "How these bindings were checked" below.

The consequence is a category error in the contract, and it is not hypothetical.
Sixteen descriptors in the two corpora feature009 pinned — five in
`community-plugins` at `92e9e4e09c76cc57f3475029b73e5ec84498a459`, eleven in
`rhdh-plugins` at `3b355ddfedb23c6656bd9effc8510f9926b765c1` — carry an
unsubstituted, un-rendered scaffolder placeholder at `metadata.name` rather than
a name. Fourteen of them (five and nine respectively) carry the identical string
`${{ values.name | dump }}`. The remaining two, both in `rhdh-plugins`, carry
`${{ values.name }}` (`bulk-import`) and `${{ values.entityName }}`
(`orchestrator`) — equally unsubstituted, but distinct strings that canonicalize
distinctly. All three forms fail `isValidObjectName` on character class: `$`,
`{`, `}` and the spaces are outside the permitted set in every case, and `|` in
the first, while ordinary descriptor names pass the same predicate unchanged.
Backstage's own `metadata.name` validator rejects every one of these
descriptors. The contract instead accepts each as a well-formed name, lowercases
it, concatenates it — and, for the fourteen that share a string, reports the
result as `triggerClass: "duplicate-canonical-id"`.

The other two are the sharper case, and the reason this is a contract gap rather
than a reporting one. Being canonically distinct, they collide with nothing.
They are exactly as invalid as the other fourteen, and the contract has no
mechanism of any kind that would notice. The duplicate rule catches the fourteen
only incidentally, as a side effect of their sharing a string; behind it there is
nothing. Duplicate detection is not a validity check, and the corpus contains two
descriptors demonstrating that the conditions come apart.

**The fail-closed rejection there is correct and required by §3.** What is wrong
is the *classification*: a descriptor that is not a valid Backstage entity at all
is being characterized as an identity collision *between valid entities*. Those
are different defects with different remedies, and the contract currently cannot
tell them apart, because it never asks whether the descriptor is a valid entity
in the first place.

This record exists to close that gap. It is warranted by the validator bindings
above and by nothing else.

### How these bindings were checked

Action item 2 of the first draft called for an independent review from a fresh
context. That review was performed by a `claude-opus-5` reviewer with no
authorship of this record, against
`1121a4facd9e321179d0402c3f355e4a649e84d9`. **It returned FAIL**, with three
blocking defects in the table above. All three are corrected here, and are
recorded rather than quietly fixed:

1. **A cited member did not exist.** The namespace row read `isValidNamespace` →
   `KubernetesValidatorFunctions.isValidDnsLabel`. `KubernetesValidatorFunctions`
   has no such member; the chain runs through
   `KubernetesValidatorFunctions.isValidNamespace` to
   `CommonValidatorFunctions.isValidDnsLabel`. The quoted regex was correct
   throughout; the class attribution was not.
2. **The `apiVersion` bound was understated.** "≤63 per part" was wrong for the
   prefix, which is a DNS *subdomain*: ≤253 in total with each dot-separated
   label ≤63. A 243-character prefix passes. The two-separator rejection and the
   suffix-only path for unseparated values were also unstated.
3. **An ordering claim exceeded the evidence.** The draft asserted that the
   contract "never asks the question Backstage itself asks first" and that
   Option A "matches Backstage's own ordering". Neither is established by the
   four cited files: they contain no uniqueness, duplicate, conflict, collision
   or dedup logic of any kind, and `FieldFormatEntityPolicy` is a per-entity
   `EntityPolicy.enforce` with no cross-entity comparison. Catalog-wide
   uniqueness lives in `plugin-catalog-backend`, outside this record's cited
   evidence. Both phrases are **removed**, not substantiated.

Defect 3 is the one worth dwelling on, because the correct response to it was to
drop the claim rather than go looking for support. This record's stated warrant
is the validator bindings "and nothing else"; an appeal to Backstage's internal
ordering is outside that warrant even if it happens to be true. Ordering
admissibility ahead of canonicalization is adrkit's own decision and needs no
upstream precedent. Removing the appeal makes the record narrower and stronger.

Every row of the table was subsequently re-verified by executing the pinned
sources directly — `makeValidator.ts`, `KubernetesValidatorFunctions.ts` and
`CommonValidatorFunctions.ts` fetched at the pinned commit and run — confirming
that `isValidEntityName` and `isValidNamespace` are reference-identical to their
`KubernetesValidatorFunctions` counterparts, that `KubernetesValidatorFunctions`
exposes no `isValidDnsLabel`, and that a 243-character `apiVersion` prefix passes
while a 254-character one, an over-63 label, and a two-separator value all fail.

The reviewer pre-cleared the outcome of these corrections: *"On re-review after
these three corrections, items 1, 2 and 4 stand verified and the record's core
warrant is sound."* That is a conditional clearance of the corrections, **not** a
ratification of the record, which remains `proposed`.

**Residual limit.** "Applies them to every entity" above is now qualified to
"every entity it is invoked on". The cited files show what
`FieldFormatEntityPolicy.enforce` does when called; they do not show its
installation in any particular catalog pipeline, and this record does not assert
it.

### Reviews two, three and four: all FAIL

A second, different-lineage pass by a `gpt-5.6-sol` reviewer, and third and
fourth `claude-opus-5` passes each bounded to the preceding diff, all returned
**FAIL**. Every substantive element was confirmed by every reviewer, across two
lineages —
the validator bindings and predicate bodies, the executed regexes, the counts,
the over-length pair, the residual Nexus duplicate, the governance metadata, and
this record's own honesty about the review standard. **The core warrant is not
what has been failing. Prose precision is** — and, four times over, prose *about
the failures themselves*.

Ten corrections followed: five from the second review, four from the third, and
one — the last — from the third and fourth together, which found the same
passage wrong in two different ways. All are in surrounding narrative; none
touched the decision, the options, or any figure. They are enumerated in full
because the alternative, fixing quietly, is the failure this section exists to
avoid.

1. **A separability claim was false.** The evidence index asserted that two
   distinct enumeration mistakes each *independently* inflated the placeholder
   count. Executing all four combinations shows they are conjunctive for that
   count — only making *both* reaches the wrong figure — though path matching
   alone does still corrupt the file and document counts. Corrected there, with
   the four-way table.
2. **"Both unsubstituted forms"** was wrong: the pinned corpora contain three.
3. **"The placeholder descriptors recorded above at least collide"** was wrong:
   `bulk-import`, and later `orchestrator`, canonicalize uniquely and collide
   with nothing. The phrase "these two" in that passage refers to the two
   over-length names and was **never** wrong; only the contrast around it was.
4. **"Backstage would reject … outright"** overstated the cited evidence in
   exactly the way the ordering claim did. The four files establish what the
   validators do *when applied*; they do not establish that any particular
   Backstage deployment applies them.
5. **"Depth-based heuristics do not" separate the two lines** was too
   categorical. Indentation *can* distinguish them here — 2 spaces versus 10.
   The argument for structural extraction is fragility, not incapacity: depth
   depends on formatting YAML does not constrain.
6. **The sweep for correction 4 was itself incomplete while claiming
   completeness.** One instance survived in Option E, undetected because the
   phrase wrapped a line break and the sweep was line-oriented. Now corrected,
   and re-run whitespace-normalised.
7. **The predecessor of correction 1 survived 40 lines above its replacement**,
   still asserting that skipping structural extraction "will over-count" — which
   correction 1 disproves. Corrected.
8. **A passage about false universals contained one.** It said the third
   placeholder form "invalidated **every** sentence that had quantified over
   'both forms' or 'these two'". It did not.
9. **A section lead-in contradicted its own conclusion** — "Why this case is the
   harder one" introducing a paragraph that calls the pair the *cleanest* case.
   Retitled to match what the paragraph argues.
10. **The provenance account below was wrong twice**, in the way set out next.

#### Where these defects actually came from

This account has now been wrong twice, in opposite directions, and the second
wrong version was mine.

It was first written as prose "added after the first review", making the lesson
*revision between reviews is risky*. Corrected once to say two of the three
second-review defects pre-dated the first review, it was then corrected again —
by this record — to claim that "Both unsubstituted forms" had been **true when
written** and only became false when the third placeholder form was found. That
second correction was well-argued and wrong, and it was accepted without being
tested against the corpus.

Checked properly, against `4773d25` and against the pinned corpora themselves:

| Second-review finding | Present at `4773d25`? | True when written? | Origin |
|---|---|---|---|
| Separability | no — added at `b1b60c2` | no | **Self-inflicted** |
| "Both unsubstituted forms" | **yes** | **no** — the pinned corpus already held three | **Pre-existing**, missed by review 1 |
| "…at least collide" | no — added at `2e85fa6` | **no** — `bulk-import` was recorded as non-colliding in a table in the *same commit* | **Self-inflicted** |
| "Backstage would reject …" | **yes** | **no** | **Pre-existing**, missed by review 1 |

Two pre-existing misses and two self-inflicted. But the column that matters is
the third one:

**None of these was ever true.** Every one was false the moment it was written.
The category this record previously reached for — "accurate when written, later
falsified" — turns out to be empty, and the "we didn't know that yet" defence
never applied to any of them.

##### Why the wrong version was tempting

The reasoning was: only two placeholder forms were *known* when the sentence was
written, so the sentence was accurate then. **That conflates what the author had
enumerated with what was true.** The claim was "Both unsubstituted forms
**present in the corpora**" — an assertion about a corpus frozen at
`3b355ddfedb23c6656bd9effc8510f9926b765c1`. `${{ values.entityName }}` was in
that tree on the day the sentence was written and every day before and since.
The corpus cannot change, so the statement's truth-value does not depend on when
anyone looked at it. It was false on arrival.

This is the same failure the record keeps producing, one level up: **a claim
indexed to the author's knowledge state rather than to the object it is about.**
Ordering claims indexed to an assumption about Backstage rather than to the
predicate. Counts indexed to an inherited enumeration rather than to the corpus.
And here, a provenance claim indexed to what had been noticed rather than to what
the frozen tree contained.

The consequence is worth stating plainly, because it cuts against this record's
own interest: for a claim about a pinned artifact, the pre-existing-defect class
is **larger** than it looked and there is no window in which such a claim is
excusably true. That also makes it more tractable — anything of this shape is
checkable against the artifact at any time, by anyone, without a reviewer's
judgement.
#### Two root causes, each with a general form

**The warrant is a set of pure predicates read at a pinned commit.** Any sentence
about what Backstage as a **system** does — its ordering, its acceptance, its
rejection — reaches past that warrant even when it is probably true. Corrections
4 and 6 are both instances. The reliable form is to state what the predicate
returns.

**A count change does not falsify prose; it reveals prose that was already
false.** This was previously recorded the other way round — as "a count change is
never local", with the third placeholder form said to have *invalidated*
surrounding sentences. It did not. "Both unsubstituted forms" was already false
against the pinned corpus; "…at least collide" was already false against a table
in its own commit. What the count change did was make them **findable**.

The practical guidance is nearly the same and the reasoning is not, which
matters. Re-read quantified prose when a count changes — not because the change
broke it, but because the change is often the first occasion anyone re-reads it.
And do not treat "this was written before we knew" as establishing that a
sentence was once correct: for claims about a pinned artifact, there is no such
window.

One caution against pattern-matching, since the previous version of this passage
over-generalised: not every nearby quantifier was wrong. "These two" in the
over-length finding refers to a different pair and was correct throughout. The
work is re-reading, not substituting a digit.

## Decision

**A descriptor MUST be admissible before it is canonicalized.** Admissibility is
evaluated against Backstage's own field-format validators at the commit ADR-0012
pins, and it is evaluated *before* `entity-identity.md` §1 runs.

### The admissibility check

A descriptor is **admissible** when all of the following hold at the pinned
commit's semantics:

- `apiVersion` is present and satisfies `isValidApiVersion`.
- `kind` is present and satisfies `isValidKind`.
- `metadata.name` is present and satisfies `isValidEntityName`.
- `metadata.namespace`, **if and only if present**, satisfies `isValidNamespace`.

An omitted `metadata.namespace` is admissible; §1's `default` substitution
applies afterwards, unchanged. The namespace is validated as authored, never
after defaulting.

### Ordering

Admissibility is a precondition of §1, not a step inside it. §1's two steps and
its worked casing/namespace examples are untouched, and §3's duplicate-collision
table is untouched. No canonical identity is computed for an inadmissible
descriptor, so no inadmissible descriptor can participate in a uniqueness
comparison.

### Failure semantics — fail-closed is preserved exactly, not relaxed

An inadmissible descriptor **aborts the entire operation** with a non-zero
status and no usable partial output, under a new, distinct trigger class
`inadmissible-descriptor`, carrying the offending path, the failing field, and
the validator that rejected it.

Inadmissible descriptors are **not** filtered, skipped, excluded from the input
set, or treated as non-entities. This record adds a failure *class*; it removes
no failure. Every condition that aborts a run today still aborts a run.

### Relationship to the existing collision rule

`duplicate-canonical-id` retains its exact current meaning: two or more
**admissible** descriptors canonicalizing to the same identity. Because
admissibility runs first, a corpus containing both inadmissible descriptors and a
genuine collision between valid entities will now report the inadmissible ones,
which is the earlier and more specific defect.

**This narrows what `duplicate-canonical-id` reports; it does not make either
condition non-fatal.** A corpus that fails today fails after this change too. The
report says something truer about *why*.

## Options considered

### Option A: Validate before canonicalizing; distinct fatal `inadmissible-descriptor` class (chosen)

Preserves fail-closed exactly and corrects the classification. Strictly additive
on the failure surface; removes no abort. The ordering — admissibility before
canonicalization — is adrkit's own design choice, made because a validity
question and an identity question are different questions and the cheaper,
per-descriptor one should not be answered by the more expensive cross-descriptor
one. It is **not** claimed to mirror any ordering in Backstage; see "How these
bindings were checked".

### Option B: Validate, then exclude inadmissible descriptors from the entity set

Rejected. This is the version that would let a corpus containing invalid
descriptors produce a populated snapshot. It converts a fatal condition into a
silent drop, directly contradicting ADR-0012's `owned-paths-fail-closed-atomic`
assertion ("never a partial or silently-dropped set"). It is also the option
whose appeal comes from the *result it produces* rather than from the validator
evidence — which is precisely the reasoning this record must not adopt. If
descriptor exclusion is ever wanted, it needs its own record, its own
justification, and an explicit amendment to that assertion.

### Option C: Validate, warn, and canonicalize anyway

Rejected. Keeps the wrong classification while adding noise. A descriptor that
fails Backstage's own field-format validators is not a lesser entity; by those
validators' own standard it is not an entity.

### Option D: Exclude by path convention (e.g. scaffolder-template directories)

Rejected. Path shape is not the property that makes a descriptor invalid, and
the tracked record's own evidence shows placeholder descriptors are not confined
to a single directory convention. A path rule would be both unprincipled and
incomplete.

### Option E: Do nothing

Rejected. The contract would go on knowingly canonicalizing input that
Backstage's own field-format validators reject, and go on mis-reporting at least
one real, recorded condition. The gap is independent of whether feature009 ever
executes again.

## Trade-offs

**What this buys.** Classification precision at the identity boundary, and
alignment with the validator semantics ADR-0012 already pinned but never
applied. Failures name the defect that actually occurred.

**On the governance metadata, since the combination is unusual.** This record is
deliberately `scope: org` and `blastRadius: org` — equal in reach to ADR-0012,
ADR-0013 and ADR-0014 — while remaining `two-way-door`, where all three of those
are one-way-door. **The asymmetry is intended, not an oversight.**

The reach is org-wide because of what a *misjudged* admissibility rule does: it
removes descriptors from the governed entity set entirely, so no ADR assertion
ever fires against them. Entities do not appear mis-governed; they appear absent.
That is precisely the failure mode ADR-0012 exists to prevent, and its
consequence does not shrink just because this rule's mechanism is a single
field-format check. A record cannot coherently claim ARB review *on the grounds
that it amends an org-scope clause* while describing its own blast radius as
narrower than the clause it amends.

The reversibility is genuinely lower-risk, though, and that difference is worth
preserving rather than rounding to match the siblings. Admissibility can be
*widened* additively at any time — accepting a descriptor previously rejected
strictly enlarges the entity set and invalidates no prior output. What is not
freely reversible is the emitted `inadmissible-descriptor` trigger class, once
consumers branch on it. So: org-wide in what it can cost if wrong, two-way-door
in how hard it is to walk back.

**What is given up:**

- **A public failure surface grows.** `inadmissible-descriptor` becomes a
  contract-visible trigger class that consumers may branch on. Renaming or
  removing it later is a breaking change to the failure contract. This is the
  main reason the record is `two-way-door` rather than trivially reversible: the
  precondition itself is cheap to delete, but the emitted class is not.
- **A pinned-commit dependency becomes load-bearing.** Admissibility is defined
  by Backstage's validators at one frozen commit. If upstream relaxes or
  tightens a predicate, this contract silently diverges from live Backstage
  until the pin is deliberately moved. That divergence is already implicit in
  ADR-0012; this record makes it consequential.
- **Strictly more corpora become unusable, not fewer.** Because admissibility is
  fatal rather than filtering, descriptors that previously canonicalized without
  complaint — for example a name exceeding the 63-character limit that happened
  not to collide with anything — will now abort a run that previously completed.
  **This record makes the contract stricter. Anyone reading it as a route to
  making more real-world corpora usable has read it backwards.**
- **It buys nothing for annotation-derivation confidence.** Taken up below.

### On what real-corpus evidence can and cannot establish

A cross-check contributed during review holds that real corpora are 100%
`annotation-absent` — no public corpus carries `adrkit.io/owned-paths`, because
it is adrkit's own proposed annotation — and therefore that real-corpus evidence
can never validate annotation-derivation itself, only enumeration and
determinism.

**Agreed on the substance, with one qualification.** The *positive* derivation
paths — `explicit-paths` and `explicit-empty` — are unreachable from any public
corpus by construction, and no volume of real-corpus data will ever exercise
them; only synthetic fixtures can. Nothing in this record changes that, and this
record should not be read as improving it.

The qualification is that "only enumeration and determinism" understates the
case slightly. A 100%-absent result is itself load-bearing: it exercises the
`annotation-absent` branch of the three-state discriminator at scale, and it
independently substantiates ADR-0012's founding premise that no authoritative
entity-to-path binding exists in the wild. That is a real finding, not merely an
absence of one.

**Why this matters for scoping this record honestly.** Admissibility sits
*upstream* of annotation handling entirely — it decides whether a descriptor is
an entity at all, before any annotation is read. So its value lands squarely in
the enumeration, classification, and determinism layer, which is the layer real
corpora *can* speak to. That is a point in favour of deciding it on validator
grounds. But it also means adopting this record moves the annotation-derivation
evidence gap **not at all**. Any future claim that catalog binding is
empirically validated must still rest on synthetic fixtures for the derivation
paths, exactly as it did before.

### This rule does not clear the corpora, and does not unblock feature009

This is the most important limitation on this record, and it is stated here
rather than buried in Consequences because it is the strongest available
evidence about *why* this rule is being proposed.

Admissibility does not make the two pinned corpora usable. At least one
`duplicate-canonical-id` collision in `community-plugins`, pinned at
`92e9e4e09c76cc57f3475029b73e5ec84498a459`, is **irreducible under any
admissibility rule of the kind proposed here**. The file
`workspaces/nexus-repository-manager/plugins/nexus-repository-manager/catalog-info.yaml`
contains two YAML documents. Both are `kind: Component`; both declare
`metadata.name: backstage-community-nexus-repository-manager`; they differ only
in `title`, `spec.type` and `spec.owner`, with the second declaring itself as
its own `subcomponentOf`. That name is 44 characters of lowercase alphanumerics
and hyphens. It passes `isValidObjectName` cleanly, as does every other field on
both documents.

Both documents are therefore fully admissible. This is a genuine duplicate of a
valid entity — precisely the case `entity-identity.md` §3 exists to catch — and
the fail-closed abort is the correct outcome for it. No field-format rule can
reach it, and none should. It is also still present on the upstream default
branch, so re-pinning the corpus to a newer commit does not avoid it.

The consequence for feature009 is direct. `spec.md` SC-010 names all three
required real-corpus passes explicitly by corpus, so the `community-plugins`
pass cannot be substituted away. Adopting this record would reduce the *number*
of collisions in these corpora and would reclassify the placeholder descriptors
correctly; it would **not** produce a populated `SnapshotEnvelope` for
`community-plugins`, and it would **not** satisfy SC-010. The spike's `blocked`
verdict stands, on its own merits, with or without this record.

**Why this is stated so prominently.** A rule of this kind invites the suspicion
that it was reverse-engineered from a desired verdict. The check for that
suspicion is whether the rule survives the discovery that it does not deliver
the convenient outcome. It does. The warrant for this record is the validator
binding at `1121a4fa…` and nothing else: a descriptor whose `metadata.name`
Backstage's own validator rejects is not an entity whose identity we should be
canonicalizing. That argument is unchanged by the fact that the corpora remain
unusable afterwards, which is the test it needed to pass.

## Consequences

- `entity-identity.md` §1 gains an admissibility precondition; §1's own two
  steps and §3's collision table are unchanged.
- The atomic fail-closed clause ADR-0012 pins gains one trigger condition and
  loses none.
- Reports distinguish "this is not a valid Backstage entity" from "these valid
  entities collide."
- **The recorded feature009 verdict is unaffected by this record.** It remains
  `blocked` with `blockedShortfall = "envelope-or-scale-evidence-incomplete"`.
  Ratifying this record does not re-open, re-run, or re-decide that spike, and
  does not by itself make SC-010 satisfiable.
- **A residual, irreducible collision exists independent of admissibility.** As
  set out in Trade-offs, `community-plugins` at its pinned commit contains a
  genuine duplicate of a fully valid entity that no field-format rule can reach,
  and which is still present upstream. Adopting this record would not produce a
  populated envelope for that corpus. Anyone reading this record as a route to
  unblocking feature009 is reading it wrong.
- The carry-forward `reference-oracle.json` blocker recorded in
  `specs/009-catalog-binding-viability/checklists/evidence-index.md` is
  untouched and remains in full force: any future feature009 execution must
  still begin from a fresh T014 → T014a cycle before producing generator output.
- No production catalog adapter is authorized, created, or implied. No
  `packages/adapters/catalog-*` package exists or is sanctioned by this record.

## Action items

1. ~~**Confirm the validator bindings at the pinned commit before
   ratification.**~~ **Done.** All four rows are now verified by execution
   against the pinned sources, and the two defective rows were corrected. See
   "How these bindings were checked".
2. ~~**Obtain one independent review from a fresh context.**~~ **Done — four
   reviews, all FAIL, every finding accepted and corrected.** A `claude-opus-5`
   reviewer found three blocking defects in the validator table; a
   different-lineage `gpt-5.6-sol` reviewer found four more; a third
   `claude-opus-5` pass, bounded to that diff, found three blocking and three
   non-blocking; a fourth found the provenance account still wrong. All are
   corrected and enumerated above. **Every reviewer confirmed the substance
   sound** — bindings, predicates, executed regexes, counts, the Nexus
   duplicate, the governance metadata. What has failed each time is prose
   precision, and latterly prose *about the earlier failures*, not the warrant.

   **No reviewer has seen the current text.** The maintainer should decide the
   ratification standard explicitly rather than inherit it. Three
   considerations, offered without a recommendation:

   - **Correction rounds have themselves introduced defects** — two of the
     second review's four originated in the first round. So "review until clean"
     is not obviously convergent; each round has had some chance of adding what
     the next one finds.
   - **The recent failures are concentrated in the meta-narrative**, not the
     record's substance. Reviews three and four found nothing wrong with the
     decision, the options, the validator table or any figure; they found the
     account of the earlier failures wrong. A maintainer may reasonably weigh a
     defect in *this section* differently from a defect in the Decision.
   - **The largest identified defect class is enumerable and drained.**
     System-level claims about Backstage: eight instances existed at
     `4773d25`, all eight corrected, verifiable by a whitespace-normalised sweep
     rather than by another reviewer's judgement. The fourth review reproduced
     that count independently.

   This record does not presume which standard applies.
3. **Only after ratification**, prepare the corresponding `specs/009-**`
   contract amendment as a separately-scoped change. No `specs/009-**` edit is
   authorized by this draft.
4. **Decide separately** whether descriptor *exclusion* (Option B) is ever
   wanted. It is out of scope here and would require amending ADR-0012's
   fail-closed assertion.
