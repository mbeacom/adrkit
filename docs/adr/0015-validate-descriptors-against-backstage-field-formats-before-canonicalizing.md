---
schemaVersion: 0.1.0
id: "0015"
title: Validate descriptors against Backstage field formats before canonicalizing identity
status: proposed
date: 2026-07-25
deciders: ["@mbeacom"]
tags: [catalog, governance, matching, core]
scope: domain
reversibility: two-way-door
blastRadius: cross-team
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
    org-scope record takes the ARB tier even when the amending record is itself
    narrower.
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

At the same pinned commit, Backstage does not treat those fields as free-form.
`packages/catalog-model/src/validation/makeValidator.ts` binds four **distinct**
per-field validators, and `FieldFormatEntityPolicy` applies them to every
entity:

| Field | Validator binding | Predicate | Applied |
|---|---|---|---|
| `apiVersion` | `isValidApiVersion` | prefix/suffix split on `/`, DNS-subdomain prefix, ≤63 per part | required |
| `kind` | `isValidKind` | `/^[a-zA-Z][a-z0-9A-Z]*$/`, ≤63 | required |
| `metadata.name` | `isValidEntityName` → `KubernetesValidatorFunctions.isValidObjectName` | `/^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/`, ≤63 | required |
| `metadata.namespace` | `isValidNamespace` → `KubernetesValidatorFunctions.isValidDnsLabel` | `/^[a-z0-9]+(?:\-+[a-z0-9]+)*$/`, ≤63 | **only when present** |

The `metadata.name` row has been independently verified by the maintainer at the
pinned commit. The other three rows are read from the same pinned files and
**should be re-confirmed at ratification** rather than taken on this record's
word.

The consequence is a category error in the contract, and it is not hypothetical.
The tracked feature009 record documents fifteen descriptors — five in
`community-plugins`, ten in `rhdh-plugins` — whose `metadata.name` is the
literal, un-rendered scaffolder placeholder `${{ values.name | dump }}`. That
string fails `isValidObjectName` on character class: `$`, `{`, `}`, `|` and the
spaces are all outside the permitted set, while ordinary descriptor names pass
the same predicate unchanged. Backstage would reject those descriptors as
malformed entities outright. The contract instead accepts each one as a
well-formed name, lowercases it, concatenates it — and, because they are all the
same string, reports the result as
`triggerClass: "duplicate-canonical-id"`.

**The fail-closed rejection there is correct and required by §3.** What is wrong
is the *classification*: a descriptor that is not a valid Backstage entity at all
is being characterized as an identity collision *between valid entities*. Those
are different defects with different remedies, and the contract currently cannot
tell them apart, because it never asks the question Backstage itself asks first.

This record exists to close that gap. It is warranted by the validator bindings
above and by nothing else.

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

Matches Backstage's own ordering, preserves fail-closed exactly, and corrects the
classification. Strictly additive on the failure surface; removes no abort.

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

Rejected. Keeps the wrong classification while adding noise. A descriptor
Backstage would reject is not a lesser entity; it is not an entity.

### Option D: Exclude by path convention (e.g. scaffolder-template directories)

Rejected. Path shape is not the property that makes a descriptor invalid, and
the tracked record's own evidence shows placeholder descriptors are not confined
to a single directory convention. A path rule would be both unprincipled and
incomplete.

### Option E: Do nothing

Rejected. The contract would go on knowingly canonicalizing input that Backstage
itself rejects, and go on mis-reporting at least one real, recorded condition.
The gap is independent of whether feature009 ever executes again.

## Trade-offs

**What this buys.** Classification precision at the identity boundary, and
alignment with the validator semantics ADR-0012 already pinned but never
applied. Failures name the defect that actually occurred.

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
- The carry-forward `reference-oracle.json` blocker recorded in
  `specs/009-catalog-binding-viability/checklists/evidence-index.md` is
  untouched and remains in full force: any future feature009 execution must
  still begin from a fresh T014 → T014a cycle before producing generator output.
- No production catalog adapter is authorized, created, or implied. No
  `packages/adapters/catalog-*` package exists or is sanctioned by this record.

## Action items

1. **Confirm the validator bindings at the pinned commit before ratification.**
   The `metadata.name` binding is maintainer-verified; `apiVersion`, `kind`, and
   `namespace` are not, and this record should not be ratified on its own
   assertion of them.
2. **Obtain one independent review from a fresh context** that did not author
   this record, checking the four predicates against
   `makeValidator.ts`, `KubernetesValidatorFunctions.ts`,
   `CommonValidatorFunctions.ts`, and `FieldFormatEntityPolicy.ts` at
   `1121a4fa…`. Per this repository's standing model policy the reviewer must be
   `claude-opus-5`, or `gpt-5.6` for a second, different-lineage pass. No older
   revision is acceptable; model identity is recorded as evidence.
3. **Only after ratification**, prepare the corresponding `specs/009-**`
   contract amendment as a separately-scoped change. No `specs/009-**` edit is
   authorized by this draft.
4. **Decide separately** whether descriptor *exclusion* (Option B) is ever
   wanted. It is out of scope here and would require amending ADR-0012's
   fail-closed assertion.
