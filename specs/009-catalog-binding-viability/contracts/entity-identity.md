# Contract: Canonical Entity Identity, Global Uniqueness, and Collision Failure

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-005, FR-006,
FR-031, User Story 1 (Acceptance Scenarios 3, 4, 7, 8). Companion to
`data-model.md` §7 (`CanonicalEntityIdentity`), §6 (`AtomicFailureRecord`).
Normative source: ADR-0012 "Entity identity and aliases."

## 1. Canonicalization Algorithm (FR-005)

For a descriptor with `kind = K`, `metadata.name = N`, and
`metadata.namespace = NS` (or omitted):

1. If `metadata.namespace` is omitted, `NS := "default"` — Backstage's own
   `stringifyEntityRef` default-namespace substitution (`packages/catalog-
   model/src/entity/ref.ts` at the pinned commit, per `spec.md`'s FR-005
   citation).
2. `canonicalId := \`${K}:${NS}/${N}\`.toLowerCase()` — the **entire** string
   is lowercased, not merely a prefix, matching `stringifyEntityRef`'s own
   lowercasing behavior exactly.

**Two descriptors denoting the same real entity through different casing or
namespace-omission conventions MUST canonicalize identically.** Worked
example (User Story 1, Acceptance Scenario 3/4):

| Descriptor A | Descriptor B | Both canonicalize to |
|---|---|---|
| `kind: Component`, `namespace: Default`, `name: Payments` | `kind: component`, `namespace: default`, `name: payments` | `component:default/payments` |
| `kind: Component`, `namespace` omitted, `name: Billing` | `kind: component`, `namespace: default`, `name: billing` | `component:default/billing` |

Both pairs above are treated as **one duplicate-canonical-ID condition**
(§3), never as two distinct entities and never resolved by first-wins/
last-wins.

## 2. Alias Refs Are Synthetic-Fixture-Only (FR-006)

`fixtureAuthoredAliasRefs` (`data-model.md` §7) is supplied **directly by a
synthetic fixture's own construction** — additional entries in that entity's
derived `refs` array, mirroring the `refs?: readonly string[]` field already
defined on `CatalogSnapshotEntity` (`packages/core/src/affects/catalog.ts`).
This is a synthetic-fixture-only test of the uniqueness *rule*; Backstage
itself defines no standard field for declaring such an alias, so **no real-
corpus entity from `community-plugins` or `rhdh-plugins` ever has a non-empty
`fixtureAuthoredAliasRefs`**. A future production adapter's own mechanism (if
any) for sourcing aliases from real descriptors is an explicitly separate,
later, out-of-scope design decision this contract does not make.

## 3. Global Uniqueness and Collision Failure (FR-006, FR-031)

Within one snapshot-generation run, every string appearing in **any**
entity's `allRefs` (`canonicalId` plus every `fixtureAuthoredAliasRefs`
entry, §7) MUST be globally unique. The following are all collisions, all
triggering an `AtomicFailureRecord` (`contracts/atomic-fail-closed.md`) —
none may be silently merged, and none may be resolved by first-wins or
last-wins:

| Collision kind | Example (User Story 1, Acceptance Scenario 7) | `triggerClass` |
|---|---|---|
| Two entities' `canonicalId` values are identical | Two descriptors both canonicalizing to `component:default/payments` | `"duplicate-canonical-id"` |
| One entity's alias ref collides with a **different** entity's primary ID | Entity 1: id `component:default/billing`, alias `component:default/billing-legacy`. Entity 2: id `component:default/billing-legacy` (colliding with Entity 1's *alias*, not its ID). | `"duplicate-canonical-ref"` |
| A case-only variant of either collision above | A third entity with ref `Component:Default/Billing-Legacy` (case-only variant of the Entity-1/Entity-2 collision) | `"duplicate-canonical-ref"` |
| Duplicate YAML mapping key within one descriptor document | Two `metadata:` blocks in one document | `"duplicate-yaml-key"` (see `contracts/structural-fixtures-and-corpora.md` §2) |

**Every one of the three pairings above is a collision**, including the
case-only variant and including the alias-vs-ID case — never treated as
acceptable merely because the collision involves an alias rather than a
primary ID (User Story 1, Acceptance Scenario 7's own explicit requirement).

## 4. No Exclusive Winner — Overlap Is Not Collision (FR-031)

**Overlapping `owned-paths` values between two *distinct* canonical IDs are
never a collision.** Two entities with distinct canonical IDs (e.g.
`component:default/billing` and `component:default/invoicing`) whose
`adrkit.io/owned-paths` values both include the identical pattern (e.g. both
declare `packages/shared/**`) MUST both derive successfully — this MUST NOT
trigger `contracts/atomic-fail-closed.md`'s abort — and a changed file
matching that overlapping pattern MUST be recorded as owned by **every**
matching entity simultaneously, mirroring ADR-0009's own union-not-winner
`affects` semantics. This is the hardened contract's "no exclusive winner"
rule, and User Story 1 Acceptance Scenario 8 requires it be **positively
demonstrated** (both entities' derived `paths` retain the overlapping
pattern, and the changed file matches both), not merely asserted by the
absence of a rejection rule.

## 5. Production-Scope Boundary (Case Sensitivity Is Unaffected)

ADR-0012 explicitly does **not** change the core `entity` matcher's existing
`nocase: false` (case-sensitive) semantics (`packages/core/src/affects/
inert.ts`'s existing `compilePattern`). Canonicalization to lowercase happens
only at the annotation/generator boundary this spike measures; it never
changes `packages/core/src/affects/**`'s own existing matching behavior
(FR-020). A future production adapter must supply canonical lowercase full
refs to activate matching against a case-sensitive `entity` matcher pattern —
this spike does not (and, per FR-020, must not) alter that existing
contract.
