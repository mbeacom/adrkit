# Spec Kit extension — rung-2 reference-verification evidence index

**Purpose**: The tracked, sanitized evidence index that satisfies the ADR-0014
**rung-2** gate for `@adrkit/spec-kit` — maintainer-owned isolated
reference-repository validation. It mirrors the discipline
[`specs/007-arb-queue/checklists/reference-verification-evidence.md`](../specs/007-arb-queue/checklists/reference-verification-evidence.md)
established for Phase 6: immutable refs, run links, content hashes, tool
versions, expected-vs-observed rows, limitations, and a reviewer verdict.

This is **rung-2 reference verification, not rung-3 external / community
validation**. The reference repository is maintainer-owned and isolated — not an
external team, not a third-party adopter.

Extension maturity per the [ADR-0014](../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
vocabulary: **implemented → reference-verified → landed**. It is **not**
`released` at the time of writing and **not** `externally validated`.

**Created**: 2026-08-02
**Decision**: [ADR-0019](../docs/adr/0019-ship-the-spec-kit-extension-treating-the-spike-no-go-as-a-measurement-artifact.md)
**Reviewer verdict**: PASS. All four rung-2 criteria — reproducible,
self-verifying, fail-closed, reviewed — are met by the artifacts below.

## Reference repository (maintainer-owned, isolated)

[`mbeacom/adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood) —
a separate, public repository the maintainer owns and operates, already used for
the Phase 6 rung-2 evidence. It is **not** this monorepo.

| Change | Immutable SHA |
|---|---|
| PR [#9](https://github.com/mbeacom/adrkit-t018-dogfood/pull/9) — add rung-2 reference validation for the Spec Kit extension | merge `b559d32c48b0098510e0dae8d4fb994afd6f8053` |

## Tool versions / environment

| Component | Version / ref |
|---|---|
| adrkit under test (pinned, immutable) | commit `61f591086085e1d6fcd4d8636d3364a9a949ddd6` |
| `extension.yml` at that ref | SHA-256 `bd81e05fbc43327b82dc43f2319c18a936418b510a822fa2d61ae7cba30e7416` |
| `.extensionignore` at that ref | SHA-256 `f1a39b110fcc888ed32c9cfcdea50971caf4caef292350e0dfddf29482f26c0c` |
| Validation script | `scripts/validate-spec-kit-extension.sh`, SHA-256 `c0bde9297f3fc7b535974b1c489f3be1ad4a985dc2b4d4c27883bd771b56082f` |
| Validation workflow | `.github/workflows/spec-kit-extension.yml`, SHA-256 `5c2af3fc5d0e139d3445962f3a1bb98a232cac0750ff1a3edab3f9587a487a2a` |
| Spec Kit versions exercised | `0.13.0`, `0.14.4`, `0.15.1` — the endpoints and midpoint of the manifest's declared `>=0.13.0,<0.16.0` |
| `adr` CLI under test | published `@adrkit/cli@0.3.0` from npm — the surface a real consumer installs, not a workspace build |
| Runner / runtimes | `ubuntu-latest`; Node 22; Python 3.12 |
| Workflow permissions | `contents: read` only. No PAT, no repository secret, no write scope. |

## Runs

| Run | Head | Result |
|---|---|---|
| [30779430843](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/30779430843) — PR #9, final | PR head | **3/3 legs pass**, 41 assertions each |
| [30779576194](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/30779576194) — `main` after merge | `b559d32` | **3/3 legs pass** |
| [30779240521](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/30779240521) — deliberate divergence | probe commit `d5f540d` | **3/3 legs fail** — see [Self-verification](#self-verification) |

## Rung-2 criteria

### Reproducible

Every run pins an immutable adrkit commit SHA (`61f5910`), a fixed Spec Kit
version per matrix leg, and a fixed published `@adrkit/cli` version. Inputs are
committed: the reference repository's own `docs/adr` corpus is the fixture, and
the extension is installed from the pinned checkout with
`specify extension add --dev`.

### Self-verifying

The workflow asserts its own expected outcomes and fails on divergence; it never
asks a human to read a log and decide. Each leg prints `assertions: 41,
failures: 0` and exits non-zero the moment any row diverges.

**This was demonstrated, not assumed.** A deliberate divergence commit repointed
`ADRKIT_REF` at `07658e4` — the extension's first commit, before
`.extensionignore` existed and while the manifest still pinned spec-kit
`<0.14.0`. All three legs went red, catching exactly the defects that version
really had:

| Assertion | What it caught |
|---|---|
| `INS-2` | The `<0.14.0` pin genuinely rejects 0.14.4 and 0.15.1 — the extension does not install |
| `PKG-package.json`, `PKG-test`, `PKG-tsconfig.json` | That version shipped development-only files into the consumer's project |
| `HOOK-*`, `BEH-*`, `FC-*` | Cascaded from the failed install |

A gate only ever seen green is a gate nobody has watched work. Run
[30779240521](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/30779240521);
reverted in the same PR.

### Fail-closed

Four consumer-facing failure scenarios run in every leg. Each proves a non-zero
exit, a message naming the missing dependency, and — for the only command that
writes — that **no record was written before failing**.

| Assertion | Scenario | Proves |
|---|---|---|
| `FC-1a/1b` | `adr` CLI absent from a scrubbed `PATH` | non-zero; stderr names `adrkit's CLI is not installed` |
| `FC-2a/2b` | No ADR corpus | non-zero; stderr names the directory searched |
| `FC-3a/3b/3c` | `draft` with no title | exit **2** (usage), names what is missing, corpus hash **unchanged** |
| `FC-4a/4b/4c` | `draft` with no plan | non-zero, names the missing plan, corpus hash **unchanged** |

`MUT-1` additionally byte-compares the entire consuming project before and after
`check` and `context` — the hook can fire `check` unattended, so it must touch
nothing. `MUT-2` asserts the reference repository itself is unmodified.

### Reviewed

This document. Reviewer verdict **PASS** (maintainer `@mbeacom`).

## Expected vs observed (representative rows)

Full per-run tables are uploaded as workflow artifacts
(`spec-kit-extension-evidence-<version>`). Representative rows, identical across
all three legs:

| id | Expectation | Observed |
|---|---|---|
| `PIN-1` | adrkit checkout is at `61f5910` | match |
| `PIN-3` | `adr --version` is `0.3.0` | match |
| `HOOK-3` | hook is `optional: true` | match |
| `HOOK-4` | count of hooks targeting `speckit.adrkit.draft` is `0` | `0` |
| `PKG-node_modules` | `node_modules` absent from the installed extension | absent |
| `BEH-2` | `context src/payments/api.ts` names `"recordId": "0001"` | present |
| `BEH-3` | `context src/orders/ledger.ts` names `"recordId": "0015"` | present |
| `MUT-1` | project tree hash unchanged across `check` + `context` | unchanged |
| `FC-3c` | corpus hash unchanged after `draft` with no title | unchanged |

`BEH-*` assert specific record ids rather than counts deliberately. Per
[ADR-0016](../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md),
"0 decisions govern this" and "I could not see the corpus" render as the same
string, so a count-based assertion would pass in exactly the case worth catching.

## Limitations (honest scope of this evidence)

- **Rung 2, not rung 3.** The reference repository is maintainer-owned. No party
  other than the maintainer has verified this extension in their own repository.
  Rung-3 external / community validation is **absent**.
- **The agent-facing surface is verified structurally, not conversationally.**
  The workflow asserts that commands render, that the hook is registered
  `optional: true`, and that the scripts behave correctly when invoked. It does
  **not** drive a live agent session through `/speckit.plan` and observe the
  hook prompt being offered and accepted — that path was exercised by hand and by
  spike 008, not by this CI gate.
- **Three versions, not every version.** `0.14.0`–`0.14.3` and `0.15.0` are
  inside the declared range but are not individually exercised. The endpoints and
  midpoint are.
- **The corpus is a fixture.** The reference repository's 15 records exercise the
  routing tiers and path matchers, but they are a constructed corpus, not an
  organization's real accumulated decisions.
- This evidence says nothing about Phase 6's status, which is governed
  independently and unchanged.
