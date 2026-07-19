# Quickstart: Deterministic Evaluator (Pass 0) — Phase 4

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) |
**Contract**: [contracts/pass-0-evaluation.md](./contracts/pass-0-evaluation.md) |
**Date**: 2026-07-19

> # ⛔ IMPLEMENTATION IS BLOCKED — this is a design preview, not a runnable command
>
> Unlike feature 004 (whose gate had cleared before its quickstart), **feature 005's
> implementation gate is NOT cleared.** `specs/004-ci-surface/tasks.md` **T018 is unchecked**:
> the CI surface has not yet been proven on a **second repository** with **> 10 records**, a
> **selective** comment, a **same-comment idempotent update**, and the **default `GITHUB_TOKEN`
> only**. Per the outcome ladder (SC-013; [research §R0](./research.md)), **no `@adrkit/evaluator`
> code, no `adr evaluate` subcommand, and none of the commands below may be built or run until
> T018 is checked off with that evidence.** A merged PR is not a satisfied rung.
>
> Everything below shows **what the offline, model-free flow will look like once the gate
> clears** so the design is review-ready now. The commands are **illustrative**.

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

## The offline flow (illustrative — blocked by T018)

Everything runs from a **clean clone**, **air-gapped**, with **no model configured** (US3).

```bash
# 0) Pinned stable Bun (the env default canary writes an unreadable v2 lockfile). Illustrative.
bun --version            # expect 1.3.14
bun install --frozen-lockfile
bun run build

# 1) Evaluate a proposal against an OFFLINE snapshot bundle + a required date.
#    <bundle.json> supplies target inventories, resolved assertion sources/inputs,
#    the identity directory, and any scope / routing evidence — all immutable.
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
contains exactly eight ordered trigger-evidence statuses in the full output.

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
  bytes (metadata excluded) — canonical key/array ordering holds (FR-005; [research §R11](./research.md)).
- **`evaluationPatch` validates against the CURRENT committed schema** — violations only, using
  existing `EscalationReason` values, **no schema change** (`schema:emit` byte-clean; Principle V; C6).
- **Purity holds**: no clock/network/fs read in the evaluator path; **inputs are not mutated**;
  the dependency-graph gate shows `@adrkit/evaluator` importing **only** `@adrkit/core` + vetted
  deterministic libs, **no** adapter/model/toolkit dep (Principle II/III/IV; FR-006).
- **Model-free**: every fixture runs with **no model configured** and is fully useful — the
  load-bearing ADR-0005 property (US3; SC-006).
- **Routing is honest**: escalation is an OR over **proven** triggers (existing enum only);
  missing evidence is **not proven** (recorded); a team that can't resolve to one active human is
  **`unresolved`**, never an arbitrary pick (C4/C7; [research §R10](./research.md)).
- **The bundle boundary is explicit**: `adrkit.pass0.snapshot/v1` is strict JSON data;
  malformed present data exits 2, omitted optional backing degrades to inert, and JSON cannot
  select/import an engine or resolver port. Any T002-approved compiled artifact uses only the
  fixed media-type/base64/hash/source-ref DTO.
- **Exit codes**: malformed usage/bundle ⇒ **2**; any rubric `error` ⇒ **1**; warn/info/inert-only
  ⇒ **0** even when it escalates or routes `unresolved` (FR-013/C10).

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
- **No chosen Rego/JSONPath engine yet** — the engine technology is a **gated pre-implementation
  decision** ([research §R1](./research.md)): a vetted deterministic in-process library **or** a
  caller-supplied compiled-policy snapshot, never `opa-wasm` raw-compile and never a shell-out.

---

## Gate reminder (again, because it is the point)

**Do not build or run any of the above until `specs/004-ci-surface/tasks.md` T018 is checked off
with second-repo / >10-record / selective-comment / same-comment-update / default-token-only
evidence.** Scoping (this plan, research, data-model, contract, and `tasks.md`)
is the only work authorized now. See [plan.md](./plan.md) and [research §R0](./research.md).
