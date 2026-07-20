# Pass 0 evaluator test fixtures — provenance & rules

All fixtures under `packages/evaluator/test/fixtures/` are **offline and model-free**. They
exist to exercise the deterministic Pass 0 contract
([`contracts/pass-0-evaluation.md`](../../../../specs/005-deterministic-evaluator/contracts/pass-0-evaluation.md))
with zero external dependencies.

## Hard bans (every fixture, every test)

A fixture or its test **must never**:

- reach the **network** or use any **credential**/token;
- call a **model**, prompt, embedding, or retrieval service;
- read a **clock** (`Date.now`, `new Date()` without an explicit argument, timers) — the
  evaluation date is always the caller-supplied `--date` / `evaluationDate`;
- select, import, or execute a **module/port** named in JSON — registries and engine ports are
  built only by trusted composition code;
- trigger an **evaluator-side filesystem read**. The pure `@adrkit/evaluator` reads nothing; the
  CLI boundary resolves files into immutable snapshots before the evaluator runs. In particular
  the evaluator never reads `Assertion.expressionFile` — the caller resolves it into
  `assertionInputs.sources`.

Missing backing is **inert**, never a fabricated pass/fail (ADR-0009; FR-007).

## Snapshot bundle layout (`adrkit.pass0.snapshot/v1`)

Bundle JSON is strict `SnapshotBundleJsonV1`
([data-model §2.1](../../../../specs/005-deterministic-evaluator/data-model.md)) with exact
`schemaVersion: "adrkit.pass0.snapshot/v1"`. Unknown or duplicate keys, wrong field types,
malformed canonical keys, and non-JSON values are **exit 2** malformed-bundle errors. Omitted
optional backing is valid and normalizes to an unavailable/empty runtime container so the
affected rule reports **inert**.

Key fields:

- `log?` — the **current target-resolution log** (ADR-0009 repo/log identity). This is target
  context, **not** an ADR record's source `log`. It is passed explicitly to every target
  resolver; the evaluator never infers it from `record.log`.
- `federatedLogs?` — optional cross-log ADR-id snapshots for `no-orphan-refs`. A required
  federated ref with no snapshot is **inert** (`no-orphan-refs.federated-log-absent`), not an
  orphan failure.
- `targets?` — per-type immutable inventories (`trackedPaths`, `dependencies`, `entities`,
  `resources`, `apis`, `data`). A missing inventory for a type makes its matchers inert.
- `assertionInputs?.sources` — resolved assertion source per **assertion key**: inline
  `fileContent` + `sourceRef`, or a Rego `compiledArtifact` envelope. Keyed exactly as below.
- `assertionInputs?.inputs` — the **current/proposed** evaluation input document per assertion
  key (for `assertions-pass` and the accepted-ADR checks).
- `scopeEvidence?.baseInputs` — the **base** assertion input document per assertion key, kept
  **separate** from the current/proposed `assertionInputs.inputs`; `scope-hierarchy` only fires
  on a base-green → proposed-red transition it computes itself.
- `identity?` — normalized principals/teams/CODEOWNERS/catalog owners for `decider-resolvable`
  and named-human routing.
- `routingEvidence?` — normalized, per-trigger routing evidence; a missing trigger is
  "not-proven", never a fabricated escalation.

## Canonical assertion keys

An assertion input/source key is the **compact** standard string

```txt
JSON.stringify([record.log ?? "", record.path, assertion.id])
```

with **no** added whitespace, e.g. `["","docs/adr/0042-x.md","no-secrets"]`. Whitespace-padded
or otherwise noncanonical spellings are **rejected**, never normalized. Using `record.path`
(not the ADR id) keeps keys distinct when `id-unique` fails but evaluation continues.

## Approved engine profiles

- **JSONPath** — exact `jsonpath-rfc9535@1.3.0`, restricted RFC 9535 source profile (root,
  child, wildcard, index, slice, descendant, filter, comparison, logical, existence selectors
  and only `length()`/`count()`/`value()`). A result passes iff its nodelist is non-empty
  (selecting `false` passes). Fixtures supply `expression` (inline) or resolved `fileContent`.
- **Rego** — no default engine. Fixtures may carry the fixed
  `application/vnd.adrkit.rego-wasm-policy.v1+json` `compiledArtifact` envelope as **data
  only**; with no registered port the assertion is `engine-absent` inert. adrkit never executes
  untrusted Wasm and never shells out.
- **grep / custom** — inert unless a deterministic port is registered by composition code.

## Directory conventions

Rule fixtures live under `fixtures/<rule-or-topic>/` (e.g. `schema-valid/`, `id-unique/`,
`affects/`, `assertions/`, `routing/`). Proposal ADR files are valid MADR-style records unless a
fixture is deliberately malformed to exercise `schema-valid`. Expected canonical outputs are
stored as `expected.json` (LF-terminated, canonical bytes) beside their test.
