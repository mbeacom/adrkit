# Quickstart: Deterministic Evaluator (Pass 0) — Phase 4

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) |
**Contract**: [contracts/pass-0-evaluation.md](./contracts/pass-0-evaluation.md) |
**Date**: 2026-07-19

> # ✅ IMPLEMENTATION COMPLETE 2026-07-19
>
> Feature 004 T018 is complete with linked public second-repository evidence, and
> feature 005 T002 records the restricted JSONPath source profile plus inert-by-default
> Rego artifact boundary. The deterministic Pass 0 evaluator (`@adrkit/evaluator`) and
> the `adr evaluate` CLI are implemented; the commands below are runnable now.

---

## What Pass 0 is

The **deterministic, model-free first pass** of the four-pass evaluator (ADR-0005). It applies
**exactly eleven rubric rules** (`docs/EVALUATOR_RUBRIC.md`) to a proposal ADR plus
**caller-supplied immutable snapshots**, and **returns two artifacts** — a rich runtime
`Pass0Report` and a schema-compatible `evaluationPatch`. It **routes; it never approves,
accepts, merges, or persists anything** (Principle I/IV). It reads **no** model, **no** network,
**no** clock, and **no** filesystem. The CLI boundary performs the explicit corpus and bundle
reads before calling the pure evaluator.

---

## The offline flow

Everything runs from a **clean clone**, **air-gapped**, with **no model configured** (US3).

```bash
# 0) Pinned stable Bun (the env default canary writes an unreadable v2 lockfile). Illustrative.
bun --version            # expect 1.3.14
bun install --frozen-lockfile
bun run build

# 1) Evaluate a proposal against an OFFLINE snapshot bundle + a required date.
#    <bundle.json> supplies the optional current target-resolution log, target inventories,
#    resolved assertion sources/inputs, identity, and scope/routing evidence — all immutable.
bun run adr evaluate packages/evaluator/test/fixtures/proposal-0042.md \
  --snapshot packages/evaluator/test/fixtures/snapshot.clean.json \
  --date 2026-07-19 \
  --json
```

The command **prints** the `Pass0Report` + `evaluationPatch` (canonical JSON with `--json`) and
**writes nothing** — there is **no `--write` flag** (Principle I; FR-014).

### A clean (`outcome: ok`) result, abbreviated

```jsonc
{
  "result": {
    "report": {
      "rubricVersion": "…",
      "proposalPath": "…/proposal-0042.md",
      "results": [
        { "rule": "schema-valid",            "status": "pass",  "reason": "schema-valid.ok" },
        { "rule": "id-unique",               "status": "pass",  "reason": "id-unique.ok" },
        { "rule": "supersession-consistent", "status": "pass",  "reason": "supersession-consistent.ok" },
        { "rule": "no-orphan-refs",          "status": "pass",  "reason": "no-orphan-refs.ok" },
        { "rule": "affects-resolvable",      "status": "pass",  "reason": "affects-resolvable.ok" },
        { "rule": "affects-overlap",         "status": "pass",  "reason": "affects-overlap.none" },
        { "rule": "scope-hierarchy",         "status": "pass",  "reason": "scope-hierarchy.ok" },
        { "rule": "assertions-compile",      "status": "pass",  "reason": "assertions-compile.ok" },
        { "rule": "assertions-pass",         "status": "pass",  "reason": "assertions-pass.ok" },
        { "rule": "decider-resolvable",      "status": "pass",  "reason": "decider-resolvable.ok" },
        { "rule": "expiry-sane",             "status": "pass",  "reason": "expiry-sane.ok" }
      ],
      "routing": {
        "escalate": false,
        "reasons": [],
        "evidenceStatus": [
          { "reason": "one-way-door", "status": "not-proven", "code": "route.evidence.one-way-door.not-proven" }
          // … exactly one status for each of the eight Pass 0 triggers, in contract order
        ],
        "target": { "kind": "not-required", "code": "route.target.not-required" }
      },
      "outcome": "ok"
    },
    "patch": { "deterministicFindings": [], "escalate": false, "escalationReasons": [] }
  },
  "metadata": { "evaluatorVersion": "…", "ranAt": "…", "runId": "…" }
}
```

Note **exactly eleven** `results`, always in the fixed rubric order (C11); `routing` follows the
eleven (it is **not** a twelfth rule); and `metadata` sits **outside** the deterministic payload
so `report` + `patch` reproduce **byte-for-byte** (FR-005). The abbreviated routing block
contains exactly eight ordered trigger-evidence statuses in the full output. This example
assumes accepted ADRs exist and none intersects, hence `affects-overlap.none`; an empty
accepted corpus uses `affects-overlap.no-accepted-corpus`.

### An inert (degraded, still useful) result

Hand it a bundle that omits, say, the `resource` inventory while the proposal names an
assertion engine for which the composition boundary has no registered port:

```jsonc
{ "rule": "affects-resolvable", "status": "inert", "reason": "affects-resolvable.backing-absent" }
{ "rule": "assertions-compile", "status": "inert", "reason": "assertions-compile.engine-absent" }
```

Missing backing is **inert — never a violation** (ADR-0009; FR-007). The proposal can still be
`outcome: ok`.

---

## What "green" means

A fixture/run is **green** when the observed behavior matches the contract deterministically:

- **Exactly eleven** `RuleResult`s, in fixed rubric order, **one aggregate result per rule**
  (C11) — for every fixture (SC mapping to FR-002/FR-010).
- **`schema-valid` fail short-circuits** to `schema-valid` fail **+ ten `not-evaluated`**; a
  schema-invalid report still carries eight `not-proven` routing statuses, no escalation,
  and target `not-required`; a post-`assertions-compile` failure makes **only**
  `assertions-pass` `not-evaluated` (C11).
- **Byte-for-byte reproduction**: two runs of the same input produce identical `report` + `patch`
  bytes (metadata excluded) — object keys and set-like collections canonicalize, while fixed
  rubric/trigger and declaration-ordered matcher/assertion/owner arrays preserve their
  semantic order (FR-005; [research §R11](./research.md)).
- **Log-scoped identity and ADR-0009 matching hold**: duplicate ids fail only within one
  normalized record-source log; the same id across named source logs passes. Positive+negated,
  negation-only, same-`repo`, and different-`repo` affects fixtures use the bundle's explicit
  current target-resolution `log`, which is not inferred from a record's source log.
- **`evaluationPatch` validates against the CURRENT committed schema** — violations only, using
  existing `EscalationReason` values, **no schema change** (`schema:emit` byte-clean; Principle V; C6).
- **Purity holds**: no clock/network/fs read in the evaluator path; **inputs are not mutated**;
  the dependency-graph gate shows `@adrkit/evaluator` importing **only** `@adrkit/core` + vetted
  deterministic libs, **no** adapter/model/toolkit dep (Principle II/III/IV; FR-006).
- **Model-free**: every fixture runs with **no model configured** and is fully useful — the
  load-bearing ADR-0005 property (US3; SC-006).
- **Routing is honest**: escalation is an OR over **proven** triggers (existing enum only);
  missing evidence is **not proven** (recorded). Deciders preserve declaration order;
  canonical-sorted paths use the last matching CODEOWNERS rule and its owner order; canonical
  entities preserve catalog-owner order. The first team candidate that does not resolve to
  exactly one active human is an immediate **`unresolved`** barrier — fallback does not bypass
  it (C4/C7; [research §R10](./research.md)).
- **The bundle boundary is explicit**: `adrkit.pass0.snapshot/v1` is strict JSON data;
  malformed present data exits 2, omitted optional backing degrades to inert, and JSON cannot
  select/import an engine or resolver port. Any T002-approved compiled artifact uses only the
  fixed media-type/base64/hash/source-ref DTO. Assertion keys must be byte-equal to compact
  `JSON.stringify([record.log ?? "", record.path, assertion.id])`; whitespace variants are
  rejected.
- **Assertion payload handoff is direct**: one compile/artifact-validation produces an
  engine-owned opaque immutable payload that is passed to the same typed port's evaluate
  method — no hidden mutable registry, recompile, or unsafe cast.
- **Exit codes**: malformed usage/bundle ⇒ **2**; any rubric `error` ⇒ **1**; warn/info/inert-only
  ⇒ **0** even when it escalates or routes `unresolved`. Selecting a schema-valid
  `accepted`/`rejected`/`superseded`/`deprecated` record is
  `candidate-status-not-proposal`, emits no report/patch, and exits **2** (FR-013/C10).

Green does **not** mean "approved." Pass 0 **routes**; acceptance is a human decision recorded in
git later (Principle I; ADR-0004).

---

## What is explicitly NOT here

- **No later pass** (rubric scoring, adversarial, decision) — Pass 0 only (FR-011).
- **No model / prompt / embedding / retrieval / adapter / network / clock / fs** in the library
  (FR-001/FR-006).
- **No `--write`, no persistence, no acceptance/merge/mutation** — the `evaluationPatch` is
  returned for a **later caller PR** (FR-014; Principle I).
- **No schema change** — the two contract limitations (finding evidence fields; one expression
  source) are **gated decisions** handled off-schema ([research §R8](./research.md); Principle V; C6).
- **Restricted JSONPath + inert-by-default Rego** — exact
  `jsonpath-rfc9535@1.3.0` evaluates the restricted RFC 9535 source profile. Rego
  accepts only the fixed validated caller artifact envelope through a trusted typed
  port; adrkit has no built-in Rego runtime, does not depend on opa-wasm, never claims
  raw Rego compilation, and never shells out.

---

## Gate evidence

The completed gate evidence is linked from tasks T001 and
[research §R0](./research.md): a public 12-ADR second repo, selective two-ADR
comment, same-comment update, and default-token-only runs.

---

## Final verification evidence (T058)

Recorded 2026-07-19 with **stable Bun 1.3.14** (`bunx bun@1.3.14`) from a clean tree.
The default canary Bun (1.4.0) was never used to write `bun.lock`; the lockfile stays
`lockfileVersion: 1`.

| Gate | Command | Result |
|---|---|---|
| Frozen clean-clone install | `bunx bun@1.3.14 install --frozen-lockfile` | ✅ no changes; lockfile v1 preserved |
| Typecheck | `bunx bun@1.3.14 run typecheck` | ✅ pass |
| All offline tests (incl. the 11-rule pass/fail/inert matrix, purity, canonical bytes) | `bunx bun@1.3.14 test` | ✅ **363 passed, 0 failed** across 54 files |
| Build (core, evaluator, cli, ci) | `bunx bun@1.3.14 run build` | ✅ all exited 0 |
| Lint | `bunx bun@1.3.14 run lint` | ✅ pass |
| Dependency boundaries (evaluator allow-list + one-way graph) | `bunx bun@1.3.14 run check:deps` | ✅ `core-has-no-adapter-deps: ok` |
| Node 22/24 smoke (built artifacts + offline `adr evaluate`) | `node scripts/smoke-node.mjs`; `bunx nve 24 node scripts/smoke-node.mjs` | ✅ pass on Node 22.22.2 and 24.18.0 |
| Canonical-byte repetition | reordered input collections | ✅ identical `report` + `patch` bytes |
| Input immutability | deep-frozen input | ✅ evaluates without mutation |
| No-model / no-I/O proof | clock/network/random traps | ✅ never tripped |
| Schema emit byte-clean | `bunx bun@1.3.14 run schema:emit && git diff --exit-code schema/adr.schema.json` | ✅ no diff (no schema change) |
| Working tree whitespace | `git diff --check` | ✅ clean |

The `adr evaluate` invocation used above runs fully offline against the committed
fixtures `packages/evaluator/test/fixtures/proposal-0042.md` and
`packages/evaluator/test/fixtures/snapshot.clean.json`, printing the eleven-rule
`Pass0Report` + `evaluationPatch` and writing nothing (there is no `--write`).
