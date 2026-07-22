# Feature Specification: Catalog Entity-to-Path Binding Compatibility Viability Spike

**Feature Directory**: `009-catalog-binding-viability`

**Implementation Branch**: Not yet assigned. No implementation branch may be opened until
all remaining gates in the banner below clear.

**Created**: 2026-07-21

**Status**: Draft — **advance scoping only**. This document specifies a **non-shipping
compatibility spike** that compares how an entity in a Backstage-model software catalog
could be bound to the repo-relative paths it owns, for the sole purpose of deciding whether
`packages/adapters/catalog-backstage` is worth building later. It is **not** that adapter, it
does not touch `packages/adapters/**`, and writing/refining this spec is permitted now while
*executing* the spike (deriving fixtures, running the comparison, gathering evidence) is
explicitly **not** authorized yet — see the gating banner immediately below.
[**ADR-0012**](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
— "Bind catalog entities to owned paths with an explicit annotation," `status: accepted`,
merged to `main` at `54dbae8` (PR #26) — is now the **normative record** of the binding
contract this spec measures; it supersedes issue #25 as the citation of record for the
contract itself, though it preserves (and this spec still references) the two dated
2026-07-21 decisions issue #25 recorded as ADR-0012's own Context/Decision history. ADR-0012
explicitly authorizes exactly this advance-scoping activity (its own action item 1) and
explicitly does **not** authorize production code (its own "Scope and gates" section). A
second, separately merged record,
[**ADR-0013**](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
— "Reconcile adapter isolation and catalog binding with the offline snapshot generator,"
`status: accepted`, merged to `main` at `48087e8` (PR #27) — amends specific narrowed clauses
of ADR-0007 and ADR-0009 by reference and **deliberately holds both `proposed`**, with
documented blockers. This spec treats that disposition as the **final, authoritative status
resolution** for the purposes of this spike's authorization: issue #25 required the
adapter-isolation/catalog-binding records to be "accepted/amended or explicitly recorded as
blocking before implementation," and ADR-0013 discharges exactly that requirement by choosing
the amended-and-explicitly-blocked branch. ADR-0007 and ADR-0009 therefore remain
`proposed`/explicitly blocked exactly as ADR-0012's Governance section and ADR-0013 state, and
this spec's own execution/production gates MUST NOT be read as implying those blockers are
cleared. Their eventual acceptance is **not** an execution gate for this spike — ADR-0013's own
"Acceptance path for ADR-0007 and ADR-0009" lists this spike's evidence among the preconditions
for that acceptance, so requiring their acceptance before this spike's execution would be
circular and is forbidden.

**Kind**: Compatibility spike / advance scoping. This maps to ADR-0009's still-open action
item 4 ("Catalog port interface, with both adapters stubbed against public docs"), to
ADR-0012's action item 1 (record these constraints in this spec's scoping once its gates
permit — this document is that action item), and to the "catalog adapters" line item under
`plan.md`'s "Phase 6+ — Deferred" list. It is independent of Phase 6
(`specs/007-arb-queue/`) and of feature 008 (`specs/008-spec-kit-hook-viability/`); it
depends only on Phase 6 *landing*, not on either feature's own content.

**Normative sources** (the ADRs are normative; where this spec and an ADR disagree, the ADR
wins): [ADR-0012](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
(the accepted, controlling record of the `adrkit.io/owned-paths` binding contract, the
restricted glob dialect, atomic fail-closed semantics, the repository boundary, the versioned
envelope requirement, and this spike's own scope-and-gates language — cited throughout this
spec in place of issue #25 for the contract itself),
[ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
(the accepted record reconciling ADR-0007/ADR-0009's narrowed clauses with the offline
snapshot generator, while explicitly holding both `proposed` and defining their gated
acceptance path),
[ADR-0009](../../docs/adr/0009-affects-resolution-and-catalog-binding.md) (affects resolution
semantics, the `entity` matcher grammar, and the minimal `CatalogPort`/`CatalogSnapshot`
contract this spike measures a candidate producer for — still `status: proposed`; its own
body now carries a direct amendment blockquote, added by ADR-0013's merge: "**Amended by
ADR-0013; refined by ADR-0012.** The per-adapter mapping is pinned by ADR-0012's explicit
`adrkit.io/owned-paths` contract. The in-memory snapshot is an internal type, not a wire
format: any persisted snapshot requires a versioned interchange envelope before production,
and composition is a standalone offline generator rather than a dynamic runtime loader."),
[ADR-0007](../../docs/adr/0007-adapter-isolation-and-public-surface-build.md) (adapter
isolation; clean-clone, credential-free, network-free build and runtime constraint — still
`status: proposed`; its own body likewise now carries a direct amendment blockquote: "**Amended
by ADR-0013.** For the catalog surface specifically, composition uses no dynamic runtime
adapter/plugin loader: a catalog adapter is a standalone offline snapshot generator emitting a
validated interchange file. This narrows, and does not repeal, the general 'discovery is by
configuration' rule." — quoting ADR-0007's own added blockquote verbatim; ADR-0007 itself uses
double quotes around "discovery is by configuration," rendered here with single quotes only to
distinguish this spec's own outer quotation marks from the nested phrase, per standard
nested-quotation convention, not as a substantive alteration of the quoted text), and
[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) Principles I–IV
(git is truth; clean clone builds green with no post-install network/credentials/services;
core and CLI depend on no adapter; deterministic before probabilistic). The historical
decision record this spike's scoping and ADR-0012 both derive from is
[adrkit issue #25](https://github.com/mbeacom/adrkit/issues/25), "Decide catalog
entity-to-path binding before feature 009" — read in full for provenance; ADR-0012 is the
citation of record for the contract's actual terms.

> ⛔ **Two open execution gates remain; the governance preconditions are satisfied —
> implementation of this spike itself is not authorized.**
>
> **Satisfied preconditions (not gates).** Three governance preconditions this spike once tracked
> as open are now closed and are recorded here as satisfied, never as pending:
>
> - **Maintainer scoping & contract ratification.** The maintainer ratified this spike's
>   scoping and the hardened `adrkit.io/owned-paths` contract on adrkit issue #25 on 2026-07-21
>   (both dated decisions; see the Ratification Record). **Satisfied.**
> - **Catalog-binding convention governance.**
>   [ADR-0012](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
>   reached `status: accepted` on 2026-07-21 (PR #26, merged at `54dbae8`), fully ratifying the
>   `adrkit.io/owned-paths` convention exactly as hardened and making it the normative record of
>   the binding contract. **Satisfied.**
> - **Adapter-isolation/catalog-binding reconciliation.**
>   [ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
>   reached `status: accepted` (PR #27, merged at `48087e8`). Issue #25 required the
>   adapter-isolation/catalog-binding records to be "accepted/amended or explicitly recorded as
>   blocking before implementation"; ADR-0013 discharges that requirement by amending ADR-0007's
>   and ADR-0009's narrowed clauses and **deliberately holding both `proposed` with documented
>   blockers**. This is the **final status resolution** for the purpose of authorizing this
>   spike. ADR-0007 and ADR-0009 remaining `proposed` is therefore **not** an open gate: ADR-0013
>   itself lists this spike's own evidence among the preconditions for their eventual acceptance,
>   so gating this spike on their acceptance would be circular and is forbidden. This spec's
>   output MUST NOT imply ADR-0007/ADR-0009's own blockers are cleared, and MUST NOT require
>   their acceptance or supersession before spike execution. **Satisfied as the authoritative
>   disposition.**
>
> **Open execution gates.** Exactly two gates remain unsatisfied; both must clear before any
> spike execution (or any later production catalog adapter work) may begin:
>
> 1. **Phase 6 gate.** `specs/007-arb-queue/spec.md` SC-004 (the rung 6 external-team,
>    separate-repository dogfood exit gate), tracked as `specs/007-arb-queue/tasks.md`
>    **T048** with dependent **T049**, is outstanding as of this writing (both unchecked).
>    `T049` is the documentation update that flips Phase 6's `plan.md` row to `landed` once
>    T048 clears — meaning that **by the time this gate is satisfied, Phase 6 will in fact
>    be `landed`**. This spec's later disclaimers (FR-030, SC-013) are written to survive
>    that transition without becoming false: they require this spike to never claim *credit*
>    for, or treat its own verdict as *constituting*, that landing — not to assert that Phase
>    6 is permanently unlanded. Neither this spike nor any later production catalog adapter
>    work may begin until this gate clears.
> 2. **Independent-adopter gate.** An adopter other than the maintainer must author real
>    `adrkit.io/owned-paths` annotations against their own real catalog and provide a
>    hand-labeled entity/path oracle this spike cannot itself construct. Sampling public
>    Backstage-ecosystem corpora for this spec's own research grounding (see the Ratification
>    Record and User Story 3) is a read-only research input, not that adopter, and does not
>    satisfy this gate (Assumption A5). Per the Ratification Record's Evidence Gate, this gate
>    is also a precondition for any *future* "authoritative go" — a status distinct from, and
>    strictly stronger than, this spike's own `go-explicit` verdict (Success Criteria SC-012).
>
> This spec may be read, reviewed, and refined at any time. **The governance preconditions above
> — maintainer ratification, ADR-0012's catalog-binding governance, and ADR-0013's authoritative
> status disposition of ADR-0007/ADR-0009 — are all satisfied.** Gate 1 (Phase 6) and gate 2
> (independent adopter) both remain open. This spec therefore still authorizes no fixture
> derivation, no corpus re-fetch beyond what is already cited by exact path and commit SHA below,
> no comparison run, and no
> evidence-gathering step described in User Scenarios & Testing until every remaining gate
> clears.

### Ratification Record

> **Maintainer decision — adrkit issue #25, 2026-07-21T21:30:41Z.** The maintainer ratified
> **Option A** (an explicit annotation) as the only candidate for authoritative, default
> catalog entity-to-path binding, with this initial contract:
>
> - annotation key: `adrkit.io/owned-paths`
> - value: a JSON array of repo-relative POSIX picomatch globs
> - reject leading `/`, absolute paths, backslashes, empty patterns, and `..` traversal
> - canonical entity identity: full lowercase `kind:namespace/name`
> - sort and deduplicate output paths deterministically
> - duplicate canonical IDs and invalid annotations fail closed
> - absent annotation means **no inferred path ownership**
> - descriptor-parent (Option B) and repository-root (Option C) mappings are excluded from
>   default/authoritative behavior; a non-shipping spike may measure them only to document
>   false-positive/precision trade-offs, never as ground truth
> - identity-only output (Option D) may be measured but is not sufficient to unlock adrkit's
>   current changed-file entity matching
> - any persisted `CatalogSnapshot` requires a versioned interchange contract before
>   production
> - no general runtime plugin loader is authorized; an offline snapshot-generator boundary is
>   the preferred composition model
>
> **Contract hardening decision — adrkit issue #25, 2026-07-21T21:40:53Z, "[f]ollowing
> adversarial review."** Ten minutes later, the maintainer materially hardened the above with
> the safest reversible defaults, which this spec treats as the controlling, current version
> of the contract wherever the two decisions differ:
>
> - **Repository boundary.** Snapshots are single-repository only. Every snapshot is bound to
>   one canonical repository identity and immutable revision supplied by an **explicit input
>   manifest** — never inferred from any Backstage annotation (including
>   `github.com/project-slug`, which the initial spike research below independently found to
>   be unreliable for exactly this purpose). For the pinned GitHub corpus spike, canonical
>   repository IDs use lowercase `github.com/<owner>/<repo>` and revisions use full commit
>   SHAs. Repository mismatch aborts generation/consumption. Multi-repository/federated
>   snapshots are a separate, future contract.
> - **Atomic fail-closed semantics.** Any duplicate canonical ID/ref, duplicate YAML key,
>   malformed JSON, invalid annotation, invalid glob, unsupported snapshot version/capability,
>   repository mismatch, or incomplete required source aborts the **entire** snapshot
>   operation with non-zero status and **no usable partial snapshot** — this supersedes the
>   initial decision's looser "duplicate canonical IDs and invalid annotations fail closed"
>   wording insofar as that wording could be read as per-entity, not whole-operation, failure.
> - **Entity identity and aliases.** IDs and refs are full lowercase `kind:namespace/name`;
>   every ID/ref is globally unique within the snapshot; multiple raw descriptors collapsing
>   to one lowercase ID fail closed (whole-operation, per the atomicity rule above). ADR
>   entity-matcher patterns remain case-sensitive — production scope must require canonical
>   lowercase full refs at the annotation/generator boundary rather than silently changing
>   `packages/core/src/affects/**`'s existing case-sensitive matching semantics.
> - **Glob dialect.** Positive-only union (reject a leading `!` and negative extglobs); no
>   exclusive winner — semantic overlap between entities is permitted and every matching
>   entity is returned, mirroring ADR-0009's own union-not-winner `affects` semantics. Freeze
>   the engine for spike evidence as **picomatch `4.0.5`**, options `dot:false`,
>   `nocase:false`, `nonegate:true`. Restrict authored patterns to POSIX segments containing
>   only literals (`A-Z`, `a-z`, digits, `_`, `-`, `.`) plus `*`, a whole-segment `**`, and
>   `?`; reject braces, brackets, parentheses/extglobs, commas, escapes/backslashes, `!`,
>   empty segments, leading `/`, absolute/drive/UNC paths, NUL/control characters, and
>   `.`/`..` segments — evaluated **after** JSON decoding. Dotfiles match only when the
>   pattern names a leading-dot segment explicitly; a bare `**` does not imply dotfile
>   ownership (see User Story 5, Acceptance Scenario 4, which found this already matches
>   `picomatch`'s own `dot:false` behavior with no code change needed). Any future
>   dialect/engine/options change is a versioned reclassification requiring snapshot
>   regeneration/migration evidence.
> - **Empty and absent ownership.** `[]` is valid and means **explicit no owned paths**.
>   Missing `adrkit.io/owned-paths` means **no inferred ownership**. Both produce no path
>   matches, but evidence/snapshot metadata must preserve `explicit-empty` versus
>   `annotation-absent` for diagnostics.
> - **Input completeness and snapshot envelope.** Generation reads only an explicit,
>   immutable **local input manifest** (repository ID/revision plus descriptor paths and
>   digests). It does **not** follow remote `Location` targets, call processors/plugins, or
>   claim whole-catalog completeness. The spike must **define and produce** a versioned
>   envelope carrying at least: schema version, repository ID/revision, generator version,
>   glob dialect/version/options, capability/completeness flags, source paths/digests, and
>   deterministic entities. Production consumers reject partial/identity-only artifacts for
>   path matching.
> - **Decode/security/scale evidence.** Validate only after JSON decoding; require exactly
>   `array<string>`. Reject YAML duplicate keys and decoded traversal/absolute/control forms.
>   The spike measures annotation bytes, entity count, patterns/entity, pattern length,
>   documents/aliases, and compile/match cost on both pinned corpora. Exact production limits
>   are **not** guessed now — they must be ratified from evidence before production. Compile
>   each accepted glob exactly once.
> - **Evidence gate.** A future **authoritative `go`** — a status distinct from and strictly
>   stronger than this spike's own `go-explicit` verdict — requires adopter-authored
>   annotations plus a hand-labeled entity/path oracle, zero false positives/negatives for
>   authoritative cases, repository-isolation tests, malformed/tampered/stale snapshot
>   rejection, and deterministic byte output. Phase 6 T048/T049 and an independent adopter
>   remain mandatory for that authoritative status regardless of this spike's own result.
> - **ADR reconciliation.** ADR-0007/0009 must be accepted/amended or explicitly recorded as
>   blocking before implementation. Catalog composition is a standalone offline snapshot
>   generator feeding a validated interchange file; no dynamic runtime adapter/plugin loader
>   is authorized.
>
> **Both decisions together** authorized advance scoping of `specs/009-catalog-binding-
> viability/` (this document) as a **non-shipping compatibility spike**, plus the reviewed
> ADR/status-ratification PR that both decisions anticipated. **Neither decision, by itself,
> ever authorized production code.**

**Update — 2026-07-21, ADR-0012 and ADR-0013 merged.** The "future reviewed ADR/status-
ratification PR" both decisions above anticipated has now happened, in two separate,
already-merged PRs:
[**ADR-0012**](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
(PR #26, merged at `54dbae8`) formally ratifies both decisions above as `status: accepted`
project law — it is now the citation of record for the contract itself, and this spec cites
it accordingly throughout (rather than quoting the issue #25 comments directly, which remain
useful only as historical provenance ADR-0012 itself preserves).
[**ADR-0013**](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
(PR #27, merged at `48087e8`) is the "ADR reconciliation" action these decisions called for: it
amends ADR-0007's and ADR-0009's narrowed clauses by reference while **deliberately holding
both `status: proposed`**, "explicitly blocked" per ADR-0012's own Governance section, with
documented blockers. **This still does not authorize production code.** These two accepted
records, together with the maintainer's issue #25 ratification, close every governance
precondition this spike tracks: catalog-binding convention governance (ADR-0012), the
adapter-isolation/catalog-binding reconciliation (ADR-0013 — the authoritative, final status
resolution of ADR-0007/ADR-0009 for spike-authorization purposes, per issue #25's
"accepted/amended or explicitly blocked" clause), and maintainer scoping/contract ratification
(issue #25). Only **two execution gates** remain open, both in the banner above: (1) Phase 6
T048/T049 landing, and (2) independent-adopter validation. ADR-0007/ADR-0009 remaining
`proposed` is a satisfied precondition disposition, **not** an execution gate, and this spec's
requirements below are written to cite ADR-0012 (and, for the ADR-0007/ADR-0009 disposition,
ADR-0013) as the normative source, per the coordinator's 2026-07-21 instruction to prefer the
merged ADR over the originating issue thread for the contract's terms.

**Editorial note (not part of either quoted decision).** The hardening decision above names
two ownership-state labels, `explicit-empty` and `annotation-absent`, for the two cases where
an entity's derived paths are empty. This spec adds a third label, `explicit-paths`, for the
ordinary case of a valid non-empty annotation, so that every entity's ownership state has a
defined discriminator value in the required envelope, not only the two states the maintainer's
decision named explicitly (see FR-008, FR-022). This addition is this spec's own requirement,
not maintainer-ratified text, and is called out here so it is never mistaken for a third label
the quoted decision itself specified.

## Overview

ADR-0009 pins `affects` resolution *semantics* — path/package/entity/resource/api/data
grammars, per-ADR-match-then-union, and pure `(matchers, fileList, catalogSnapshot)`
resolution — and defines a minimal `CatalogPort` (`resolveEntity`, `entitiesForPaths`,
`snapshot(): CatalogSnapshot`) that any catalog integration implements as an adapter. What it
does **not** define is how a `CatalogSnapshotEntity`'s `paths` field
(`packages/core/src/affects/catalog.ts`) — the one field that actually activates the `entity`
matcher against a changed-file list, via `entitiesForPaths` in
`packages/core/src/affects/inert.ts` — gets populated for a real Backstage-model catalog. An
entity with no `paths` is functionally invisible to path-based entity matching regardless of
how correctly its identity resolves.

Issue #25 established, against Backstage's own upstream source
(commit `1121a4facd9e321179d0402c3f355e4a649e84d9`), that no standard Backstage field asserts
descendant-path ownership: entity references canonicalize to lowercase
`kind:namespace/name` via `stringifyEntityRef`
(`packages/catalog-model/src/entity/ref.ts`), but `backstage.io/source-location`
describes a source location, not ownership of everything beneath it
(`packages/catalog-model/src/location/annotation.ts`); `backstage.io/managed-by-location`
and `backstage.io/managed-by-origin-location` describe ingestion provenance, not ownership;
`github.com/project-slug` names a related repository, not a subpath, an authorization
assertion, or (per the hardening decision) even a reliable *repository identity* source; and
`ownedBy` names a responsible entity/contact, not a path grant. Sampling two pinned, real
public corpora built on this same model —
`backstage/community-plugins@92e9e4e09c76cc57f3475029b73e5ec84498a459` and
`redhat-developer/rhdh-plugins@3b355ddfedb23c6656bd9effc8510f9926b765c1` — turned up concrete,
citable evidence of exactly the failure modes issue #25 predicted (see User Story 3):
descriptor-parent granularity that is inconsistent even within one workspace, and a
`github.com/project-slug` annotation that disagrees with itself three different ways across
one physical repository, two of those three ways wrong — evidence the maintainer's hardening
decision cites as part of the reason repository identity must come from an explicit manifest
rather than any inferred annotation.

Following an adversarial review of the initial ratification, the maintainer hardened the
contract ten minutes later (see the Ratification Record above) into a materially stricter
shape: single-repository-only snapshots bound to an explicit input manifest, whole-operation
atomic failure on any invalid input (not per-entity), a restricted positive-only glob dialect
frozen to `picomatch 4.0.5` with exact options, a required (not merely advisory) versioned
snapshot envelope, explicit decode/security/scale evidence obligations, and an "Evidence
Gate" that reserves the term **authoritative `go`** for a later status requiring an
independent adopter's own hand-labeled oracle — something this spike, run only against public
corpora and its own synthetic fixtures, cannot itself produce. This spec is written against
that hardened contract throughout; where a requirement below would only have been true under
the initial, softer decision, it has been corrected.

Both decisions are now formally ratified as project law:
[ADR-0012](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
reached `status: accepted` on 2026-07-21 (PR #26, merged at `54dbae8`), and is the citation of
record this spec uses for the contract's terms throughout — the issue #25 quotes in the
Ratification Record remain in place only as the provenance ADR-0012 itself records.
[ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
(also `status: accepted`, PR #27) separately reconciles ADR-0007's and ADR-0009's narrowed
clauses by reference while explicitly and deliberately holding both `proposed` — this spec
follows that disposition exactly and does not imply ADR-0007/ADR-0009's own blockers are
cleared by ADR-0012's or ADR-0013's acceptance.

This spike is the pre-scoping evidence run for whether the hardened `adrkit.io/owned-paths`
convention (Option A) is mechanically sound — parses, validates, canonicalizes, and fails
closed exactly as specified — measured against three comparison points that this spike must
never present as ground truth or default behavior: descriptor-parent (B), repository-root
(C), and identity-only normalization with no path binding at all (D). It produces exactly one
artifact of consequence — an evidence-backed verdict (`go-explicit`, `blocked`, or `no-go`)
— that a later, separately-scoped feature can use to decide whether (and how small) a
production `packages/adapters/catalog-backstage` offline snapshot-generator should be. It
does not produce that adapter, does not change `packages/core/src/affects/**`, and does not
decide where or how any future production package would be published.

**No circular ADR gate.** ADR-0013's "Acceptance path for ADR-0007 and ADR-0009" lists
"non-shipping spike evidence from `specs/009-catalog-binding-viability/`" among the
preconditions for those records eventually reaching `accepted`. This spec therefore does
**not** gate its own spike execution on ADR-0007/ADR-0009 first reaching `accepted` — doing so
would be circular (their acceptance depends on this spike's evidence, which in turn would
depend on their acceptance) and is forbidden. ADR-0013's disposition — amend the narrowed
clauses, hold both `proposed` with documented blockers — is the **final, authoritative status
resolution** of the adapter-isolation/catalog-binding records for the purpose of authorizing
this spike, and fully satisfies issue #25's "accepted/amended or explicitly recorded as
blocking before implementation" clause. This spec neither proposes amending ADR-0013 nor treats
ADR-0007/ADR-0009's eventual acceptance as one of its own execution gates; it simply records
their `proposed` status as a satisfied precondition disposition and never implies their own
blockers are cleared for production.

## User Scenarios & Testing

> **Execution gating reminder.** Every scenario below describes what the (currently
> unauthorized) spike execution must demonstrate once both open gates in the banner above
> clear. None of it may be run today. The primary-source citations embedded in this spec
> (exact file paths, exact annotation values, exact commit SHAs, exact descriptor counts)
> were gathered — and, in several cases, independently cross-checked by a second, adversarial
> reviewer — to ground this document's scoping and requirements. This is not a substitute for
> the spike itself re-verifying them at execution time (Assumption A2).

### User Story 1 — Prove Option A's annotation contract parses, validates, and canonicalizes exactly as hardened (Priority: P1) 🎯 MVP

As the maintainer running this spike, I want to feed the hardened `adrkit.io/owned-paths`
contract a set of synthetic fixtures covering every per-pattern validation rule the maintainer
ratified — valid restricted-dialect globs, leading-slash rejection, absolute-path rejection,
backslash rejection, empty-pattern rejection, `.`/`..`-traversal rejection (evaluated after JSON
decoding), the newly-restricted dialect's rejection of braces/brackets/parentheses/commas/
escapes/`!`/NUL-control characters, case-only duplicate canonical IDs, a missing-namespace
descriptor canonicalizing to Backstage's own `default` namespace, an explicit empty array, and
a wholly absent annotation — and confirm each produces the exact, deterministic outcome the
hardened contract specifies, so that Option A's mechanical soundness is judged against its own
current, hardened contract rather than the softer initial one or a looser interpretation of
either.

**Why this priority**: Nothing else in this spike matters if the one candidate for
authoritative behavior cannot be shown to parse, validate, and canonicalize exactly as
hardened. This story alone can produce a `no-go` if any validation rule proves unenforceable.
Whole-operation atomic failure (rather than per-entity rejection) is measured separately in
User Story 2, since it is a distinct, repository-scoped property.

**Independent Test**: Run the same fixture set (at minimum one fixture per validation rule
named above) through the Option A parser three or more times and confirm byte-identical
sorted, deduplicated output every time for the valid fixtures; confirm the case-only duplicate
(`Component:Default/Payments` vs `component:default/payments`, both canonicalizing to
`component:default/payments` per `stringifyEntityRef`'s lowercasing) is treated as a
duplicate-ID failure, not silently merged; confirm a descriptor with no `metadata.namespace`
canonicalizes using Backstage's `default` namespace constant before lowercasing; confirm an
explicit `"[]"` value and a wholly absent annotation are recorded as two distinct states —
`explicit-empty` and `annotation-absent` — never conflated.

**Acceptance Scenarios**:

1. **Given** a descriptor with `adrkit.io/owned-paths: '["packages/payments/**","apis/payments/**"]'`, **When** the spike derives that entity's paths, **Then** the result is exactly `["apis/payments/**", "packages/payments/**"]` (lexicographically sorted, deduplicated) every time the same input is parsed.
2. **Given** individual fixtures whose `adrkit.io/owned-paths` values each violate exactly one restricted-dialect rule — a leading `/`, an absolute path, a backslash, an empty string element, a bare `.` segment, a `..` segment (both evaluated post-decode), a brace expression, a bracket character class, a parenthesized extglob, a comma, a backslash escape, a leading `!`, and a NUL/control character — **When** the spike validates each in isolation, **Then** each is individually classified as invalid with a rule-specific reason (whole-operation atomicity for a mixed batch is covered by User Story 2, not this scenario).
3. **Given** two descriptors whose entity refs are `Component:Default/Payments` and `component:default/payments` respectively, **When** the spike canonicalizes both, **Then** both resolve to the identical canonical ID `component:default/payments` and the pair is recorded as a duplicate-canonical-ID condition — not as two entities, and not as an arbitrary first/last-wins merge.
4. **Given** a descriptor whose `metadata` omits `namespace` entirely, **When** the spike canonicalizes its ref, **Then** the canonical ID uses Backstage's `default` namespace constant (matching `stringifyEntityRef`'s own default-namespace substitution) before lowercasing — not an empty or omitted namespace segment.
5. **Given** a descriptor with a valid, non-empty `adrkit.io/owned-paths` array, one descriptor with `adrkit.io/owned-paths: '[]'`, and a third descriptor with the annotation entirely absent, **When** the spike derives paths for all three, **Then** the evidence bundle labels them, respectively, `explicit-paths`, `explicit-empty`, and `annotation-absent`, and no two of the three are treated as equivalent to one another.
6. **Given** the real `backstage/community-plugins` corpus at the pinned commit, where a full scan found 23 of 156 sampled descriptors carrying any `metadata.annotations` block at all and zero of 156 carrying `adrkit.io/owned-paths`, **When** the spike derives paths for those 156 entities, **Then** every one is recorded `annotation-absent` — never inferred from its descriptor's location — and the 23/156 and 0/156 figures are recorded verbatim in the evidence bundle.
7. **Given** three synthetic fixtures — one declaring an entity's canonical ID as `component:default/billing` with an additional, fixture-authored alias ref `component:default/billing-legacy` (per FR-006, supplied directly in the fixture's `refs` array, not derived from any Backstage annotation), a second declaring a distinct entity whose own canonical ID is `component:default/billing-legacy` (colliding with the first entity's *alias*, not its ID), and a third whose ref is `Component:Default/Billing-Legacy` (a case-only variant of that same collision) — **When** the spike canonicalizes all three, **Then** every one of the three pairings (alias-vs-ID, and the case-only variant of it) is recorded as a duplicate-canonical-ref condition under the whole-operation atomicity rule (FR-006/FR-007) — never silently merged and never treated as acceptable because the collision involves an alias rather than a primary ID.
8. **Given** two descriptors with **distinct** canonical IDs (e.g. `component:default/billing` and `component:default/invoicing`) whose `adrkit.io/owned-paths` values both include an overlapping pattern (e.g. both declare `packages/shared/**`), **When** the spike derives paths for both, **Then** the run succeeds (this is not a duplicate-ID or duplicate-ref condition, and does not abort per FR-007), both entities' derived `paths` retain the overlapping pattern, and a changed file matching that overlapping pattern is recorded as owned by both entities simultaneously — proving the hardened contract's "no exclusive winner" rule (semantic overlap between distinct entities is permitted, and every matching entity is returned) rather than merely asserting it.

---

### User Story 2 — Prove the repository-boundary manifest and whole-operation atomic fail-closed semantics (Priority: P1)

As the maintainer, I want to bind a synthetic snapshot generation run to one explicit input
manifest naming a canonical repository ID (`github.com/<owner>/<repo>`, lowercase) and an
immutable revision (a full commit SHA), confirm a repository mismatch aborts generation, and
confirm that introducing exactly one invalid entity (any rule from User Story 1) into an
otherwise-valid batch aborts the **entire** snapshot operation with a non-zero result and no
usable partial output — never a snapshot that silently omits or skips the bad entity — so
that the hardened contract's atomicity and repository-boundary guarantees are proven as
whole-operation properties, distinct from the per-rule validation proven in User Story 1.

**Why this priority**: This is the single most consequential correction the hardening
decision made to the initial ratification, and the property most likely to be gotten wrong by
an implementer who assumes "fail closed" means "skip the bad one and keep going" — proving it
explicitly, with a fixture designed to distinguish the two behaviors, forecloses that mistake
before any production code exists.

**Independent Test**: Because a `git worktree add` linked worktree shares its remote
configuration with the repository it was created from (`git worktree` shares the object
database and remote config across worktrees; only a few properties, such as `HEAD` and the
index, are per-worktree), a linked worktree of this actual repository cannot be independently
varied to test a repository *mismatch* — its `origin` would always report
`github.com/mbeacom/adrkit`. This specific test therefore uses a **standalone scratch git
repository** — a fresh, disposable directory the spike `git init`s once, with its own
`git remote add origin <chosen-url>` and its own commits, entirely separate from this
repository's own `.git` — as the fixed environmental fact the generator checks the manifest
against. (This is distinct from, and in addition to, the general disposable scratch
worktree/branch Assumption A7 uses to keep the rest of spike execution out of the committed
`specs/` tree.) Read that standalone repository's actual `git remote get-url origin`
(normalized to lowercase `github.com/<owner>/<repo>`) and `git rev-parse HEAD` via separate
git tooling, not by re-reading the manifest file under test. This is a bounded, offline
approximation, not a live-network verification (FR-018 forbids the latter): a stronger check
that confirms the remote is a real, reachable GitHub repository is out of scope for this
offline spike. Construct one input manifest declaring a repository ID/revision that matches
that standalone repository's actual `origin`/`HEAD`, and confirm generation succeeds against
five valid entities; run generation a second time against the same five valid entities plus
one invalid one (e.g. a duplicate canonical ID, or a glob using a rejected brace expression),
still with a matching manifest; confirm the second run exits non-zero, produces no snapshot
file usable for downstream matching (not even the five valid entities), and names the specific
entity/rule that triggered the abort. Separately, run generation a third time using a manifest
whose declared repository ID/revision does **not** match that standalone repository's actual
`origin`/`HEAD` and confirm it aborts before deriving any paths at all — the mismatch check
compares the manifest under test against the checkout's separately-read git identity, never
against any property inferred from the descriptors themselves.

**Acceptance Scenarios**:

1. **Given** an input manifest whose declared `github.com/<owner>/<repo>` repository ID and
   full-SHA revision match the standalone scratch repository's actual `git remote get-url
   origin` and `git rev-parse HEAD`, **When** the spike runs generation against five valid
   entities, **Then** it produces one complete snapshot naming that exact repository ID and
   revision.
2. **Given** the same five valid entities plus a sixth entity with a duplicate canonical ID
   (per User Story 1, Acceptance Scenario 3), **When** the spike runs generation once over all
   six, **Then** the run exits non-zero, and the evidence bundle explicitly records that **no**
   snapshot — not even one covering the five otherwise-valid entities — was produced or is
   usable, distinguishing this from a hypothetical (and explicitly rejected) partial-success
   outcome.
3. **Given** an input manifest whose declared repository ID/revision does not match the
   standalone scratch repository's actual `origin`/`HEAD`, **When** the spike runs generation,
   **Then** it aborts on repository mismatch before deriving any entity's paths, non-zero,
   with a reason naming the mismatch — the comparison is manifest-vs-separately-read-checkout-
   identity, read via distinct git tooling from the manifest parser, never manifest-vs-
   anything-inferred-from-the-descriptors, and never possible to satisfy by simply running
   inside a linked worktree of this actual repository (whose `origin` cannot be independently
   varied).
4. **Given**, in turn: a manifest declaring `manifestSchemaVersion: "2"` (any value other than
   the sole supported `"1"`); a manifest declaring `requestedSnapshotSchemaVersion: "2"` (any
   value other than the sole supported `"1"`, which matches FR-022's envelope
   `schemaVersion`); a manifest declaring `requiredCapabilities: ["pathOwnership", "sync"]`
   (containing a string other than the sole defined `"pathOwnership"`); and, separately, a
   manifest that lists a descriptor path/digest absent from the actual fixture set on disk (an
   "incomplete required source" — a digest mismatch), **When** the spike runs generation for
   each of these four cases, **Then** each aborts non-zero with no usable partial snapshot
   before deriving any entity's paths, exercising the four FR-007 failure classes that
   Acceptance Scenario 2 above does not cover — all four are properties of the generation
   request/manifest itself, never of an individual entity within a batch.
5. **Given** the real `redhat-developer/rhdh-plugins` corpus's three non-identical
   `github.com/project-slug` values (User Story 3, Acceptance Scenario 4), **When** the spike
   notes this in the context of repository-boundary design, **Then** it records that this is
   additional evidence for why repository identity comes from an explicit manifest — checked
   against the actual checkout, never against an inferred annotation — rather than merely
   evidence against path-ownership inference, which was the original, narrower framing before
   the hardening decision.

---

### User Story 3 — Measure descriptor-parent (B) and repository-root (C) as labeled heuristics only, never as ground truth (Priority: P1)

As the maintainer, I want to run the descriptor-parent and repository-root heuristics over
both pinned real corpora — reporting cardinality, collision, and granularity findings, since
neither real corpus contains an authoritative oracle to compute true precision against — and
separately compute a genuine precision/false-positive comparison against Option A using
synthetic fixtures where the spike itself authors the ground truth, so that the trade-off
issue #25 predicted is demonstrated with real numbers where real numbers are available, and
with an honestly-labeled synthetic proxy where they are not.

**Why this priority**: This is the evidence that justifies excluding B and C from default
behavior rather than merely asserting it by maintainer preference; it is also the story most
likely to surface a reason B or C deserves to exist as an explicit, separately-invoked mode
later (which this spike may note, but must not authorize).

**Independent Test**: Run the descriptor-parent heuristic (candidate paths = the descriptor
file's parent directory glob) and the repository-root heuristic (candidate paths = the entire
repository, `**`) against every sampled descriptor in both pinned corpora; confirm every
output row carries a `heuristic: non-authoritative` label. Separately, build a synthetic
fixture set of at least ten entities, each with a spike-authored `adrkit.io/owned-paths`
value, and a finite, spike-authored **labeled entity × changed-file matrix** constructed to
guarantee both a labeled-true and a labeled-false example for every entity (so
`TP + FP + TN + FN` covers every combination the matrix needs): for every (entity,
changed-file) pair in that matrix, a boolean "this entity truly owns this file" label,
assigned by construction, not derived from any heuristic. Apply B and C to the same fixture
set to obtain, for each (entity, changed-file) pair in the matrix, a predicted boolean ("this
heuristic says this entity owns this file"); classify each pair as a true positive (TP:
predicted true, labeled true), false positive (FP: predicted true, labeled false), true
negative (TN: predicted false, labeled false), or false negative (FN: predicted false, labeled
true); and compute `precision = TP / (TP + FP)` and `false-positive rate = FP / (FP + TN)` for
each heuristic over that finite matrix. If either denominator is zero for a given heuristic
(e.g. a heuristic that never predicts a positive has an undefined `TP + FP`), the spike MUST
record that specific metric as explicitly `undefined-for-this-heuristic-on-this-matrix` rather
than dividing by zero or silently omitting it, and MUST NOT let an undefined metric for one
heuristic suppress reporting the other heuristic's defined metric.

**Acceptance Scenarios**:

1. **Given** the pinned `backstage/community-plugins` commit
   `92e9e4e09c76cc57f3475029b73e5ec84498a459`, **When** the spike enumerates its
   `catalog-info.yaml`/`catalog-info.yml` descriptors by exact basename (not by path suffix,
   which would incorrectly match a differently-named file), **Then** it finds exactly 156 such
   files and confirms zero of them sit at the repository root — meaning the repository-root
   heuristic (C) would produce exactly one candidate path set — a single, identical `**`
   glob assigned to every entity in the corpus — recorded as a collision/cardinality finding
   (every entity in the corpus receives the same candidate glob, so any two entities'
   candidate path sets are indistinguishable; under the frozen `dot:false` picomatch options
   this literally matches every non-dot-segment changed file, not literally "every file" in
   the absolute sense — see User Story 5, Acceptance Scenario 4), not as a precision figure,
   since this corpus carries no `adrkit.io/owned-paths` ground truth to compute precision
   against.
2. **Given** the three sibling `community-plugins` descriptors
   `workspaces/adr/plugins/adr/catalog-info.yaml`,
   `workspaces/adr/plugins/adr-backend/catalog-info.yaml`, and
   `workspaces/adr/plugins/adr/examples/component/catalog-info.yaml`, **When** the spike
   applies the descriptor-parent heuristic (B) to each, **Then** it produces three different
   granularities for what is conceptually one workspace (a plugin-level directory, a sibling
   plugin-level directory, and a nested example fixture two levels deeper than either) —
   recorded as direct evidence of B's inconsistent granularity, not smoothed over.
3. **Given** the pinned `redhat-developer/rhdh-plugins` commit
   `3b355ddfedb23c6656bd9effc8510f9926b765c1`, which by exact-basename count has 38
   `catalog-info.yaml` descriptors — **not** 39; a path-suffix search over-counts by one
   because `workspaces/bulk-import/examples/template/create-pr-with-catalog-info.yaml` ends in
   the string "catalog-info.yaml" without being a `catalog-info.yaml` file — and which, unlike
   `community-plugins`, does have a repository-root `catalog-info.yaml`
   (`metadata.name: rhdh-plugins`), **When** the spike applies the repository-root heuristic
   there, **Then** it records that C would still bind every one of that corpus's other 37
   descriptor-derived entities (workspace-, plugin-, and scaffolder-skeleton-level) to the
   same repository-wide path set as the root entity itself — a collision the report must name
   explicitly, not merely note C "worked" because a root descriptor happened to exist.
4. **Given** `redhat-developer/rhdh-plugins`'s three real, differently-scoped
   `github.com/project-slug` values — `redhat-developer/rhdh-plugins` at the repository root
   (`catalog-info.yaml`, matching the repository's actual GitHub owner `redhat-developer`),
   `red-hat-developer-hub/rhdh-plugins` at `workspaces/orchestrator/catalog-info.yaml`, and
   `red-hat-developer-hub/backstage-plugins` at both
   `workspaces/orchestrator/plugins/orchestrator-backend/catalog-info.yaml` and
   `workspaces/bulk-import/catalog-info.yaml` — **When** the spike records this as the
   required "stale project slug" evidence, **Then** it states plainly that three
   non-identical values exist for one physical repository and that two of the three do not
   match that repository's actual GitHub organization, and it uses this as direct evidence
   against any default, authoritative, or repository-identity inference from
   `github.com/project-slug` (consistent with why the hardened contract sources repository
   identity from an explicit manifest instead — see User Story 2, Acceptance Scenario 3).
5. **Given** the synthetic labeled entity × changed-file matrix described in the Independent
   Test above, **When** the spike applies B and C to it and computes TP/FP/TN/FN per the
   stated classification, **Then** it records a concrete `precision` and `false-positive
   rate` figure for each heuristic against that finite matrix (or, for any heuristic/metric
   combination whose denominator is zero, the explicit `undefined-for-this-heuristic-on-this-
   matrix` label instead of a divide-by-zero) — explicitly labeled as measured against a
   spike-authored proxy oracle, not an adopter-authored one, and therefore insufficient by
   itself to satisfy the Evidence Gate's "authoritative `go`" requirement (Success Criteria
   SC-012).

---

### User Story 4 — Measure identity-only normalization (D) and confirm it does not unlock current matching (Priority: P2)

As the maintainer, I want to normalize entity refs from both pinned corpora into canonical
`kind:namespace/name` form with no path binding attached, and confirm through adrkit's own
unmodified `entitiesForPaths`/`matchEntityPattern` code path that an entity with empty or
absent `paths` never activates a changed-file match — while stating precisely what that
code path actually does in that state (a non-match, not necessarily an emitted finding) —
so that Option D's real (if narrower) value is not mistaken for sufficient value to unlock
path-based entity governance today.

**Why this priority**: Confirms a boundary the maintainer has already ratified, using
adrkit's real, unmodified core code rather than a re-implementation — this is cheap
confirmation, not new design.

**Independent Test**: Build `CatalogSnapshot` fixtures whose entities carry `refs` (from
Option D normalization) but no `paths`, feed them to the existing, unmodified
`resolveAffects`/`matchEntityPattern` functions in `packages/core/src/affects/`, and confirm
the entity matcher never matches any changed file for those entities — with the evidence
bundle recording the exact returned shape (`{ matched: false }`, with no
`affects-unresolvable`-class finding, since that finding is emitted only when the catalog
snapshot itself is entirely absent, not when it is present with empty per-entity `paths`) —
alongside a normal Option A fixture in the same run that does match, proving the absence of
effect is specific to D's missing path data, not a broken test harness.

**Acceptance Scenarios**:

1. **Given** a `CatalogSnapshot` entity produced purely by Option D normalization (`id` and
   `refs` populated, `paths` empty or omitted), **When** the existing `resolveAffects` is run
   against a changed-file list that would plausibly correspond to that entity's real-world
   location, **Then** the entity matcher returns a non-match for that entity with no
   `affects-unresolvable` finding attached to it (a catalog snapshot is present; only its
   per-entity `paths` are empty) — the evidence bundle must state this precisely rather than
   imply an unresolvable-style finding was emitted.
2. **Given** the same run also includes an Option A entity with a populated `paths` array
   that does cover the changed-file list, **When** `resolveAffects` runs once over both
   entities together, **Then** the Option A entity matches and the Option D-only entity does
   not, in the same pass — demonstrating the distinction is due to the presence or absence of
   `paths`, not an environment difference between the two measurements.

---

### User Story 5 — Exercise structural edge cases without violating the "local manifest only" constraint (Priority: P2)

As the maintainer, I want to exercise at least one genuine multi-document (`---`-separated)
catalog descriptor, at least one duplicate-YAML-key descriptor, and at least one `Location`
entity (`kind: Location`, `spec.targets`) — proving in the `Location` case that generation
does **not** follow the target reference, consistent with the hardened contract's "reads only
an explicit immutable local input manifest ... does not follow remote `Location` targets"
constraint — using synthetic fixtures, since neither pinned real corpus, as sampled for this
spec, was found to contain a multi-document descriptor or a `Location` entity, so that Option
A's contract is proven against structural shapes the Backstage descriptor format allows while
also proving the generator correctly refuses to chase references outside its declared input
manifest.

**Why this priority**: A convention that only works for the simplest descriptor shape is a
materially smaller finding than one proven against the format's real structural range; and a
generator that silently followed a `Location` target would violate the hardened contract's
completeness boundary in a way that is easy to get wrong by well-intentioned convenience code.

**Independent Test**: Author one synthetic multi-document fixture containing two or more YAML
documents in a single file (e.g. a `System` and a `Component` sharing a file, each with its
own `adrkit.io/owned-paths`), one synthetic fixture with a duplicate YAML key at the mapping
level, and one synthetic `Location` fixture whose `spec.targets` points at a second fixture
file carrying an actual `Component` and its annotation — but where only the `Location` file
itself is named in the input manifest. Confirm the multi-document case parses both entities
with no cross-document leakage; confirm the duplicate-key case is rejected; confirm the
`Location` case yields **zero** derived paths for the target `Component`, because the
generator never reads the file the `Location` merely points at.

**Acceptance Scenarios**:

1. **Given** a synthetic multi-document fixture with two entities in one file, each carrying
   a distinct `adrkit.io/owned-paths` value, **When** the spike derives paths for both,
   **Then** each entity's derived paths come only from its own document's annotation, and the
   evidence bundle records this fixture as synthetic (not a real-corpus find).
2. **Given** a synthetic descriptor whose YAML source contains a duplicate key at the mapping
   level (e.g. two `metadata:` blocks in one document), **When** the spike parses it, **Then**
   it is rejected per the hardened contract's duplicate-YAML-key rule, contributing to (rather
   than being exempt from) the whole-operation atomicity proven in User Story 2.
3. **Given** a synthetic `Location` entity whose `spec.targets` names a second fixture file
   that is not itself listed in the input manifest's descriptor paths, **When** the spike runs
   generation using only the manifest-listed files, **Then** the target file's `Component`
   entity contributes zero derived paths — not because its annotation was invalid, but because
   the generator never read a file outside the manifest to find it — and the evidence bundle
   states this distinction explicitly (never-read, not invalid-input).
4. **Given** an `adrkit.io/owned-paths` glob such as `.github/**` versus a plain glob such as
   `packages/**`, evaluated against a changed-file list containing a dotfile-segment path
   (e.g. `.github/workflows/ci.yml`), **When** the spike compares the resulting dotfile-match
   behavior to `picomatch`'s own `dot:false` option (the frozen engine/options per the
   hardened contract), **Then** it confirms — matching the hardened contract's explicit
   dotfile policy — that `.github/**` matches the dotfile path and a bare `packages/**` or
   `**` does not, and records that this is `picomatch`'s existing built-in `dot:false`
   behavior requiring no additional code for Option A's own validator, not an open design
   question between two competing behaviors (a distinction this spec's own earlier drafting
   initially got wrong before directly executing `picomatch` and observing identical *output*
   for both of adrkit's existing matchers for the tested cases) — while still recording that
   `packages/core/src/affects/matchers/path.ts` and `packages/core/src/affects/inert.ts` are
   not identical at the *source-code* level (`path.ts` carries its own additional, redundant
   dot-segment guard that `inert.ts` lacks); only observed behavioral parity for the tested
   cases is claimed, never source-code equivalence.

---

### User Story 6 — Prove deterministic ordering and produce the required versioned snapshot envelope with scale evidence (Priority: P1)

As the maintainer, I want to run each single-repository generation pass (one manifest, one
repository ID/revision per FR-009 — separate passes for the community-plugins-derived
fixtures, the rhdh-plugins-derived fixtures, and the primary synthetic fixture set, never one
merged cross-repository run) multiple times and confirm each pass's own output is
byte-identical every time, produce the hardened contract's **required** (not merely advisory)
versioned snapshot envelope — one per pass — containing schema version, repository
ID/revision, generator version, glob dialect/version/options, capability/completeness flags,
source paths/digests, and deterministic entities, and record scale evidence (annotation
bytes, entity count, patterns per entity, pattern length, documents/aliases, and compile/match
cost) aggregated **in the evidence bundle only** across all passes — so that reproducibility
and each envelope's actual shape are demonstrated directly, without ever implying a single
snapshot spans more than one repository, and so that any future production feature inherits
measured scale numbers rather than guessed limits.

**Why this priority**: Determinism is a stated requirement of the ratified contract and of
ADR-0009's purity requirement; the versioned envelope and scale evidence are explicit,
required deliverables of the hardening decision, not optional polish.

**Independent Test**: For each of the separate single-repository passes (community-plugins-
derived fixtures, rhdh-plugins-derived fixtures, and the primary synthetic fixture set — each
under its own manifest and repository ID per FR-009), run the full derivation (Option A plus
the B/C/D measurements) three or more times against that pass's identical fixture inputs and
diff the outputs; each pass's three-or-more outputs must be byte-identical among themselves
(cross-pass byte-identity is neither expected nor required, since different passes cover
different repository IDs and different entities). For each pass, produce one concrete
envelope document (JSON, per FR-035's canonicalization requirement — not "JSON or equivalent")
containing every field the hardened contract names, populated from that pass's actual run —
not a schema sketch. Separately, measure and record,
for each pass: total `adrkit.io/owned-paths` annotation bytes (zero for both real-corpus
passes, since neither carries the annotation, per User Story 1/3), entity count, patterns per
entity, maximum pattern length, count of multi-document files and any ref aliases encountered,
and wall-clock compile/match cost — then aggregate these per-pass numbers into one combined
scale-evidence summary in the evidence bundle, clearly attributing each figure to its
originating pass.

**Acceptance Scenarios**:

1. **Given** one single-repository pass's identical fixture input set, **When** the spike runs
   that pass's full derivation three times, **Then** all three outputs for that pass are
   byte-identical, including sort order, deduplication, canonicalization, and rejection-reason
   text — verified independently for each of the three passes (community-plugins-derived,
   rhdh-plugins-derived, primary synthetic).
2. **Given** the spike has completed one full generation run for one pass, **When** it
   produces that pass's envelope, **Then** the envelope document actually contains populated
   values for schema version, that pass's own repository ID/revision (from User Story 2's
   manifest pattern), generator version, glob dialect identifier/version/options
   (`picomatch 4.0.5`, `dot:false`/`nocase:false`/`nonegate:true`), capability/completeness
   flags (explicitly `false` for whole-catalog completeness, per the hardened contract),
   source paths/digests, and that pass's own deterministic entity list — never merging
   entities from a different pass's repository into it, and never a description of what such
   an envelope *would* contain.
3. **Given** all three passes, **When** the spike records scale evidence, **Then** it states
   the exact measured numbers (not estimates) for annotation bytes, entity/pattern counts,
   pattern length, and documents/aliases per pass, aggregates them in the evidence bundle with
   each figure clearly attributed to its originating pass, and explicitly declines to propose
   a production limit from this evidence alone, per the hardened contract's "not guessed now"
   instruction.

---

### User Story 7 — Prove malformed/tampered/stale/misidentified snapshot rejection and repository isolation, using synthetic fixtures, without an adopter oracle (Priority: P2)

As the maintainer, I want to prove — using synthetic fixtures only, with no adopter oracle
involved — that a consumer correctly rejects a structurally malformed or unsupported envelope,
a tampered envelope (its content digest no longer matches its actual content), a stale
envelope (a revision other than the consumer's separately-configured expected-current
revision for that repository), and an envelope whose declared repository identity does not
match the consumer's own expected repository — and that a tool legitimately holding two
independently-generated, individually-valid single-repository envelopes never lets a query
scoped to one repository's ID return an entity that actually originated from the other — so
that the hardened contract's malformed/tamper/stale/repository-isolation requirements are
demonstrated as an offline, mechanical generator-and-consumer property this spike genuinely
can prove — distinct from, and never a substitute for, the adopter-oracle-dependent precision
guarantee the Evidence Gate separately reserves for "authoritative `go`."

This story deliberately keeps two things separate that are easy to conflate: (a) **generation
never produces a federated/multi-repository snapshot** — single-repository-only remains an
absolute constraint (FR-009; multi-repository/federated snapshots remain out of scope) — and
(b) **a downstream tool may still, legitimately, hold two or more separately-generated,
individually valid single-repository envelope files at once** (e.g., an index across several
repositories' already-generated snapshots) and must not let a query scoped to one of them leak
results from another — neither envelope is rejected in this case; both remain independently
valid, and isolation is a property of the query, not an error condition. (b) is distinct from
(c) a consumer's outright *rejection* of an envelope whose declared identity does not match
what that specific consumer expected (Acceptance Scenario 4) — mismatch-and-reject is the
right response when a consumer explicitly expected one repository and received another;
filter-and-isolate is the right response when a consumer is deliberately querying across
multiple, each-individually-expected repositories at once.

**Why this priority**: Without this story, a reader could wrongly infer that "no adopter
oracle available" means "nothing about malformed/tamper/stale/isolation robustness can be
shown at all." This story draws the line precisely: mechanical corruption/staleness/isolation
detection is provable offline today; real-world path-ownership precision is not — and this
story is deliberately explicit about where its own tamper check's strength stops, rather than
overclaiming a stronger guarantee than an unsigned digest can actually provide.

**Independent Test**: Produce one valid envelope from User Story 6. Canonicalize it per
RFC 8785 (sorted object keys at every nesting level, no insignificant whitespace, arrays in
declaration order), covering every field including `schemaVersion` and excluding only the
digest field itself, and compute its SHA-256 digest. Construct a **malformed/unsupported**
copy (omit a required field, produce invalid JSON, declare an unrecognized `schemaVersion`/
dialect/capability, omit a declared source's digest, or set `completeness.identityOnly: true`
per FR-022) and confirm a consumer rejects it before ever reaching the digest check — and
confirm, separately, that an otherwise-ordinary envelope whose entities merely all happen to
be `annotation-absent` (with `completeness.identityOnly: false`) is NOT rejected on that basis
alone; construct a **tampered** copy by mutating one entity's `paths` after generation
*without* updating the envelope's own digest, and confirm a consumer that independently
recomputes the digest rejects it; separately, to isolate the staleness and repository-identity
checks from the digest check, construct a **stale** copy declaring any revision other than a
separately-configured "expected-current" revision for the same repository ID, but with its
digest *recomputed* over its own actual (mutated-revision) content so it passes the digest
check cleanly — confirming the subsequent rejection is specifically attributable to staleness
(per FR-036, staleness for this spike is exact inequality, not chronological ordering, since
opaque commit SHAs have no ordering without separate ancestry data), not to a coincidental
digest mismatch; likewise construct an envelope declaring a **different repository ID** than
a consumer's own separately-configured expected repository, again with its digest recomputed
over its own actual content, and confirm that consumer rejects it outright specifically for
identity mismatch (not merely filters it out, and not because of an incidental digest
failure); separately, construct two fully valid envelopes (correct digests, matching expected
revisions and repository IDs) for two distinct repository IDs and confirm a tool legitimately
querying across both (never merging them into one snapshot, neither rejected) returns only the
queried repository's entities.

**Acceptance Scenarios**:

1. **Given** an envelope missing a required field, containing syntactically invalid JSON,
   declaring an unrecognized `schemaVersion`/glob-dialect version/capability, missing a
   declared source's digest, or carrying `completeness.identityOnly: true`, **When** a
   consumer performing path-ownership matching attempts to load it, **Then** it is rejected
   as malformed/unsupported/partial, non-zero, before any digest, revision, or
   repository-identity check is even attempted. **Given**, separately, an otherwise
   well-formed envelope whose entities simply all happen to be `annotation-absent` with
   `completeness.identityOnly: false`, **When** the same consumer loads it, **Then** it is
   accepted — an envelope is never treated as partial/identity-only merely because its
   entities' ownership states happen to be absent; only `completeness.identityOnly` decides
   that.
2. **Given** a valid envelope from User Story 6, **When** one entity's `paths` field is
   mutated after generation without updating the envelope's own digest (computed per the
   Independent Test's RFC 8785 canonicalization over every field including `schemaVersion`,
   not the entity list alone), **Then** a consumer that independently recomputes and compares
   that digest rejects the tampered envelope, non-zero, naming the mismatch — never silently
   trusting mutated content. This proves accidental-corruption and naive-mutation detection;
   it does not resist an adversary who mutates content and also recomputes the same digest
   algorithm — a stronger, cryptographically-signed tamper-evidence mechanism is an explicitly
   open question this spike does not attempt (see FR-035).
3. **Given** two envelopes for the same repository ID — each with its own digest correctly
   recomputed over its own actual content, so neither fails the digest check — one declaring a
   revision equal to a consumer's separately-configured expected-current revision and one
   declaring any other revision, **When** the consumer checks each, **Then** it accepts the
   matching one and rejects the other specifically as stale, non-zero, naming the revision
   mismatch — exact inequality, not an "older/newer" comparison, since opaque commit SHAs
   carry no ordering this spike can determine without separate ancestry data (out of scope).
   Recomputing the digest first isolates this rejection as attributable to staleness, not to
   an incidental digest failure.
4. **Given** a consumer configured with one specific expected repository ID, **When** it is
   given an envelope — its digest correctly recomputed over its own actual content, so it does
   not fail the digest check — declaring a different repository ID, **Then** the consumer
   rejects it outright specifically for the identity mismatch, non-zero, naming it — this is a
   rejection by a consumer that expected exactly one repository, never to be confused with Acceptance Scenario 5's multi-repository
   query-isolation case.
5. **Given** two envelopes generated for two distinct repository IDs — neither merged nor
   claiming to be a federated snapshot — **When** a tool deliberately queries across both,
   scoped to the first repository ID, **Then** it returns only entities originating from the
   first envelope; no entity from the second is ever returned, without either envelope being
   rejected (both remain independently valid; isolation is a property of the query, not an
   error condition).
6. **Given** all of the above, **When** the spike records this evidence, **Then** it
   explicitly states that these are offline, mechanical generator/consumer-boundary
   properties provable without an adopter, that the digest check specifically proves
   accidental-corruption/naive-mutation detection — not adversarial cryptographic tamper-
   resistance, which is an explicitly open question this spike does not attempt — and that
   none of this, by itself, satisfies the adopter-oracle-dependent portion of the Evidence
   Gate's "authoritative `go`" requirement (Success Criteria SC-012).

---

### User Story 8 — Record exactly one spike verdict, distinct from any future authoritative `go`, leaving the release vehicle undecided (Priority: P1)

As the maintainer, I want the spike to conclude with exactly one of three defined verdicts —
`go-explicit`, `blocked`, or `no-go` — backed by the specific evidence gathered in User
Stories 1–7, explicitly distinguished from the hardened contract's separate, stronger
"authoritative `go`" status (which requires an independent adopter's oracle this spike cannot
itself provide), plus (if the verdict is `go-explicit`) a clearly non-binding recommendation
for the smallest later production slice that explicitly leaves the eventual package's
publish/release vehicle undecided, so that a future, separately-scoped feature can decide
whether to build `packages/adapters/catalog-backstage` without re-litigating whether Option
A's own mechanics are sound.

**Why this priority**: This is the deliverable the spike exists to produce; every other story
is evidence feeding this one conclusion.

**Independent Test**: Read the completed evidence bundle from User Stories 1–7 and confirm it
maps to exactly one verdict per the fixed-precedence definitions in Success Criteria, with
every piece of required evidence present and cross-referenced, and confirm the report
explicitly states both (a) that this spike's technical result alone does not itself satisfy
either open gate in this spec's banner (Phase 6 T048/T049 landing; and independent-adopter
validation — noting that the governance preconditions, ADR-0012's catalog-binding governance
and ADR-0013's authoritative status disposition of ADR-0007/ADR-0009, are already satisfied
independently of this spike, and that ADR-0007/ADR-0009's own `proposed` status is not one of
this spec's execution gates), and (b) that even a `go-explicit` verdict is not the hardened
contract's "authoritative `go`" and does not itself satisfy the independent-adopter gate.

**Acceptance Scenarios**:

1. **Given** all of User Stories 1–7 have produced their required evidence, **When** the
   spike concludes, **Then** exactly one of `go-explicit`, `blocked`, `no-go` is recorded,
   matching the precise definition of that verdict in Success Criteria, with no ambiguity
   about which evidence drove the choice.
2. **Given** the verdict is `go-explicit`, **When** the spike records its output, **Then** a
   "smallest later production slice" recommendation is included as an explicitly
   informational, non-binding note that names a scope (e.g., an offline
   `packages/adapters/catalog-backstage` generator limited to Option A alone, reading only a
   local input manifest) but explicitly leaves the eventual package's publish/release vehicle
   (npm package name, publish trigger, which existing `@adrkit/*` release process it would
   join, if any) undecided, and explicitly states that `go-explicit` is not the hardened
   contract's "authoritative `go`."
3. **Given** any verdict, **When** the spike records its output, **Then** it explicitly
   states that this spike's technical result does not itself satisfy, substitute for, or take
   credit for either open gate in this spec's banner — Phase 6 landing or independent-adopter
   validation — each of which will clear through its own separate, prior action, never because
   of this spike's own result; that the governance preconditions (ADR-0012's catalog-binding
   governance, ADR-0013's authoritative status disposition of ADR-0007/ADR-0009, and the
   maintainer's issue #25 ratification) are already satisfied independently of this spike; and
   that ADR-0007/ADR-0009's own `proposed` status is not one of this spec's execution gates and
   is not cleared or advanced by this spike's verdict (see the banner's satisfied-preconditions
   note, FR-028, and FR-030), and that no production `packages/adapters/catalog-backstage`
   work may begin on the strength of this verdict alone.

---

### Edge Cases

- What happens when an `adrkit.io/owned-paths` value is syntactically valid JSON but not an
  array of strings (e.g. a JSON object, a bare string, or an array containing a non-string
  element)? It must be rejected with a shape-specific reason distinct from the per-pattern
  validation rules — never coerced.
- What happens when the JSON itself fails to parse (malformed JSON, e.g. an unescaped quote
  inside the annotation string)? It must be rejected with a parse-error reason; per User
  Story 2, this — like every other rejection class — aborts the entire snapshot operation, not
  merely that one entity.
- What happens when a `..` appears inside a glob's brace-expansion or character class (e.g.
  `packages/{a,..}/**`)? Under the hardened restricted dialect, braces are rejected outright
  regardless of their contents, so this specific near-miss no longer needs a special
  segment-vs-substring distinction — the pattern is invalid because it contains a brace, full
  stop. The spike must still confirm that a `..` appearing as a bare path segment in an
  otherwise-brace-free pattern (e.g. `packages/../etc`) is rejected by the traversal rule
  specifically, so the two rejection reasons (brace-dialect violation vs. traversal) remain
  distinguishable in the evidence bundle.
- What happens when two entities have distinct canonical IDs but declare overlapping (not
  identical) `owned-paths` globs? This is not a duplicate-ID failure — the hardened contract's
  "no exclusive winner" rule explicitly permits semantic overlap between distinct entities,
  mirroring ADR-0009's union-not-winner `affects` semantics — and must not be rejected.
- What happens for an entity whose descriptor has an `adrkit.io/owned-paths` annotation but
  whose value is the single-element array `[""]` (an empty string inside an otherwise
  well-formed array) versus the fully empty array `[]`? The empty-string element must be
  rejected per the empty-pattern rule even though the array itself is non-empty and
  well-formed — and, per User Story 2, this rejection aborts the whole operation. This is
  distinct from, and must not be conflated with, the `explicit-empty` (`[]`) vs
  `annotation-absent` distinction, which concerns a different pair of states entirely.
- What happens if the descriptor-parent heuristic (B) is applied to the synthetic `Location`
  fixture from User Story 5? Its "parent directory" is not meaningfully a path a `Location`
  entity itself owns, and — separately — the generator never reads the file the `Location`
  points at in the first place (User Story 5, Acceptance Scenario 3); the spike must record
  both facts as further, independent data points for B's unreliability, not silently skip
  either.
- What happens if re-fetching either pinned corpus at execution time (once gates clear)
  returns a different descriptor count or different annotation values than this spec cites
  (e.g. because a mutable ref, rather than the pinned SHA, was mistakenly used)? The spike
  must re-verify each pinned commit SHA is still reachable and fail closed rather than
  silently substitute a different commit's contents for this spec's citations (mirrors FR-001
  and Assumption A2).
- What happens if a descriptor's repository-identity annotations (e.g. `github.com/
  project-slug`) disagree with the input manifest's declared repository ID? Per User Story 2,
  Acceptance Scenario 3's repository-mismatch rule, the manifest's declared ID is
  authoritative for repository identity; a disagreeing annotation is not itself an error
  (annotations are never read for repository identity at all under the hardened contract) and
  must not be independently flagged as a mismatch — only a mismatch between the manifest and
  the *actual* fixture provenance triggers the abort.

## Requirements

### Functional Requirements

- **FR-001**: This spike's immutable research inputs are exactly three commits:
  Backstage `1121a4facd9e321179d0402c3f355e4a649e84d9`,
  `backstage/community-plugins@92e9e4e09c76cc57f3475029b73e5ec84498a459`, and
  `redhat-developer/rhdh-plugins@3b355ddfedb23c6656bd9effc8510f9926b765c1`. Immediately before
  spike execution, each MUST be re-verified still reachable at that exact SHA. The spike MUST
  NOT substitute a branch `HEAD` or any newer commit for any of the three.
- **FR-002**: The spike MUST treat only Option A (the hardened `adrkit.io/owned-paths`
  annotation contract) as a candidate for authoritative, default entity-to-path binding.
  Options B (descriptor-parent) and C (repository-root) MUST be implemented, if at all, only
  as separately labeled, opt-in measurement heuristics, and every report row produced by
  either MUST carry an explicit non-authoritative label.
- **FR-003**: The `adrkit.io/owned-paths` value MUST be parsed only after JSON decoding, and
  MUST be validated as exactly `array<string>` — a value that decodes to valid JSON but is not
  an array of strings (object, bare string, number, or an array containing a non-string
  element) MUST be rejected with a distinct shape-specific reason from FR-004's per-pattern
  reasons, and a value that fails to parse as JSON at all MUST be rejected with a distinct
  parse-error reason.
- **FR-004**: Each decoded pattern string MUST be validated against the hardened restricted
  dialect and rejected, with a rule-specific reason, if it: starts with `/`; is an absolute or
  drive/UNC path; contains a backslash `\`; is empty (`""`); contains a `.` or `..`
  path-traversal segment (both are rejected per the hardened contract; evaluated on decoded
  path segments); contains a brace `{`/`}`, a bracket `[`/`]`,
  a parenthesis `(`/`)` (extglob), a comma `,`, a backslash escape, a leading `!`, an empty
  segment, or a NUL/control character. Valid patterns are restricted to POSIX segments
  containing only literals (`A-Z`, `a-z`, `0-9`, `_`, `-`, `.`) plus `*`, a whole-segment `**`,
  and `?`.
- **FR-005**: Canonical entity identity MUST be the full lowercase `kind:namespace/name` form,
  matching Backstage's own `stringifyEntityRef` lowercasing behavior
  (`packages/catalog-model/src/entity/ref.ts` at the pinned commit), including its
  default-namespace substitution when a descriptor omits `metadata.namespace` — two
  descriptors whose refs differ only by case, or one of which relies on the default namespace
  and one of which names it explicitly, MUST canonicalize to the identical ID when they in
  fact denote the same namespace.
- **FR-006**: Every canonical entity **ID** and every canonical entity **ref** (an entity's
  own ID plus any additional aliases it declares) MUST be globally unique within one snapshot.
  For this spike, an entity's alias refs are supplied directly by the synthetic fixture's own
  construction — as additional entries in the entity's derived `refs` array, mirroring the
  `refs?: readonly string[]` field already defined on `CatalogSnapshotEntity`
  (`packages/core/src/affects/catalog.ts`) — never derived from any specific Backstage
  descriptor annotation, since Backstage itself has no standard field for declaring such an
  alias. This is a synthetic-fixture-only test of the uniqueness *rule*, not a claim about how
  a future production adapter would source aliases from real descriptors — that sourcing
  mechanism, if any, is a separate, later, explicitly-scoped design decision. Duplicate
  canonical IDs, duplicate canonical refs (including a ref colliding with a different entity's
  ID, and case-only collisions produced by FR-005), and duplicate YAML mapping keys within a
  single descriptor document MUST all be treated as invalid input under the whole-operation
  atomicity rule (FR-007); none may be silently merged, and none may be resolved by first-wins
  or last-wins.
- **FR-007**: Any invalid input encountered during a single snapshot-generation run —
  including but not limited to a duplicate canonical ID/ref, a duplicate YAML key, malformed
  or wrongly-shaped JSON (FR-003), a rejected pattern (FR-004), an unsupported snapshot
  version/capability, a repository mismatch (FR-009), or an incomplete required source — MUST
  abort the **entire** run with non-zero status and produce **no usable partial snapshot**,
  including for entities that would otherwise have validated cleanly in the same run. This
  supersedes any narrower, per-entity reading of "fail closed."
- **FR-008**: Output owned-paths per entity MUST be sorted lexicographically and deduplicated
  before being placed into the measured `CatalogSnapshotEntity`-shaped `paths` array,
  consistent with the existing sort-and-dedupe convention already used for fired matchers in
  `packages/core/src/affects/index.ts` (`uniqueSortedFiredMatchers`). Every entity's
  ownership state MUST be recorded using exactly one of three discriminator values: a
  non-empty, valid `adrkit.io/owned-paths` array is recorded `explicit-paths`; an explicit
  empty array (`[]`) is recorded `explicit-empty`; a wholly absent annotation is recorded
  `annotation-absent`. The three states MUST NOT be conflated with one another anywhere in
  the evidence bundle, and each entity's record in the versioned snapshot envelope (FR-022)
  MUST carry this three-way ownership-state discriminator as an explicit field — never leaving
  the distinction recoverable only from the evidence bundle's prose.
- **FR-009**: Snapshot generation MUST be bound to exactly one repository, identified by a
  lowercase `github.com/<owner>/<repo>` canonical ID and a full-commit-SHA revision, both
  supplied by an explicit, immutable local input manifest — never inferred from any
  descriptor annotation, including `github.com/project-slug`. Repository identity MUST be
  verified against the actual git checkout generation runs in — `git remote get-url origin`
  normalized to lowercase `github.com/<owner>/<repo>`, and `git rev-parse HEAD` — read via
  separate git tooling, not merely re-read from the same manifest file under test. A mismatch
  between the manifest's declared repository identity/revision and the checkout's actual
  `origin`/`HEAD` MUST abort generation before any entity's paths are derived (FR-007). This
  spike's verification is bounded by FR-018's offline constraint: it confirms the manifest
  agrees with the checkout's own locally-configured git state, not with a live,
  network-verified GitHub repository — a stronger, network-verified provenance check (e.g.
  confirming the checkout's remote is reachable and matches a real GitHub repository) is
  explicitly out of scope for this offline spike and left to any later production feature.
- **FR-033**: The input manifest MUST declare exactly three version/capability fields, each with
  a fixed, spike-defined supported value or set — not an illustrative example:
  - `manifestSchemaVersion`: the only value this spike's generator accepts is the exact
    string `"1"`. A manifest declaring any other value MUST be rejected as an "unsupported
    manifest version" before any entity's paths are derived (FR-007).
  - `requestedSnapshotSchemaVersion`: the only value this spike's generator accepts is the
    exact string `"1"`, matching the `schemaVersion` value FR-022's envelope actually emits —
    this field expresses what output shape the manifest's author expects, distinct from the
    manifest's own format version above. A manifest declaring any other value MUST be
    rejected as an "unsupported snapshot version" before any entity's paths are derived.
  - `requiredCapabilities`: an array whose only defined member for this spike is the exact
    string `"pathOwnership"`. A manifest whose `requiredCapabilities` array contains any
    string other than `"pathOwnership"` MUST be rejected as an "unsupported capability"
    before any entity's paths are derived.

  All three rejections are properties of the manifest/generation request as a whole, never of
  an individual entity within a batch (User Story 2, Acceptance Scenario 4).
- **FR-034**: The envelope format is JSON, exactly (not "JSON or equivalent"). A consumer
  MUST reject an envelope, non-zero, naming the specific reason, before attempting any digest,
  revision, or repository-identity check, if it: does not parse as valid JSON; is missing any
  of FR-022's required top-level fields; has a field present with the wrong JSON type (e.g.
  `entities` not an array); declares an envelope `schemaVersion`, glob dialect version, or
  capability the consumer does not recognize (a consumer-side check, distinct from FR-033's
  generation-time manifest check); is missing a declared source digest for one of its own
  listed source paths (an incomplete envelope); or carries `completeness.identityOnly: true`
  (FR-022) — the one, precisely-defined signal for a partial/identity-only artifact. Whether a
  given envelope is partial/identity-only for path-ownership matching MUST be determined
  **solely** from that one boolean field — never inferred from scanning the entity list's
  ownership-state distribution. An envelope with `completeness.identityOnly: false` whose
  entities all happen to be `annotation-absent` (per FR-008) is NOT, by that fact alone,
  partial or identity-only: absent annotations are a valid, expected state under the hardened
  contract (no descriptor in the corpus has adopted `adrkit.io/owned-paths` yet, but Option A
  derivation was genuinely attempted for every entity), and MUST NOT be conflated with an
  envelope that structurally declares `completeness.identityOnly: true` (User Story 7,
  Acceptance Scenario 1).
- **FR-035**: Every produced envelope (FR-022) MUST carry a content digest, computed as
  follows, fixed for this spike (no "e.g." — this is the exact contract): canonicalize the
  entire envelope (including `schemaVersion`, excluding only the digest field itself) per
  RFC 8785 (the JSON Canonicalization Scheme — lexicographically sorted object keys at every
  nesting level, no insignificant whitespace, arrays preserve declaration order); compute the
  digest as SHA-256 over the UTF-8 bytes of that canonicalized form. A consumer MUST
  independently recompute that digest and compare it against the envelope's declared value
  before trusting any entity's `paths`; a mismatch MUST be rejected non-zero, naming the
  mismatch, never silently trusted (User Story 7, Acceptance Scenario 2). This spike
  deliberately limits its tamper check to this unsigned digest, which proves
  accidental-corruption and naive-mutation detection — it does not resist an adversary who
  mutates content and also recomputes the same digest algorithm. Whether production requires a
  stronger, cryptographically-signed tamper-evidence mechanism (with its own key-management,
  trust-anchor, and deterministic-output design questions, none of which this spike resolves)
  is an explicitly open question left to a separate, later production-scoping decision — this
  spike does not attempt that stronger mechanism, to avoid broadening into implementation-level
  cryptographic design decisions it is not scoped to make.
- **FR-036**: A consumer MAY be configured with an expected-current repository revision for a
  given repository ID. Because commit SHAs are opaque identifiers with no defined ordering
  available to this spike without separate git-ancestry data (out of scope), "stale" for this
  spike's purposes means exact inequality, not chronological comparison: when so configured,
  an envelope declaring **any** revision other than the exact configured expected-current
  revision for that same repository ID MUST be rejected as stale, non-zero, naming the
  revision mismatch, rather than silently accepted (User Story 7, Acceptance Scenario 3).
- **FR-037**: A consumer configured with one specific expected repository ID MUST reject,
  non-zero, naming the mismatch, any envelope declaring a different repository ID (User Story
  7, Acceptance Scenario 4) — this is distinct from FR-038: rejecting an unexpected repository
  is the correct response for a single-repository-scoped consumer; it is never to be confused
  with a consumer that deliberately queries across multiple, each-individually-expected
  repositories at once.
- **FR-038**: A tool legitimately holding two or more independently-generated,
  individually-valid single-repository envelopes at once (never a merged or federated
  snapshot — FR-009 and the Out of Scope section's single-repository-only constraint are
  unaffected; neither envelope is rejected, and both remain independently valid) MUST NOT let
  a query scoped to one repository ID return any entity that actually originated from another
  repository's envelope (User Story 7, Acceptance Scenario 5). This spike MUST demonstrate
  FR-034–FR-038 using its own synthetic fixtures alone, with no adopter oracle involved, and
  MUST explicitly record that doing so is a mechanical, offline generator/consumer-boundary
  proof distinct from — and insufficient by itself to satisfy — the adopter-oracle-dependent
  portion of the Evidence Gate's "authoritative `go`" requirement (FR-025).
- **FR-010**: Snapshot generation MUST read only the descriptor files explicitly listed, by
  path and content digest, in the input manifest. It MUST NOT follow a `Location` entity's
  `spec.targets` reference to read a file not itself listed in the manifest, MUST NOT invoke
  any catalog processor or plugin, and MUST NOT claim or imply whole-catalog completeness.
- **FR-011**: The spike MUST measure Options B and C against both pinned real corpora and MUST
  report only cardinality/collision/granularity findings there (never a precision figure,
  since neither real corpus carries `adrkit.io/owned-paths` ground truth), and MUST separately
  build a finite, spike-authored labeled entity × changed-file matrix (at least ten entities,
  constructed to include both a labeled-true and a labeled-false example per entity) and
  compute, for Options B and C against that matrix, `precision = TP / (TP + FP)` and
  `false-positive rate = FP / (FP + TN)` using the true/false-positive/negative classification
  defined in User Story 3's Independent Test — recording `undefined-for-this-heuristic-on-
  this-matrix` rather than dividing by zero wherever a denominator is zero — and explicitly
  labeling that matrix's labels as spike-authored, not adopter-authored.
- **FR-012**: The spike MUST measure Option D (identity-only normalization) and MUST confirm,
  via the existing, unmodified `matchEntityPattern`/`entitiesForPaths` code path
  (`packages/core/src/affects/inert.ts`), that an identity-only entity (empty or absent
  `paths`) never activates a changed-file match, and MUST record the precise returned shape
  (a non-match with no `affects-unresolvable` finding attached, since that finding class is
  emitted only when the catalog snapshot itself is entirely absent) rather than implying an
  unresolvable-style finding was produced.
- **FR-013**: The spike MUST exercise at least one genuine multi-document (`---`-separated)
  catalog descriptor, at least one descriptor with a duplicate YAML mapping key, and at least
  one `Location` entity whose `spec.targets` file is deliberately excluded from the input
  manifest — all as synthetic fixtures, since neither pinned real corpus, as sampled for this
  spec, was found to contain a multi-document descriptor or a `Location` entity — and MUST
  state explicitly in its evidence that these are synthetic.
- **FR-014**: The spike MUST reproduce, as real-corpus evidence, the "stale project slug" case
  documented in User Story 3 Acceptance Scenario 4 — `redhat-developer/rhdh-plugins`'s three
  non-identical `github.com/project-slug` values for one physical repository, two of which do
  not match that repository's actual GitHub organization — and MUST report this as evidence
  against relying on `github.com/project-slug` for authoritative inference of any kind,
  including repository-identity inference.
- **FR-015**: The spike MUST reproduce, as real-corpus evidence, the "absent annotation is the
  overwhelmingly common case" finding: across a full scan of the 156 `backstage/
  community-plugins` `catalog-info.yaml` descriptors at the pinned commit, 23 carry any
  `metadata.annotations` block at all, and 0 carry `adrkit.io/owned-paths`. The spike MUST
  record these exact counts rather than an estimate, and MUST NOT claim a materially
  different rate without resampling.
- **FR-016**: The spike MUST reproduce, as real-corpus evidence, the descriptor-parent (B)
  granularity-inconsistency case documented in User Story 3 Acceptance Scenario 2 — at minimum
  the three sibling `community-plugins` descriptors
  (`workspaces/adr/plugins/adr/catalog-info.yaml`,
  `workspaces/adr/plugins/adr-backend/catalog-info.yaml`,
  `workspaces/adr/plugins/adr/examples/component/catalog-info.yaml`) — and MUST cite the
  `redhat-developer/rhdh-plugins` descriptor count as exactly 38 (by exact basename match),
  noting that a naive path-suffix search over-counts to 39 by incorrectly matching
  `workspaces/bulk-import/examples/template/create-pr-with-catalog-info.yaml`.
- **FR-017**: The spike MUST confirm, by direct execution of `picomatch` with the frozen
  options (`dot:false`, `nocase:false`, `nonegate:true`), that a bare `**` pattern does not
  match a changed-file path containing a dot-prefixed segment (e.g. `.github/workflows/
  ci.yml`) while a pattern explicitly naming that dot segment (e.g. `.github/**`) does — and
  MUST record this as confirmation of the hardened contract's existing dotfile policy, not as
  an open design question, since both of adrkit's existing core matchers
  (`packages/core/src/affects/matchers/path.ts` and `packages/core/src/affects/inert.ts`)
  already produce this same `picomatch`-native *behavior* for the tested cases. The spike MUST
  NOT claim this as code-level equivalence between the two matchers: `path.ts` additionally
  contains its own manual `hasDotSegment`/`patternAllowsDotSegment` guard logic that
  `inert.ts` does not have, which is redundant with — not identical in implementation to —
  `picomatch`'s own `dot:false` handling for the specific cases this spike tested; the spike
  MUST record only observed behavioral parity for those tested cases, not a general claim
  about the two files' source code.
- **FR-018**: Fetching the three pinned commits' content (FR-001) is a separate, one-time,
  networked **preflight acquisition step** — already completed once for this spec's own
  drafting and repeatable from cached or vendored copies at execution time. Every actual
  fixture/corpus **derivation run** (parsing, validating, canonicalizing, and generating a
  snapshot) MUST begin only after that acquisition is complete and MUST run with network
  access actively denied for the run's duration — never merely "no network calls happened to
  occur." The spike MUST record which network-denial mechanism it used during derivation runs
  (e.g. an OS-level firewall rule, a network namespace, or equivalent) and its limitations,
  MUST confirm no credential or bearer-token environment variable is set for the run, and MUST
  bracket every derivation run with a `git status --porcelain` capture immediately before and
  immediately after, showing no change in either case.
- **FR-019**: The spike MUST NOT mutate any tracked repository file outside its own
  scratch/evidence output; it MUST NOT commit, push, or open a pull request during its
  execution; and it MUST NOT write to `docs/adr/**`, the ADR schema, or any file under
  `packages/adapters/**`. The evidence bundle itself MUST remain scratch/untracked output; if
  the spike's verdict, together with this spec's two remaining execution gates (FR-027)
  having already cleared, jointly justify incorporating a summary into a tracked document,
  that incorporation happens through its own explicitly-scoped, separately-authorized
  subsequent PR — never as a
  direct or indirect side effect of running this spike.
- **FR-020**: The spike MUST NOT change `packages/core/src/affects/**`'s existing matcher
  semantics or the `CatalogPort`/`CatalogSnapshot` type shapes in
  `packages/core/src/affects/catalog.ts`, and MUST NOT change any ADR-0009-defined resolution
  behavior; the versioned envelope the spike produces (FR-022) is a new, separate artifact
  and MUST NOT be added as a field on the existing `CatalogSnapshot`/`CatalogSnapshotEntity`
  types.
- **FR-021**: The spike MUST NOT introduce a general runtime plugin loader of any kind. Per
  [ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
  (`status: accepted`, PR #27), which narrows ADR-0007's general "discovery is by
  configuration, resolved at runtime" language specifically for the catalog surface: **"no
  dynamic runtime adapter/plugin loader"** — there is no separate composition host that
  discovers, resolves, or dynamically imports a catalog adapter at runtime, not even one
  restricted to a single statically-known package name. Any later composition path this
  spike's evidence recommends MUST instead be a **standalone offline snapshot generator**: an
  executable that a human or CI directly invokes by name (e.g. running its own CLI entry
  point), reads only its explicit local input manifest, and emits the versioned envelope from
  FR-022 — never something a separate host process discovers or imports on the caller's
  behalf. `@adrkit/core` and `@adrkit/cli` never import or otherwise learn that
  `packages/adapters/catalog-backstage` (or any adapter) exists, per ADR-0007's unaffected
  core dependency-isolation rule; they receive only an already-validated `CatalogSnapshot`-
  shaped artifact, which — per ADR-0012's requirement that any persisted `CatalogSnapshot`
  require a validated interchange file first — is derived from the FR-022 envelope only
  **after** that envelope independently passes every FR-034/FR-035 validation and digest
  check. An adapter's raw output MUST NOT be handed to core directly and unvalidated, under
  any composition arrangement. ADR-0013 amended ADR-0007's and ADR-0009's own clauses, and
  each of ADR-0007 and ADR-0009 now carries this amendment directly in its own body (a short
  blockquote added by the same PR, not merely a pointer in ADR-0013 alone — see the Normative
  Sources section above for the exact quoted text), while both records remain `proposed`
  pending their own separate future acceptance decision; this spec MUST NOT be read as
  asserting that ADR-0007/ADR-0009 have themselves reached `accepted` — both ADR-0013 and
  ADR-0007/ADR-0009's own frontmatter explicitly say they have not.
- **FR-022**: The spike MUST produce, from an actual run, one versioned snapshot envelope per
  single-repository generation pass (three total per User Story 6: community-plugins-derived,
  rhdh-plugins-derived, and primary synthetic — never one envelope purporting to span more
  than one repository), each containing at minimum: schema version, that pass's own
  repository ID/revision (from the FR-009 manifest), generator version, glob dialect
  identifier/version/options, a `capabilities` array whose only defined member for this spike
  is the exact string `"pathOwnership"` (mirroring FR-033's manifest-side
  `requiredCapabilities` field — this is the envelope's own declaration of which capability it
  actually provides, checked by a consumer against what it required), a `completeness` object
  with exactly two fixed boolean fields — `wholeCatalog` (always `false` for this spike: the
  envelope never claims to cover every entity in the repository's real catalog, only the ones
  the manifest listed) and `identityOnly` (`false` whenever Option A's owned-paths derivation
  was attempted for every entity in the envelope, **regardless of whether any entity actually
  ended up `explicit-paths`, `explicit-empty`, or `annotation-absent`** — an envelope where
  every single entity happens to be `annotation-absent` is still `identityOnly: false`,
  because derivation was genuinely attempted and found nothing, which is a valid, expected
  outcome per FR-008; `identityOnly` is `true` only for an envelope produced by Option D
  alone, where no owned-paths derivation was attempted for any entity at all) — source
  paths/digests, and a deterministic entity list in which **each entity's record carries an
  explicit ownership-state discriminator** (`explicit-paths`, `explicit-empty`, or
  `annotation-absent`, per FR-008) — never leaving that distinction recoverable only from
  prose elsewhere in the evidence bundle. These three envelopes are a required spike
  deliverable, not an optional or advisory recommendation, though each remains a new, separate
  artifact per FR-020 and none itself becomes part of any published schema.
- **FR-023**: The spike MUST measure and record, for both pinned corpora and its synthetic
  fixture set, using one frozen workload definition (a fixed candidate changed-file list, a
  fixed repetition count with at least one discarded warm-up iteration, and the measurement
  environment recorded alongside the numbers): total `adrkit.io/owned-paths` annotation bytes,
  entity count, patterns per entity, maximum pattern length, count of multi-document files,
  count of any ref aliases encountered, and a wall-clock compile/match cost reported as a
  specific aggregation statistic (e.g. median of the retained repetitions) — compiling each
  accepted glob exactly once per repetition, not once per match check. The spike MUST NOT
  propose a specific production scale limit from this evidence alone.
- **FR-024**: The spike MUST conclude with exactly one of three verdicts — `go-explicit`,
  `blocked`, `no-go` — defined with fixed, deterministic precedence in Success Criteria, with
  the evidence that drove the choice explicitly cross-referenced.
- **FR-025**: The spike's `go-explicit` verdict, if reached, MUST be explicitly and
  unambiguously distinguished from the hardened contract's separate "authoritative `go`"
  status. This spike CAN and MUST mechanically demonstrate malformed/tampered/stale/
  misidentified snapshot rejection and repository isolation using its own synthetic fixtures
  (FR-034–FR-038) — these are offline, generator/consumer-boundary properties requiring no
  adopter. What this spike explicitly CANNOT itself produce, and what remains exclusive to the
  authoritative `go` status, is an independent adopter's hand-labeled entity/path oracle and
  the zero-false-positive/negative precision guarantee over real, adopter-authored
  annotations that only that oracle can establish (User Story 3's synthetic precision
  measurement is a labeled proxy oracle, never a substitute for it).
- **FR-026**: Any "smallest later production slice" recommendation the spike records MUST be
  explicitly labeled informational and non-binding, MUST NOT authorize or schedule a
  `packages/adapters/catalog-backstage` implementation, and MUST explicitly leave the eventual
  production package's publish/release vehicle undecided.
- **FR-027**: Spike execution MUST NOT begin until both gates in this spec's banner clear:
  (a) `specs/007-arb-queue/tasks.md` T048/T049 (Phase 6 rung-6 external dogfood, SC-004),
  outstanding; (b) an independent adopter becoming available who has authored real
  `adrkit.io/owned-paths` annotations and a hand-labeled entity/path oracle against their own
  real catalog, outstanding. The catalog-governance precondition this spec previously tracked
  as a separate execution gate is **satisfied**, not outstanding:
  [ADR-0012](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md)
  (`status: accepted`, PR #26, merged at `54dbae8`) ratifies the hardened contract, and
  [ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
  (`status: accepted`, PR #27, merged at `48087e8`) discharges issue #25's requirement that
  ADR-0007/ADR-0009 be "accepted/amended or explicitly recorded as blocking before
  implementation" by taking the amended-and-explicitly-blocked branch — one of exactly two
  valid, complete resolutions that requirement named, not an unresolved ambiguity. ADR-0007
  and ADR-0009 remaining `proposed` with documented blockers is therefore this precondition's
  satisfied, final disposition; their own eventual acceptance is a separate matter this spec
  does NOT gate spike execution on — requiring it would be circular, since ADR-0013's own
  "Acceptance path for ADR-0007 and ADR-0009" lists this spike's evidence among the
  preconditions for *their* acceptance. Gate (b) requires that adopter and oracle to exist
  and be available for a later, separate authoritative-`go` determination (FR-025) — it does
  NOT require this spike itself to consume that adopter's data: this spike's own `go-explicit`
  verdict is deliberately computed only from the frozen public corpora (FR-001) and its own
  synthetic fixtures, for the same offline/reproducibility reasons FR-018 requires, and
  remains distinct from whatever the adopter's real oracle would separately show. Advance
  scoping (this document) is exempt from both remaining gates, per `plan.md`'s
  scoping-vs-implementation split, the maintainer's 2026-07-21 issue #25 ratifications of
  exactly this scoping activity, and ADR-0012's own action item 1 authorizing it.
- **FR-028**: The spike's output MUST NOT claim or take credit for ADR-0012's acceptance or
  for ADR-0013's resolution of ADR-0007/ADR-0009's status ambiguity, and MUST NOT assert that
  its own verdict caused or constitutes either. Both are present facts as of this writing
  (`54dbae8` PR #26; `48087e8` PR #27) that occurred entirely independently of this spike's
  own execution or verdict — the spike's output MAY accurately cite them, but MUST NOT frame
  either as something the spike itself achieved. ADR-0007/ADR-0009's own future *acceptance*
  (as distinct from ADR-0013's already-satisfied *status-ambiguity resolution*, which took the
  explicitly-blocked branch rather than acceptance) remains a separate, later matter: per
  ADR-0013, each requires its own separate, explicit, future accept/supersede decision that
  this spike does not perform, does not gate spike execution on (FR-027), and does not cause
  merely by executing. This spec's disclaimers report ADR-0012/ADR-0007/ADR-0009's actual,
  independently-verifiable status at whatever point execution actually begins; they do not
  require asserting a status that is no longer true, nor claiming a future status that has not
  yet occurred.
- **FR-029**: The spike's output MUST NOT claim or imply that its own verdict constitutes,
  causes, or substitutes for the independent-adopter gate (FR-027(b)) or the hardened
  contract's "authoritative `go`" status (FR-025), regardless of this spike's own verdict.
- **FR-030**: The spike's output MUST NOT claim or take credit for Phase 6
  (`specs/007-arb-queue/`) landing, and MUST NOT assert that its own verdict caused or
  constitutes that landing. This is distinct from, and MUST NOT be read as requiring the
  spike to falsely claim, that Phase 6 remains permanently unlanded — by the time execution
  gate (a) above clears, `specs/007-arb-queue/tasks.md` T049 will itself have updated
  `plan.md`'s Phase 6 row to `landed`, and this spec's disclaimers are written to remain true
  after that update, not to contradict it.
- **FR-031**: The hardened contract's "no exclusive winner" rule MUST be positively
  demonstrated, not merely assumed by the absence of a rejection rule: two entities with
  distinct canonical IDs whose `adrkit.io/owned-paths` values include an overlapping pattern
  MUST both derive successfully (this is never a duplicate-ID/duplicate-ref condition and MUST
  NOT trigger the FR-007 atomicity abort), and a changed file matching the overlapping pattern
  MUST be recorded as owned by every one of those entities simultaneously, mirroring
  ADR-0009's own union-not-winner `affects` semantics (User Story 1, Acceptance Scenario 8).
- **FR-032**: The catalog-governance precondition this spec previously modeled as a separate
  execution gate is **fully satisfied**, not partially: ADR-0012 reached `status: accepted` on
  2026-07-21 (PR #26, `54dbae8`), ratifying the hardened contract. Issue #25's hardening
  decision required ADR-0007/ADR-0009 to be "accepted/amended or explicitly recorded as
  blocking before implementation" — naming exactly two valid, complete resolutions, not one.
  [ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
  (`status: accepted`, PR #27, `48087e8`) took the second: it amends ADR-0007's and
  ADR-0009's narrowed clauses by reference and **deliberately** holds both `proposed`, with
  concrete, documented acceptance blockers. This is itself the discharge of that requirement,
  not a failure to discharge it — a deliberate, explicitly-documented decision to hold a
  record `proposed` with named blockers is not an unresolved ambiguity requiring further
  action before this spike may execute. ADR-0007's and ADR-0009's own **eventual acceptance**
  (moving each, independently, from `proposed` to `accepted` or superseding each) remains a
  separate, later, explicitly-scoped decision this spec does not perform and does NOT gate
  spike execution on: ADR-0013's own "Acceptance path for ADR-0007 and ADR-0009" lists this
  spike's own evidence among the preconditions for *that* future decision, so requiring
  ADR-0007/ADR-0009's acceptance before this spike's execution would be circular and is
  explicitly not required by FR-027. This spec's output MUST NOT imply ADR-0007/ADR-0009's
  documented blockers are cleared, MUST NOT imply either has reached `accepted`, and MUST NOT
  imply this spec or its eventual spike output causes or constitutes their eventual
  acceptance — but it also MUST NOT require their acceptance as a precondition of its own
  execution, since ADR-0012's and ADR-0013's acceptance together already fully discharge the
  catalog-governance precondition this spec's execution actually depends on.

### Out of Scope

The following are explicitly excluded from this spike and MUST NOT be introduced during its
future planning or execution:

- A production `packages/adapters/catalog-backstage` package of any kind.
- Any call to a live Backstage API, catalog backend, or discovery/ingestion processor.
- Any bearer token, API key, or other credential of any kind.
- Any catalog mutation, catalog/adrkit synchronization, or write-back of any kind.
- Following a `Location` entity's `spec.targets` to read a file outside the input manifest.
- Any change to `packages/core/src/affects/**`'s existing matcher semantics or to the
  `CatalogPort`/`CatalogSnapshot` type shapes.
- Any change to the ADR schema (`packages/core/src/schema/adr.schema.ts` or the published
  `schema/adr.schema.json`).
- A general runtime plugin loader of any kind.
- Treating descriptor-parent (B), repository-root (C), or identity-only (D) output as
  inferred, authoritative, or default entity-to-path ownership.
- Guessing or ratifying a specific production scale limit from this spike's evidence alone.
- Multi-repository or federated snapshots of any kind (single-repository only, per the
  hardened contract).
- Any npm publication, package version bump, or git release tag change for any `@adrkit/*`
  package, and any change to `.github/workflows/**`.
- Any claim, in this spec or its eventual evidence bundle, that this spike's own verdict
  constitutes or causes Phase 6 landing, a catalog-binding ADR's acceptance, ADR-0007/ADR-0009
  status resolution, or the hardened contract's "authoritative `go`" status.
- Drafting or amending the catalog-binding ADR (ADR-0012) or ADR-0007/ADR-0009's own status
  (ADR-0013) — that governance work is already complete on `main` (ADR-0012 and ADR-0013 are
  both `status: accepted`; ADR-0007 and ADR-0009 remain `proposed`)
  and is not something this spec performs or redoes; this spec only cites those records.
  ADR-0007/ADR-0009's own *eventual* acceptance or supersession (moving each from `proposed`)
  remains a separate, later, explicitly-scoped action this spec does not perform and does not
  gate on.

### Key Entities

- **Owned-Paths Annotation (Option A)**: The hardened `adrkit.io/owned-paths` value contract
  this spike measures as the sole candidate for authoritative default behavior — a JSON array
  of restricted-dialect, repo-relative POSIX picomatch globs, validated, canonicalized,
  sorted, and deduplicated per the Ratification Record, with whole-operation atomic failure
  on any invalid input.

- **Input Manifest**: The explicit, immutable, local description of exactly one repository
  (lowercase `github.com/<owner>/<repo>` ID, full-commit-SHA revision) and the exact
  descriptor file paths/digests generation is permitted to read. Repository identity comes
  only from this manifest, never from an inferred annotation.

- **Comparison Heuristic (Options B, C)**: Descriptor-parent and repository-root path
  guesses, measured only as separately labeled, non-authoritative modes for cardinality/
  collision/granularity findings on real corpora and precision/false-positive comparison
  against a spike-authored synthetic oracle — never default behavior, and never a substitute
  for an adopter-authored oracle.

- **Identity-Only Normalization (Option D)**: Canonical `kind:namespace/name` ref production
  with no path binding attached, measured to confirm it cannot by itself activate
  changed-file entity matching in adrkit's existing core code.

- **Versioned Snapshot Envelope**: The required, separate artifact this spike must produce
  from an actual run — schema version, repository ID/revision, generator version, glob
  dialect/version/options, capability/completeness flags, source paths/digests, and
  deterministic entities — distinct from, and never merged into, the existing
  `CatalogSnapshot`/`CatalogSnapshotEntity` types.

- **Frozen Research Inputs**: The three pinned commits (Backstage, `community-plugins`,
  `rhdh-plugins`) this spec cites by exact SHA and, for several claims, by exact file path and
  annotation value; re-verified, not reselected, immediately before spike execution (FR-001).

- **Evidence Bundle**: The complete, cross-referenced record the spike produces — Option A
  parsing/validation/atomicity results, the repository-boundary proof, the B/C
  cardinality-and-synthetic-precision measurements, the D no-effect confirmation, the
  structural-edge-case outcomes, the dotfile-policy confirmation, the per-pass determinism
  proof, the three populated envelopes, the scale evidence, and the
  malformed/tampered/stale/misidentified-envelope rejection proof plus the separate
  repository-isolation proof (an *acceptance*-and-correct-filtering property, not a rejection,
  for two independently-valid envelopes queried together). This is the spike's actual
  deliverable.

- **Verdict**: Exactly one of three enumerated outcomes recorded at the spike's conclusion —
  `go-explicit`, `blocked`, `no-go` — each precisely defined in Success Criteria and each
  driven by specific evidence-bundle contents, never asserted without that evidence. This is
  a judgment about Option A's own mechanical viability, distinct from — and does not itself
  satisfy — either of the two remaining execution gates in this spec's banner or the hardened
  contract's separate "authoritative `go`" status (Success Criteria SC-012, SC-013).

## Success Criteria

### Measurable Outcomes

- **SC-001**: Within each single-repository generation pass (per FR-009/User Story 6, never
  merged across passes), the same fixture input set, run through Option A's
  parsing/validation/canonicalization/sort/dedupe pipeline three or more times, produces
  byte-identical output every time for valid inputs; every invalid-pattern class named in
  FR-004, and every shape/parse-error class named in FR-003, is individually classified with a
  rule-specific reason.

- **SC-002**: Introducing exactly one invalid entity into an otherwise-valid batch (any rule
  from FR-003, FR-004, or FR-006) causes the entire snapshot-generation run to abort non-zero
  with no usable partial snapshot — not even for the otherwise-valid entities in the same run
  — in every tested case (User Story 2).

- **SC-003**: A repository-identity mismatch between the input manifest and the actual
  fixture/corpus provenance aborts generation before any entity's paths are derived, in every
  tested case; repository identity is never read from a descriptor annotation.

- **SC-004**: A valid non-empty `owned-paths` array, an explicit empty array, and a wholly
  absent annotation are recorded, respectively, as `explicit-paths`, `explicit-empty`, and
  `annotation-absent` in the evidence bundle and in the versioned snapshot envelope in every
  tested case; absent never infers ownership.

- **SC-005**: Options B and C are measured against both pinned real corpora and report only
  cardinality/collision/granularity findings there (User Story 3, Acceptance Scenarios 1–3,
  which together cover both `community-plugins` and `rhdh-plugins`); they are separately
  measured for precision/false-positive rate against a spike-authored synthetic oracle (User
  Story 3, Acceptance Scenario 5), explicitly labeled as such and explicitly insufficient to
  satisfy the Evidence Gate's authoritative-`go` requirement (SC-012).

- **SC-006**: Option D output is proven, via the unmodified core `matchEntityPattern`/
  `entitiesForPaths` code path, to produce a non-match with no `affects-unresolvable` finding
  attached, in a run that also contains a matching Option A entity for contrast (User Story
  4, Acceptance Scenario 2).

- **SC-007**: The real-corpus "stale project slug" evidence (FR-014) and the real-corpus
  "absent annotation is the overwhelmingly common case" evidence (FR-015, exact figures 23/156
  and 0/156) are both present in the bundle, each cited to its exact file path(s), exact
  descriptor counts, and pinned commit SHA — with the `rhdh-plugins` descriptor count recorded
  as exactly 38 (FR-016).

- **SC-008**: Direct execution of `picomatch` with the frozen options confirms the hardened
  contract's dotfile policy exactly as specified — a bare `**` does not match a dot-segment
  path, an explicit dot-segment pattern does — with the bundle stating plainly that this is
  `picomatch`'s existing native behavior, not a design choice this spike had to make or leave
  open (FR-017).

- **SC-009**: The multi-document synthetic fixture, the duplicate-YAML-key synthetic fixture,
  and the `Location`-not-followed synthetic fixture (FR-013) each produce a recorded,
  unambiguous outcome — accepted-with-paths, rejected-with-reason, or (for the `Location`
  case) zero-derived-paths-because-never-read — never a silent skip, and the bundle states
  plainly that all three are synthetic, not real-corpus finds.

- **SC-010**: The spike produces three populated versioned snapshot envelopes (FR-022) — one
  per single-repository generation pass (community-plugins-derived, rhdh-plugins-derived,
  primary synthetic) — each from an actual run, and one scale-evidence record (FR-023) with
  exact measured numbers per pass, aggregated in the evidence bundle — neither as a
  description of what would be produced, but as artifacts and a record actually generated by
  the spike.

- **SC-011**: Every derivation run performed by this spike is bracketed by an identical
  `git status --porcelain` capture immediately before and immediately after, with the
  network-denial mechanism used explicitly named, in every tested case (FR-018).

- **SC-012**: The spike concludes with exactly one of the following three verdicts, applied
  in the fixed precedence order below (evaluate `no-go` first; if it does not trigger,
  evaluate `go-explicit`; if that does not trigger either, the result is `blocked` by
  exhaustive fallback — every possible evidence outcome resolves to exactly one verdict, and
  no evidence pattern can satisfy more than one). **None of the three is, or is described as,
  the hardened contract's separate "authoritative `go`" status** — that status additionally
  requires the independent-adopter oracle named in FR-025 and is never reachable from this
  spike's own evidence alone.
  - **`no-go` (checked first; dominates all other results)** — any of the following was
    observed: a mutation of a tracked file outside scratch output occurred, any
    network/credentialed/live-API access occurred during a derivation run (FR-018/SC-011
    violated), whole-operation atomicity did not hold in some tested case (SC-002 failed),
    repository-mismatch abort did not hold (SC-003 failed), any invalid-pattern or
    invalid-shape class was silently accepted rather than rejected, any of the malformed/
    tampered/stale/misidentified-repository envelope checks failed to reject an envelope that
    should have been rejected, OR the repository-isolation check itself failed (i.e., a query
    scoped to one repository's ID returned an entity from another repository's envelope, or
    either of the two independently-valid envelopes in that isolation test was incorrectly
    rejected rather than accepted) (any part of SC-014 failed), or Option A's output could not
    be made byte-identical across repeated runs within a single-repository pass (SC-001
    failed). If any of these occurred, the verdict is `no-go` regardless of how well any other
    scenario performed. No production catalog adapter is recommended at this time; the
    underlying finding is recorded so a future re-attempt does not repeat the same failure
    blind.
  - **`go-explicit` (checked second)** — no `no-go` trigger fired, **and** every acceptance
    scenario in User Stories 1–7 passed exactly as specified: deterministic parsing,
    validation, and canonicalization; whole-operation atomic fail-closed behavior;
    repository-boundary enforcement; the `explicit-paths`/`explicit-empty`/`annotation-absent`
    distinction; B/C measured and correctly labeled at both the real-corpus
    (cardinality/collision) and synthetic (precision) levels; D's no-effect confirmed with the
    precise returned shape; all three required synthetic structural fixtures resolved
    unambiguously; the dotfile policy confirmed as already-correct `picomatch` behavior;
    per-pass determinism proven with the envelope and scale evidence both actually produced
    for each pass; and malformed/tampered/stale/misidentified-envelope rejection plus
    repository isolation mechanically demonstrated via digest verification and the other
    User Story 7 checks. An offline `packages/adapters/catalog-backstage` snapshot-generator
    scoped to Option A alone, reading only a local input manifest, is recommended for later,
    separate scoping —
    contingent on both of this spec's execution gates (FR-027) independently clearing,
    and explicitly distinct from the hardened contract's "authoritative `go`" (SC-013).
  - **`blocked` (exhaustive fallback)** — no `no-go` trigger fired, but the result falls short
    of full `go-explicit` in any way that is not itself unsafe. This covers, at minimum: the
    synthetic B/C precision comparison could not be completed; any of the three required
    synthetic structural fixtures (multi-document, duplicate-key, `Location`-not-followed)
    produced an ambiguous rather than a clean outcome; the envelope or scale-evidence record
    could not be fully populated from an actual run; or the default-namespace canonicalization
    case (User Story 1, Acceptance Scenario 4) could not be verified. The specific shortfall
    that prevented `go-explicit` is named explicitly, and no production recommendation is made
    beyond naming what would need to be resolved first.

- **SC-013**: Regardless of which of the three verdicts above is recorded, the spike's output
  explicitly states: (a) that this spike's own technical result does not itself satisfy,
  substitute for, or take credit for either remaining gate in this spec's banner (FR-027:
  Phase 6 T048/T049; and independent-adopter validation) — each of which, whenever it
  eventually clears, will have cleared through its own separate, prior action, not because of
  anything this spike's evidence bundle produced; that the catalog-governance precondition
  (ADR-0012's acceptance and ADR-0013's resolution of ADR-0007/ADR-0009's status ambiguity) is
  already satisfied and is not something this spike's own execution or verdict caused or
  constitutes; (b) that a `go-explicit` verdict is not, and does not substitute for, the
  hardened contract's separate "authoritative `go`" status; and (c) that the spike's verdict
  neither claims nor requires that Phase 6 remains permanently unlanded, nor that ADR-0007/
  ADR-0009's own eventual acceptance has occurred — only that this spike's own result does not
  cause, constitute, or take credit for whichever of those statuses has, by gate-clearing
  time, already separately changed (per the banner's gate-1 note, FR-028, and FR-030) — and
  explicitly does NOT imply that ADR-0012's or ADR-0013's already-accepted status, or any
  future ADR-0007/ADR-0009 acceptance, means ADR-0007/ADR-0009's own remaining blockers to
  their eventual acceptance are cleared, or that this spike's own execution is authorized on
  the strength of anything beyond the two gates FR-027 actually names.

- **SC-014**: Five distinct checks are demonstrated using only synthetic fixtures: (1) a
  consumer rejects a structurally malformed or unsupported envelope (missing/wrong-type
  field, unrecognized schema/dialect/capability version, missing source digest, or
  `completeness.identityOnly: true`) before any digest/revision/identity check — and
  separately accepts an otherwise-valid envelope with `completeness.identityOnly: false`
  whose entities merely all happen to be `annotation-absent` (FR-034); (2) a consumer
  independently recomputing an RFC-8785-canonicalized SHA-256 digest — computed over every
  security-relevant field including `schemaVersion`, not the entity list alone — rejects a
  tampered envelope, non-zero, with the bundle explicitly noting this proves
  accidental-corruption/naive-mutation detection, not adversarial cryptographic
  tamper-resistance, which remains an explicitly open question this spike does not attempt
  (FR-035); (3) a consumer configured with an expected-current repository revision rejects an
  envelope declaring any other revision for the same repository ID as stale (exact
  inequality, not chronological comparison), non-zero (FR-036); (4) a consumer configured with
  one expected repository ID rejects an envelope declaring a different repository ID,
  non-zero (FR-037); and (5) a tool legitimately querying across two independently-generated,
  individually-valid single-repository envelopes (never a merged or federated snapshot, and
  neither envelope rejected) never returns an entity originating from the non-queried
  repository (FR-038) — with the bundle explicitly stating this is a mechanical, offline
  generator/consumer-boundary proof, not a substitute for the adopter-oracle-dependent
  portion of the Evidence Gate's "authoritative `go`" requirement.

## Output Recommendation (Informational, Non-Binding)

*This section exists so the spike's eventual output has a place to record a recommendation —
it is deliberately unwritten until the spike executes. If the verdict is `go-explicit`, the
evidence bundle's report MUST append, here or in a linked follow-up document (subject to
FR-019's scratch-only constraint on the spike's own execution — any tracked update happens
through its own later, separately-authorized PR, not as a side effect of this spike), a short
"smallest later production slice" recommendation identifying the minimal viable production
scope (e.g., an offline generator that reads a vendored or locally-cloned catalog checkout via
one explicit local input manifest, derives `CatalogSnapshotEntity.paths` from
`adrkit.io/owned-paths` alone, enforces whole-operation atomicity and single-repository
binding, and writes **only** the versioned envelope — never a `CatalogSnapshot`-shaped
artifact directly; per FR-021, a `CatalogSnapshot`-shaped artifact is derived from the
envelope only after it independently passes every FR-034/FR-035 validation and digest check,
with no B/C/D behavior carried into production). That recommendation MUST be clearly labeled
non-binding per FR-026, MUST explicitly leave the eventual production package's publish/
release vehicle undecided, MUST explicitly distinguish itself from the hardened contract's
"authoritative `go`" per FR-025, and MUST NOT itself schedule, authorize, or scope a
`packages/adapters/catalog-backstage` implementation — that remains a separate, later,
explicitly-scoped feature contingent on FR-027's two remaining gates clearing.*

## Assumptions

- **A1**: This spike's immutable research inputs are exactly the three commits named in
  FR-001. At this spec's writing (2026-07-21), all three were confirmed reachable via the
  GitHub API at their exact SHAs, and this confirmation was independently repeated by a
  second, adversarial fresh-context review that also fetched raw file content directly.
  Immediately before spike execution, FR-001 requires re-verifying that each commit is still
  reachable at that exact SHA — a re-verification of these fixed targets, never a reselection
  of "whatever a branch's HEAD is now." If any of the three no longer resolves as expected,
  the spike MUST fail closed and require spec re-ratification rather than substitute a
  different commit.

- **A2**: For this spec's own drafting, `backstage/community-plugins` was sampled via a
  recursive git-tree fetch at the pinned commit (15,150 tree entries; 156 files with the exact
  basename `catalog-info.yaml`/`catalog-info.yml`, zero at the repository root), and
  `redhat-developer/rhdh-plugins` likewise (8,364 tree entries; 38 files with the exact
  basename `catalog-info.yaml`/`catalog-info.yml` — not 39; a naive path-suffix search
  over-counts by one due to `workspaces/bulk-import/examples/template/
  create-pr-with-catalog-info.yaml`, whose filename ends in the string "catalog-info.yaml"
  without being one). A full-content scan of all 156 `community-plugins` descriptors (not
  merely a handful sampled by content) found 23 with any `metadata.annotations` block and 0
  with `adrkit.io/owned-paths`; this full-scan figure, not an earlier partial-sample estimate,
  is the one this spec cites throughout (FR-015). This is still a sampling of both corpora's
  file listing and annotation content at one point in time, not a claim about every
  descriptor's complete semantic content beyond what this spec cites by exact path and value.
  Spike execution, once authorized, MUST independently re-fetch and re-verify every citation
  this spec makes rather than trust this spec's transcription of them.

- **A3**: Multi-document, duplicate-YAML-key, and `Location`-entity fixtures (User Story 5,
  FR-013) are synthetic because neither pinned corpus, as sampled per A2, was found to contain
  a multi-document descriptor or a `Location` entity (duplicate-YAML-key descriptors were not
  separately searched for, since a well-formed public corpus is unlikely to contain one; the
  spike should not assume this remains true without checking at execution time). The required
  synthetic fixtures (FR-013) MUST always be exercised regardless of what execution-time
  re-checking finds — FR-013's synthetic-fixture requirement is not conditional. If spike
  execution later discovers a real example of either structural pattern in either corpus, that
  real example is exercised in **addition to**, never instead of, the required synthetic
  fixture, and the evidence bundle MUST record both results separately and which situation
  applied.

- **A4**: Synthetic fixture entity IDs and repository identities use throwaway namespace/kind/
  repository combinations (e.g. `component:adrkit-spike/*` entities, a
  `github.com/mbeacom/adrkit-spike-fixture` manifest repository ID) distinct from any real
  adrkit or Backstage default namespace and distinct from this repository's own real identity
  (`github.com/mbeacom/adrkit`), so a fixture entity or fixture repository can never be
  mistaken for a real catalog entity or this real repository in any evidence output. For the
  FR-009/User Story 2 repository-mismatch tests specifically, the standalone scratch git
  repository described in Assumption A7 (not the general scratch worktree used for the rest of
  spike execution) is configured with a matching or deliberately mismatching `origin` remote
  as each test case requires — the check is always against that standalone repository's real,
  separately-queried `git remote`/`HEAD`, never against a value asserted only in the manifest
  itself.

- **A5**: "Independent adopter" (execution gate 2, FR-027(b), and the hardened contract's
  Evidence Gate underlying FR-025) means an adopter other than the maintainer authoring real
  `adrkit.io/owned-paths` annotations against their own live or real catalog and providing a
  hand-labeled entity/path oracle. The two pinned public Backstage-ecosystem corpora sampled
  for this spike's research grounding and B/C measurement are read-only research inputs, not
  that adopter — neither carries any `adrkit.io/owned-paths` annotation at all (per A2), so
  sampling them cannot, even in principle, provide the oracle this gate requires.

- **A6**: The catalog-binding ADR is
  [ADR-0012](../../docs/adr/0012-bind-catalog-entities-to-owned-paths-with-an-explicit-annotation.md),
  which has already been drafted, ratified, and reached `status: accepted` (PR #26, merged at
  `54dbae8`) — this spike cites ADR-0012 as the contract's normative source throughout, in
  place of quoting the issue #25 comments directly. ADR-0007/ADR-0009's own `status: proposed`
  disposition has likewise already been resolved, not merely examined:
  [ADR-0013](../../docs/adr/0013-reconcile-adapter-isolation-and-catalog-binding-with-the-offline-snapshot-genera.md)
  (also `status: accepted`, PR #27) amends their narrowed clauses by reference and takes the
  "explicitly blocked" branch issue #25's hardening decision named as one of exactly two valid
  resolutions — a documented, satisfied disposition, not an open ambiguity. The catalog-
  governance precondition this spec once modeled as a gate is therefore fully satisfied by
  ADR-0012 and ADR-0013 together, and this spec's execution gates (FR-027) name only Phase 6
  and the independent adopter. ADR-0007/ADR-0009's own **eventual acceptance** (moving each
  from `proposed` to `accepted`, or superseding each) remains a separate, later action neither
  this spec nor ADR-0012/ADR-0013 performs, and this spec does not gate its own execution on
  it — doing so would be circular, since ADR-0013's own acceptance path for ADR-0007/ADR-0009
  lists this spike's evidence among its preconditions.

- **A7**: This spike's execution — once every remaining gate clears — occurs entirely on a
  disposable scratch branch/worktree and/or a scratch working directory kept outside the
  committed `specs/` tree. No scratch fixture, corpus cache, evidence file, or envelope
  artifact produced by this spike's execution may be committed to `main` or merged into this
  repository's tracked history as a side effect of running the spike (FR-019). This general
  scratch worktree/branch is distinct from the standalone scratch git repository User Story 2
  additionally requires specifically for the FR-009 repository-mismatch tests — a fresh
  `git init`'d directory with its own independently-configured `origin` remote and commits,
  never a `git worktree add` linked worktree of this actual repository, since a linked
  worktree shares its remote configuration with the repository it was created from and so
  cannot be independently varied to test a mismatch.

- **A8**: `picomatch` v4 — already a `packages/core` dependency (`package.json`) and the
  engine the existing `path` and `entity`/inert matchers already use — is the assumed
  glob-validation engine for Option A's pattern rejection rules, frozen specifically at
  `picomatch 4.0.5` with options `dot:false`, `nocase:false`, `nonegate:true` per the hardened
  contract. The spike does not introduce a new glob-matching dependency, and confirmed by
  direct execution (User Story 5, Acceptance Scenario 4) that this exact engine/options
  combination already implements the hardened dotfile policy with no code change to either
  existing core matcher.

- **A9**: Implementation of this spike (the actual execution described in User Stories 1–7)
  requires every remaining gate in this spec's banner to clear. **As of 2026-07-21, the
  scoping-ratification component is satisfied** (adrkit issue #25, both dated decisions; see
  the Ratification Record), **and the catalog-governance precondition is now fully satisfied**
  (ADR-0012, `status: accepted`, PR #26, merged at `54dbae8`, providing the contract; and
  ADR-0013, `status: accepted`, PR #27, merged at `48087e8`, resolving ADR-0007/ADR-0009's
  status ambiguity via the "explicitly blocked" branch — one of exactly two resolutions issue
  #25 named as sufficient). **Only Phase 6 T048/T049 (gate 1) and independent-adopter
  validation (gate 2) remain unsatisfied.** ADR-0007/ADR-0009's own eventual acceptance
  (moving from `proposed` to `accepted`, or supersession) is a separate, later, non-gating
  decision — this spec does not require it, since ADR-0013's own acceptance path for
  ADR-0007/ADR-0009 lists this spike's evidence as one of its preconditions, and gating this
  spike's execution on it would be circular. This spec's own creation and refinement — the
  advance-scoping activity itself — is, and always was, exempt from every gate, per
  `plan.md`'s advance-scoping-vs-implementation split.

- **A10**: This spike does not add, and its fixtures must not be mistaken for, a fifth MCP
  tool, a write MCP tool, an evaluator rubric pass, or any HTTP service. It is a catalog
  entity-to-path binding comparison and nothing else; any future integration between adrkit's
  MCP server or evaluator and a catalog adapter is a separate, later, explicitly-scoped
  feature.

- **A11**: Where this spec's requirements, success criteria, or edge cases would only have
  been true under the initial, softer 2026-07-21T21:30:41Z ratification and not under the
  10-minutes-later hardening decision, this spec follows the hardened version throughout —
  the initial decision's contract bullets are preserved verbatim in the Ratification Record
  purely for provenance (this spec quotes the contract bullets from both dated issue #25
  comments, not the complete text of either comment, e.g. omitting each comment's closing
  authorization-scope sentence, which this spec restates separately in its own words), not as
  an alternative this spec's requirements may satisfy instead of the hardened one. ADR-0012
  now ratifies the hardened version as `status: accepted` project law; this spec's
  requirements cite ADR-0012 as the operative source going forward, while the issue #25 quotes
  remain in place as the historical record ADR-0012 itself was ratified from.
