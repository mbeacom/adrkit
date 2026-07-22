# Spike 008 evidence index (FR-024)

**Purpose**: The tracked, sanitized evidence index required by
[FR-024](../spec.md) if this non-shipping compatibility spike is landed in
tracked repository history. It mirrors ADR-0014's rung-2 discipline: content
hashes, tool versions, negative-test results, and a reviewer verdict — without
embedding the full raw evidence bundle or live-session transcripts, which
remain scratch/session-only per this spike's own contract
(`research.md` R3, `contracts/isolation-and-offline.md` §1, FR-017).

This spike's own verdict is **`no-go`** (see below). Landing this index records
that the spike was executed and independently audited — it does **not** claim
Phase 6 external validation, does **not** claim this spike is itself
"released" or "adopted," and does **not** authorize or scope any future
shipping integration. Any resulting change to `spec.md`/`plan.md`/`tasks.md`
that this spike's findings might suggest is a separate, later,
explicitly-scoped follow-up (T058) — not a decision this execution made for
itself.

**Executed**: 2026-07-22
**Feature**: [spec.md](../spec.md) · [tasks.md](../tasks.md)
**Reviewer verdict**: PASS on evidence-bundle integrity and internal
consistency (fresh-context audit, GPT-5.6 Sol, six iterative remediation
rounds against three cumulative audit passes — see
[Independent audit](#independent-audit) below). The spike's own **contract
verdict** (`no-go`) is a separate, orthogonal outcome — see
[Verdict](#verdict-t042-t048).

## Tool versions / environment

| Component | Version / ref |
|---|---|
| adrkit under test (this repository, HEAD at spike execution) | commit `908e76646477bf9aadc76a4aef4415fd9231b3af` |
| Governance gate (Phase 6 landing, this spike's precondition) | PR [#30](https://github.com/mbeacom/adrkit/pull/30), merge SHA `38336982b2d78aa1e20dcd57fd759c07aee716e9` |
| Upstream Spec Kit target (frozen, pinned) | tag `v0.13.0`, peeled commit `9a30db484b0876cb7e5a391cf735d59bd968e985`, tag object `7c95192e6b1a164f5294cc9f2e3851b28d3ba171` |
| `specify` CLI installed version | `0.13.0` (re-verified at execution time; matched frozen target exactly, no mismatch escalation triggered) |
| Bun (this repository's build) | `1.3.14` |
| `@adrkit/cli` built artifact invoked by the fixture | `packages/cli/dist/index.js`, present and unchanged (T051 re-confirmed) |
| Live Copilot lifecycle sessions (model) | `claude-sonnet-5` (per this session's model policy — never Opus 4.6) |
| Independent evidence audit (model) | `gpt-5.6-sol` (heavyweight tier, fresh context, no authoring history) |
| Fixture source file hashes (SHA-256) | `extension.yml` `b3765114...986b9d3`; `commands/probe.md` `11f88504...b9a33c2`; `scripts/probe.sh` `b6eac379...41b3fbdb` |

## Scratch environment (not tracked, not committed)

Three disposable `<SCRATCH_ROOT>` subtrees outside this repository's clone
(fixture source, Tier-1 Copilot scratch project, Tier-2 second-agent scratch
project), per `contracts/isolation-and-offline.md` §1. All were torn down at
spike closeout (T056); zero scratch artifact was ever staged or committed to
this repository at any point (T055 — confirmed via `git log`/`git status`
showing no scratch feature, scratch ADR, or fixture file in tracked history).
Two live-Copilot lifecycle sessions' full raw JSONL transcripts
(7,664 + 9,439 events, ~6.5MB) were permanently retained as session-scoped
evidence rather than treated as disposable — never committed to this
repository, consistent with FR-017/FR-024's "raw transcripts remain
scratch-only" rule.

## Negative-test results (fail-closed probes)

| Probe | Command context | Exit code | stderr (bytes) | Unhandled crash? | Names missing dependency + remediation? |
|---|---|---|---|---|---|
| `probe-absent-context` (no adrkit feature/plan context reachable) | run from an empty scratch directory, no `specs/`, no `.specify/feature.json` | `1` | 85 | No | Yes — exact contract text match |
| `probe-absent-cli` (built CLI artifact absent from disk) | `packages/cli/dist` renamed aside; run against a real scratch feature directory (genuine plan-context read succeeds first) | `1` | 310 | No | Yes — names missing artifact and the `bun run build` remediation command |

Both probes independently satisfy `contracts/fixture-surface.md` §3–§4's fixed
exit-code/message contract: non-zero exit, a specific message naming the
missing dependency, no unhandled crash, stdout empty. Neither probe's own
`MutationBaseline` fired the `mutation` no-go trigger (both `identical: true`
— these are read-only failure paths).

## Network / credential limits

Mechanism used: **allowlisted-env-plus-static-review** (rank 3 of 3 in
`contracts/isolation-and-offline.md` §4) — ranks 1–2 (OS-namespace/firewall
network denial, process-level egress block) were attempted and found
unavailable in this shared, unprivileged host environment (no `unshare(1)`;
`pfctl` requires `sudo`, unavailable). Rank 3 combines an explicit environment
variable allowlist for every subprocess invocation with static review of the
fixture's own short script source, confirming its only external process
invocation is the offline `@adrkit/cli` subprocess call (every `@adrkit/cli`
command reads only the local filesystem — Principle II, ADR-0007). No
credential, API key, or remote endpoint was configured anywhere in the
fixture, the built CLI, or any invocation environment.

**Limitation, stated honestly**: rank 3 does not prove the *absence* of a
network call the way ranks 1–2 would — it establishes that no credential or
endpoint is configured for one to succeed against, corroborated by full
static review of the fixture's short command source. No network-dependent
failure was observed during any invocation; this is a static/behavioral
observation, not an OS-level sandbox guarantee.

## Verdict (T042–T048)

**Outcome: `no-go`.** Precedence order (no-go → go → manual-command-only) was
evaluated and matched at Step 1; Steps 2–3 were not evaluated (contract's
fixed short-circuit rule).

**Trigger: `mutation`**, driven independently by **two** of six
`MutationBaseline` entries (each alone is sufficient under the contract's
literal, strict byte-identical `git status --porcelain=v1` bar):

| # | Invocation | `identical` | Trigger fired |
|---|---|---|---|
| 0 | install | `false` | **mutation** |
| 1 | hook-fire | `true` | — |
| 2 | disable | `true` | — |
| 3 | remove | `false` | **mutation** |
| 4 | probe-absent-context | `true` | — |
| 5 | probe-absent-cli | `true` | — |

`install` and `remove` are the same structural class of finding: a designed
lifecycle action that changes which files are present cannot satisfy a
literal byte-identical git-status bar. The remaining four entries are
read-only or flag-only operations and are genuinely identical. Separately,
all six rows of the removal-completeness check (`SC-004`) independently
**passed** — SC-004 (did removal clean up correctly and completely) is a
different criterion from SC-003 (is git status byte-identical), and one
passing does not require or imply the other.

`recommendation` is `null` (required for a `no-go` outcome —
`NonBindingRecommendation` does not apply). `manualCommandOnlyShortfall` is
also `null` (outcome is not `manual-command-only`).

## Determinism

The frozen upstream reference was re-verified at execution time
(`git ls-remote --tags`, peeled commit) and matched the pinned target exactly
— no mismatch, no escalation. The fixture's three source files were hashed
(SHA-256) at install time and re-verified byte-identical across every
subsequent lifecycle step that did not intentionally modify them (disable
flips only `.specify/extensions.yml`'s internal flag; every fixture-owned
file's content hash and mtime are unchanged by disable).

## Limitations (honest scope of this evidence)

- This spike's outcome is **`no-go`**, not `go` or `manual-command-only`. The
  underlying *mechanism* is genuinely encouraging (the `after_plan` hook fires
  reliably, sees real plan context, safely shells out to adrkit's own offline
  built CLI with no observed network activity subject to the Tier-3
  static-review caveat above, and correctly renders/disables/removes across
  at least two upstream-supported agents) — but the contract's own strict,
  literal verdict procedure treats *any* non-identical git-status comparison
  as a `no-go` trigger, with no carve-out for a lifecycle action whose entire
  purpose is to write files. This tension is reported honestly rather than
  smoothed over.
- This is a **disposable, non-shipping compatibility probe** against one
  frozen upstream commit (Spec Kit `v0.13.0`). It is **not** a production
  integration, ships no package, and scopes no future work by itself.
- This spike **did not cause, advance, weaken, or otherwise change** Phase 6's
  (`specs/007-arb-queue/`) landed/reference-verified maturity status in any
  direction — that status is governed independently by ADR-0014 and PR #30
  (merge SHA `38336982b2d78aa1e20dcd57fd759c07aee716e9`), and this spike's own
  verdict, whatever it turned out to be, was never contingent on or coupled
  to it.
- This spike's own execution is **reference-verified by independent audit**
  (six cumulative audit rounds against the evidence bundle, converging to a
  final PASS on internal consistency) — it is **not** externally validated
  and **not** community-adopted. ADR-0014 rung-3 external/community signal
  remains open and is not claimed here.
- Whether the `no-go` outcome should be read as "the criterion, as literally
  written, was too strict for a designed-to-mutate lifecycle action" is a
  scoping/contract-revision judgment left for a future, separately-authorized
  session — not one this spike is authorized to make for itself by
  re-interpreting its own gate.
- Full raw evidence (live-session JSONL transcripts, ~6.5MB; the complete
  `EvidenceBundle` JSON/Markdown pair) remains session-scoped only, per
  FR-017/FR-024. This index is the sanitized, tracked summary; it does not
  reproduce raw transcript content.

## Independent audit

Three cumulative fresh-context audit passes (all `gpt-5.6-sol`, none sharing
authoring context with the session that produced the evidence) progressively
found and closed genuine defects across the evidence bundle — field-shape
violations, stale hash references from an earlier fixture instance, an
inaccurate occurrence-count claim, and (twice) an implementation bug where a
fix was written to the wrong field path. Each defect was independently
re-verified closed by the same auditing agent before being accepted. The
final round concluded with an explicit **PASS**: internal consistency between
the JSON manifest and Markdown narrative, correct fixed-order verdict
precedence, non-empty and correctly-shaped `drivingEvidence`,
`recommendation`/`manualCommandOnlyShortfall` both `null` as required for a
`no-go` outcome, the Phase-6-maturity restatement present and correctly
worded, and no fabricated or paraphrased-as-verbatim evidence — held
throughout every remediation cycle, with the master bundle's exactly-14-field
shape and 6-entry `mutationBaselines` array unchanged.

## Honest maturity label

Feature 008 (`specs/008-spec-kit-hook-viability/`) is **executed and
reference-verified by independent audit**. It is **not released**, **not
externally validated**, and **not adopted**. Its own contract verdict is
**`no-go`** (mutation trigger, both install and remove). It is a disposable
compatibility spike, not a shipped adapter or integration
(`spec.md`: "It does not produce that adapter"). Feature 009 execution is a
separate, distinct, and not-yet-authorized gate — this index does not
authorize it.
