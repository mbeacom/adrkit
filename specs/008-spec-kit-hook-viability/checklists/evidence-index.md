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
consistency (fresh-context audit, GPT-5.6 Sol, six cumulative audit rounds
against the original 6-entry `mutationBaselines` corpus, each finding and
closing genuine defects before the final PASS, **plus a seventh, targeted
audit pass** (PR review round 7) independently confirming the current
7-entry bundle — after a corroborating entry was added post-audit in PR
review round 4 — remains internally consistent and verdict-unchanged; see
[Independent audit](#independent-audit) below). **An eighth, later-dispatched
targeted pass** (PR review round 16) checked a different question — FR-011/
strongest-mechanism compliance for the `hook-fire` invocation — and returned
**FAIL**; because that defect was disclosed rather than remediated, T057 is
now marked incomplete (`- [ ]`) — see [Independent audit](#independent-audit)
below. The spike's own **contract
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
| Node.js runtime executing the `node .../packages/cli/dist/index.js queue` subprocess (SC-002/FR-011) | `v22.22.2`, on Darwin arm64 (macOS 26.5.2, kernel `25.5.0`) — the same host and runtime used throughout this spike's execution |
| Live Copilot lifecycle sessions (model) | `claude-sonnet-5` (per this session's model policy — never Opus 4.6) |
| Independent evidence audit (model) | `gpt-5.6-sol` (heavyweight tier, fresh context, no authoring history) |
| Fixture source file hashes (SHA-256) | `extension.yml` `b3765114...986b9d3`; `commands/probe.md` `11f88504...b9a33c2`; `scripts/probe.sh` `b6eac379...41b3fbdb` |
| **Evidence bundle file hashes (SHA-256, full digests)** | `spike-008-evidence.json`: `5433c588a55866090afdbad65935c606cdf451db35b0bbb6e35fb531d3a3aea7`; `spike-008-evidence.md`: `8a45a237d1a44e170fbef89ed4d76a7654d2b2ad40ac3a6972d654cce2a850c3` (per `contracts/evidence-bundle-and-verdict.md` §1's two-file bundle definition; both files are session-scoped only, per FR-017 — these digests let a reader verify a copy of either file against this index without the file itself being committed; **recomputed in PR review round 7** after that round's fixes — see [Independent audit](#independent-audit) — to a 7-entry `mutationBaselines` bundle; the round-4/round-6-era digests these superseded are not separately retained here since only the current, correct bundle state is a useful verification target) |

## Scratch environment (not tracked, not committed)

Three disposable `<SCRATCH_ROOT>` subtrees outside this repository's clone
(fixture source, Tier-1 Copilot scratch project, Tier-2 second-agent scratch
project), per `contracts/isolation-and-offline.md` §1. All were torn down at
spike closeout (T056); zero scratch artifact was ever committed to this
repository at any point (T055 — confirmed via `git log` showing no scratch
feature, scratch ADR, or fixture file in tracked history), and `git status`
at spike closeout showed none staged or present in the working tree or index
at that time. Neither check can retroactively prove a file was never staged
in the past (only current index/worktree state and the permanent commit
history are inspectable); the claim here is scoped to "never committed" and
"not staged at closeout," not "never staged at any point."
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

Mechanism used at original T005 execution: **allowlisted-env-plus-static-review**
(rank 3 of 3 in `contracts/isolation-and-offline.md` §4) — rank 2
(process-level egress block via `pfctl`) was attempted and found unavailable
in this shared, unprivileged host environment (`pfctl` requires `sudo`). Rank
1 (OS-namespace network denial) was **not conclusively determined
unavailable at the time** — the original check tested only `unshare(1)`, a
Linux-specific tool absent on this macOS host, and never tested this host's
own macOS-native equivalent (`sandbox-exec`); this was an **incomplete
availability check, not a valid determination that rank 1 was unavailable**
— see the corrective addendum below, which discloses and addresses this gap
directly. Rank 3 combines an explicit environment variable allowlist for
every subprocess invocation with static review of the fixture's own short
script source, confirming its only external process invocation is the
offline `@adrkit/cli` subprocess call (every `@adrkit/cli` command reads only
the local filesystem — Principle II, ADR-0007). No credential, API key, or
remote endpoint was configured anywhere in the fixture, the built CLI, or any
invocation environment.

**Limitation, stated honestly**: rank 3 does not prove the *absence* of a
network call the way ranks 1–2 would — it establishes that no credential or
endpoint is configured for one to succeed against, corroborated by full
static review of the fixture's short command source. No network-dependent
failure was observed during any invocation; this is a static/behavioral
observation, not an OS-level sandbox guarantee.

**Post-review corrective addendum.** Independent review (Copilot PR review,
PR #35) correctly identified that the original T005 rank-1 check was
incomplete: it tested only `unshare(1)`, a Linux-specific tool, and never
tested this host's own macOS-native OS-level network-denial primitive,
`sandbox-exec` (Seatbelt) — which root `plan.md`'s own 2026-07-22
network-denial probe for feature 009 independently confirms is present and
genuinely blocks network without privileges on this exact host (`curl` fails
with exit `6` under a `(deny network*)` profile). As a corrective action, this
was re-verified directly: `curl` under `sandbox-exec -f <(deny network*)
profile>` fails with exit `6` (confirming the mechanism genuinely blocks
network, no privileges required), and the fixture's own offline CLI
invocation — `node packages/cli/dist/index.js queue --dir docs/adr --format
json`, the exact command `probe.sh` execs per the static review above — was
re-run under the same `(deny network*)` profile and produced byte-identical
stdout to an unsandboxed baseline run, exit `0`, empty stderr. This is
genuine, stronger (rank-1-equivalent) proof, obtained *after* the original
spike execution and its independent audit, that this specific offline CLI
subprocess does not *require* network access to produce correct,
byte-identical output — not that it makes literally zero network-call
*attempts*; an attempted-and-silently-failed or attempted-and-ignored call
under the deny profile would be indistinguishable from no attempt at all by
this exit-code/stdout/stderr check alone. It does **not** retroactively claim rank
1 was used to gate the original `install`/`hook-fire`/`probe-*` live-Copilot
invocations recorded above — those remain honestly recorded as executed under
rank 3, per the original `network-denial.json`. Any future execution in this
same environment (including feature 009, per root `plan.md`'s own network-
denial probe) should check for `sandbox-exec` alongside `unshare` when
assessing rank-1 availability on macOS hosts.

**FR-011 compliance for the `hook-fire` invocation, stated explicitly (PR review round
13).** `spec.md` FR-011 requires the fixture's nested adrkit-CLI subprocess call to "run
with outbound network access disabled." The direct answer, for the one invocation this
substantively concerns: **not met in the strict/enforced sense.** `hook-fire` (T024) ran
under rank 3, which — per this section's own "Honest limitation" paragraph above — does
not enforce network denial the way ranks 1–2 do; it only corroborates the absence of
configured credentials/endpoints. `install` never invokes the adrkit CLI at all, and US4's
Probe A/B are deliberate failure tests that never reach a successful CLI invocation, so
`hook-fire` is the only `NetworkDenialRecord.appliedToInvocations` member backed by a real,
successful adrkit-CLI subprocess call, making it the only one where this gap has a
substantive FR-011 consequence rather than a purely notional one. The "Post-review
corrective addendum" above already states its `sandbox-exec` re-verification is a
separate, directly-invoked `node` command and does not retroactively extend rank-1
coverage to the actual recorded invocations; this paragraph makes that consequence
explicit for FR-011 specifically, rather than leaving it to be inferred. This is the same
orthogonal, no-go-verdict-unaffected T005 gap already disclosed throughout this section —
not a new, independent defect — see `tasks.md`'s T024 note for the task-level account.


## Verdict (T042–T048)

**Outcome: `no-go`.** Precedence order (no-go → go → manual-command-only) was
evaluated and matched at Step 1; Steps 2–3 were not evaluated (contract's
fixed short-circuit rule).

**Trigger: `mutation`**, driven independently by **two** of six original-corpus
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
| 6 | install-tier2-second-agent (PR review round 4, see below) | `false` | **mutation** *(fires the same trigger per the literal formula; corroborating only — not counted as a distinct verdict-driving axis)* |

Row 6 was added in **PR review round 4 remediation**, in response to a PR-review
finding that T033's Tier-2/second-agent `specify extension add --dev` invocation had
no bracketed `MutationBaseline` of its own in the original bundle (only T034's
*structural rendering* check covered that invocation, not its mutation
footprint) — unlike Tier-1's `install` invocation, which has a dedicated task (T019)
for exactly this. This was a gap in the original Phase 5/US3 **task decomposition**
(a missing task), not a failure to execute a defined task. A fresh, git-initialized
scratch project was used to capture a tightly-bracketed before/after `git status`
around that exact command (exit 0; before: empty; after: the same
four-new-untracked-path signature as row 0). It is recorded as **corroborating, not
verdict-driving**, evidence: the `no-go` trigger already fires independently and
sufficiently from rows 0 and 3 (the original Tier-1 corpus), so row 6 changes
nothing about the outcome. **Correction (PR review round 6):** row 6 corroborates —
it does **not and cannot retroactively close** — the original T033 invocation's own
missing before/after bracket. That specific historical gap is permanent and
irreversible: the original invocation was never bracketed, and no later invocation,
however faithfully reproduced, can stand in for a capture that was never taken. Row
6's fixture instance is a fresh,
schema-conformant recreation (the original round-4/round-5 on-disk fixture no
longer existed in this environment when the gap was discovered): its
`extension.yml` is byte-identical to the original
(`sha256:b37651147a063b6c7591712a09cf72eacedafebd3d43405625a2a225b986b9d3`,
matching `contracts/upstream-target.md`'s fixed literal manifest verbatim);
its `commands/probe.md`/`scripts/probe.sh` were freshly re-authored from
`contracts/fixture-surface.md`'s frozen contract text (which explicitly
labels those two files' exact bytes as "illustrative," only their behavior as
frozen) and do **not** hash-match the original round-4-corrected instance —
disclosed honestly here, never claimed as byte-identical.

`install` and `remove` are the same structural class of finding: a designed
lifecycle action that changes which files are present cannot satisfy a
literal byte-identical git-status bar. The remaining four Tier-1 entries are
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
  static-review caveat above, correctly disables/re-enables/removes in the
  Tier-1 project, and correctly renders structurally across a second,
  independent upstream-supported agent — the second-agent contract exercises
  rendering only, not disable/remove, per `contracts/agent-verification.md`'s
  own `liveInvocationPerformed: false` scope) — but the contract's own strict,
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
- This spike's own execution is **executed, out-of-contract on two blocking
  gates, and independently audited** (six cumulative fresh-context audit
  rounds against the original 6-entry Tier-1 `mutationBaselines` corpus, each
  round finding and closing genuine defects, converging to a final PASS on
  internal consistency; **plus a seventh, targeted audit pass, PR review
  round 7**, independently confirming the current 7-entry bundle — after a
  corroborating entry was added post-audit in PR review round 4 — remains
  internally consistent, schema-conformant, and verdict-unchanged; **plus an
  eighth, targeted audit pass, PR review round 16**, checking a distinct
  question — FR-011/strongest-mechanism compliance for the `hook-fire`
  invocation — that returned **FAIL**, disclosed rather than remediated, and
  resulting in T057 now being marked incomplete). The two blocking-gate
  violations are: (1) T012 cannot certify its named dependency set while
  T005 remains unchecked (PR review round 12); (2) T057's own text requires
  remediating the eighth pass's FAIL before T058, and that remediation did
  not happen, so T058 ran without T057's precondition genuinely holding (PR
  review round 18) — see the "Independent audit" and "Honest maturity label"
  sections below for the full account of both. **"Reference-verified" is a
  distinct, binding ADR-0014 rung-2 maturity term** — reproducible,
  self-verifying, fail-closed evidence from a maintainer-owned isolated
  reference repository (the bar Phase 6 met; see
  [`adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood)) —
  and is **not** claimed for this spike: the audit above is a fresh-context
  LLM consistency review of the session-scoped evidence bundle, not a
  reference-repository run, and T005 remains explicitly nonconformant. This
  spike's own execution is **not** externally validated and **not**
  community-adopted. ADR-0014 rung-3 external/community signal remains open
  and is not claimed here.
- Whether the `no-go` outcome should be read as "the criterion, as literally
  written, was too strict for a designed-to-mutate lifecycle action" is a
  scoping/contract-revision judgment left for a future, separately-authorized
  session — not one this spike is authorized to make for itself by
  re-interpreting its own gate.
- Full raw evidence (live-session JSONL transcripts, ~6.5MB; the complete
  `EvidenceBundle` JSON/Markdown pair) remains session-scoped only, per
  FR-017/FR-024. This index is the sanitized, tracked summary; it does not
  reproduce raw transcript content.
- **T005 conformance gap, discovered post-hoc via independent PR review — T005
  is marked incomplete (`- [ ]`) in `tasks.md` as a direct result**: at
  original execution time, T005's rank-1 availability check tested only
  `unshare(1)` and did not test this host's macOS-native equivalent,
  `sandbox-exec` — which was, in fact, genuinely available (kernel-enforced,
  no privileges required; confirmed directly, see "Post-review corrective
  addendum" above). This means the `install`/`hook-fire`/`probe-absent-context`/
  `probe-absent-cli` invocations recorded in this evidence ran under rank 3
  (allowlist + static review), not the contract's own "strongest available
  mechanism" requirement (`contracts/isolation-and-offline.md` §4) — a genuine
  execution-accuracy gap, not merely a documentation omission. Per direct PR
  review feedback, this is disclosed by leaving T005 unchecked in `tasks.md`
  rather than by qualifying prose alone while marking it complete: T005's own
  literal recording action was performed and produced a real, used
  `NetworkDenialRecord`, but the *selection itself* did not satisfy the
  contract's strongest-available-mechanism requirement, so it is not counted
  as complete. This does **not** retroactively invalidate the invocations it
  gated — those ran, completed, and are fully evidenced under rank 3, exactly
  as recorded. It was **not** remediated by re-running the full live-Copilot
  lifecycle session under rank 1: doing so was judged disproportionate once
  identified, because (a) the `no-go` verdict is driven entirely by the
  file-mutation baseline (`install`/`remove` non-identical `git status`), an
  axis wholly independent of which network-denial mechanism gated the
  invocations, so re-running would not change the verdict, and (b) it would
  require a second full isolated live-Copilot lifecycle session, itself a
  non-trivial resource/isolation cost. The post-hoc CLI-only re-verification
  above strengthens confidence that the offline CLI specifically does not
  require network access to produce correct, byte-identical output — not
  that it makes literally zero network-call attempts, per the same
  limitation stated above — but does **not** retroactively extend rank-1
  coverage to the
  actual recorded lifecycle invocations. Six cumulative independent audit
  rounds (see below) did not catch this gap either, prior to this PR review —
  that is itself a documented limitation of the audit process's
  environment-capability coverage, not just of T005.
- **`hook-fire` FR-011 compliance gap (T024), discovered post-hoc via independent PR
  review (round 13; a comment on `tasks.md:588` initially missed in this session's own
  review-round triage and surfaced only via a later unresolved-threads sanity sweep)**:
  this is the FR-011-specific consequence of the T005 gap immediately above, made
  explicit rather than left to be inferred. `spec.md` FR-011 requires the fixture's
  nested adrkit-CLI subprocess call to run with outbound network access disabled;
  `hook-fire` (T024) ran under rank 3, which does not enforce network denial the way
  ranks 1–2 do, so this requirement was **not** met in the strict/enforced sense for that
  invocation. See the "Network / credential limits" section above for the full account
  and why `hook-fire` — not `install` or either US4 probe — is the only invocation where
  this has a substantive consequence. T024's own literal action (capture the invocation,
  honestly record which mechanism it ran under) was performed correctly and is not
  disputed; T024's checkbox remains `- [X]` in `tasks.md` on that basis (see T024's own
  note there). This does not change the `no-go` verdict (driven independently by the
  mutation baseline) and is not a new, independent defect — it is the same T005 gap,
  traced to one additional consequence.
- **T033 Tier-2 mutation-bracket completeness gap, discovered post-hoc via
  independent PR review (PR round 4; framing corrected PR round 6)**: the original
  evidence bundle's six `MutationBaseline` entries all belong to the Tier-1
  (single-project) lifecycle; T033's Tier-2 (second-agent) `specify extension add
  --dev` invocation had no bracketed before/after `git status` capture of its own —
  only T034's structural rendering check covered that invocation, and only for file
  *shape*, not for the mutation *comparison* FR-012 requires. This is a genuine gap
  in the original Phase 5/US3 **task decomposition** — unlike Tier-1's `install`
  invocation, which has a dedicated task (T019) requiring exactly this bracket, no
  equivalent task was ever defined for T033's invocation. It is not a failure to
  execute a defined task: T033's own literally-described action (run `specify init`,
  then `specify extension add --dev`) was fully and correctly performed, so T033's
  checkbox in `tasks.md` remains `- [X]`. Because the original invocation was never
  bracketed, that specific gap is permanent and irreversible — no later invocation,
  however faithfully reproduced, can retroactively supply a before/after capture that
  was never taken. A 7th, corroborating `MutationBaseline` entry
  (`install-tier2-second-agent`; see the Verdict section's table above) was captured
  against a freshly recreated fixture instance in a dedicated Tier-2-style scratch
  project, git-initialized specifically to bracket this one command — this
  **corroborates** (it does not close or fix) the original gap. The recreated
  fixture's `extension.yml` is byte-identical to the frozen original
  (`contracts/upstream-target.md`'s literal manifest); its `probe.md`/
  `probe.sh` are freshly re-authored per `contracts/fixture-surface.md`'s
  explicit "illustrative shape" allowance for those two files and do not
  hash-match the original — disclosed here, not claimed otherwise. The new
  entry reproduces the identical four-new-untracked-path structural
  signature as the Tier-1 `install` finding, corroborating (not changing)
  the existing `no-go` verdict, which already fires independently from the
  Tier-1 corpus alone.
- **T012 checkpoint dependency gap, discovered via PR review rounds 6 and 11 — T012 is
  now marked incomplete (`- [ ]`) in `tasks.md` as a direct result**: PR review round 6
  first raised whether T012's header ("Depends on: ..., T005, ...") requires T005 to
  fully satisfy T005's own separate substantive contract (select the strongest
  available network-denial mechanism) before T012 can count as confirmed. At the time
  this was resolved by reading T012's own literal action narrowly — *confirm the seven
  listed outputs exist and are internally consistent*, not *re-certify each
  dependency's own selection decision* — and T012 stayed `- [X]` on that basis; that
  narrower sub-check is independently true (T005's `NetworkDenialRecord` does exist and
  is internally consistent in shape). This reading is superseded below by round 11 and,
  on the execution-order question specifically, by round 12 — see both. **PR review round 11
  correctly identified that this narrower reading is inconsistent with how every other
  "Depends on: X" reference in this document is used**: elsewhere, a dependency's own
  checkbox — not merely its output's existence — is what is depended on, and T012's
  entire and sole stated action IS dependency-set certification, so it cannot
  self-consistently exempt itself from that convention. Per this feedback, T012 is
  corrected to `- [ ]` in `tasks.md` (see T012's own note there for the full account):
  the checkpoint's formal dependency-satisfaction claim is not true while T005 remains
  explicitly unchecked, even though T012's own narrower sub-check (do the seven outputs
  exist and cohere) remains independently true. **This correction does not cascade to
  individual task checkboxes**: downstream checkpoints citing "Depends on: T012"
  (US1/US2/US3/US5, including T042) remain `- [X]` — each has its own distinct,
  literally-described action (recording a transcript, validating field existence, etc.)
  that does not itself re-certify T005's mechanism-selection quality or T012's
  dependency-set-certification status, and each remains independently evidenced as
  genuinely performed. **Per PR review round 12, this is nonetheless disclosed as an
  out-of-contract execution, not a fully gate-conformant one**: T012's own text is an
  explicit blocking rule ("No User Story task below may begin until this checkpoint is
  confirmed"), and the User Story tasks that already ran necessarily began without that
  rule's own precondition genuinely holding. This document accepts that characterization
  — see the "Honest maturity label" section below and root `plan.md`'s Phase 7 row for the
  corrected overall status wording. This is the same reasoning already applied, and left
  uncontested by round 11, to T033's and T042's relationship to T005's gap. T012 and
  **T057** are the two tasks among the 58 whose own defined actions (dependency-set
  certification, and remediating any defect found before T058, respectively) make each
  inseparable from a disclosed upstream gap — T057's own remediation-before-T058 rule was
  not honored either (PR review round 18, see "Independent audit" below) — while every
  other task's own defined action is separable from both gaps. T033's unrelated
  task-decomposition gap above is grouped here only because PR review round 6 raised both
  findings in the same review pass.

## Independent audit


Six cumulative fresh-context audit rounds (all `gpt-5.6-sol`, none sharing
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
shape and 6-entry `mutationBaselines` array unchanged. **This PASS was scoped
to the bundle as it existed at that time — a 6-entry `mutationBaselines`
array.**

**Seventh audit pass (PR review round 7).** A corroborating 7th
`mutationBaselines` entry (`install-tier2-second-agent`) was added afterward,
during PR review round 4 remediation (see [Verdict](#verdict-t042-t048)'s
row 6 and the Limitations bullet above) — meaning the six-round "final PASS"
above was never actually performed against the bundle's current, 7-entry
state. A PR reviewer correctly flagged this as a genuine temporal/scope
mismatch (distinct from round 6's findings, which were wording-only). Rather
than merely re-scoping the "executed and independently audited" claim, a seventh independent
fresh-context audit pass (`gpt-5.6-sol`, no authoring context) was dispatched
against the checks (a)–(f) above, applied to the current bundle, plus a new
check (g) covering the 7th entry's own schema conformance and narrative
consistency. That pass returned **FAIL** on first inspection, correctly
finding six real, previously undetected defects: (1) the Markdown's "Bundle
completeness" section still stated "6 entries" unqualified; (2) the
Markdown's probe-b stderr table row presented a two-line stderr excerpt
misleadingly as if it were the exact, complete stderr content; (3) the 7th
entry itself deviated from the schema/convention followed by the other six
on `gitTreeRoot` (held a literal path instead of the generic
`"scratch-project"` label) and `adrDiffStatBefore`/`adrDiffStatAfter` (held
descriptive strings instead of `null`); (4) — most substantively — the 7th
entry's `noGoTriggerFired`/`noGoTriggerType` (`false`/`null` despite
`identical: false`, contradicting the literal `data-model.md` §5 formula
applied to every other entry); (5) the 7th entry's own `analysis` text still
used "closing"/"closes" language for the FR-012 gap (a defect round 6 had
already fixed everywhere else but had missed in this one raw JSON field) and
mislabeled the change's origin as "round-6" when every tracked repository
file consistently and correctly attributes it to PR review round 4; (6)
`verdict.otherTriggersChecked` lacked a corresponding 7th key for consistency
with its established one-key-per-entry pattern. All six were fixed; the
corrected bundle's
`noGoTriggerFired`/`noGoTriggerType` for the 7th entry are now `true`/
`"mutation"` (it does independently fire the same trigger, honestly, and is
excluded from `drivingEvidence` only because it corroborates an
already-established axis rather than adding a distinct one — this does not
change the outcome, which remains `no-go`/`mutation` from rows 0 and 3
alone). The bundle's exactly-14-top-level-field shape is unchanged; the
`mutationBaselines` array is now 7 entries, all schema-conformant, and the
verdict, precedence, `drivingEvidence`, and Phase-6-maturity restatement were
all independently re-confirmed unchanged and correct by this same pass.

**PR review round 13 additionally found** that FR-011's own network-disabled requirement
was not, in the strict sense, met by the `hook-fire` invocation T024 captured (see
"Network / credential limits" above and the Limitations bullet above for the full
account). **PR review round 15 pressed further** (two suppressed comments, on this
section's counterpart passage in `tasks.md`'s T057 note and on `plan.md`'s ledger row):
T057's own intro sentence is genuinely ambiguous between a narrow reading (items (a)–(f)
exhaustively define the check) and a broader reading (full substantive FR/SC/contract
compliance is the mandate). Round 15's fix conceded this ambiguity but also claimed the
checkbox held "regardless of which reading is correct" — an inconsistent position that
**PR review round 16** (posted comment, `tasks.md:1040`) correctly flagged: under the
broader reading, a dispatched-scope gap is exactly the shortfall that would make `[X]`
unjustified, so the two claims could not coexist. Round 16 suggested resolving this by
actually running an audit that covers the broader reading, or marking T057 incomplete.
An eighth audit pass — never previously dispatched, and not a re-run of the first seven's
already-checked items (a)–(f) — was commissioned from a fresh-context GPT-5.6-Sol
reviewer with zero authoring context, given only `network-denial.json`'s literal content,
the mechanism-hierarchy contract text, and FR-011's literal text, and asked to
independently determine whether the recorded `hook-fire` invocation applies the strongest
available mechanism and meets FR-011's literal requirement. Independent finding: **FAIL
on both** — confirming, not contradicting, what T005/T024 already disclosed, now as a
formally checked discrete item rather than an inferred consequence. **PR review round 17**
correctly pressed on the remaining gap: T057's own text requires remediating any defect
found before T058, and recording a FAIL is disclosure, not remediation. Retroactively
curing the original `hook-fire` invocation would require re-running the live-Copilot
lifecycle in a fresh isolated session — judged disproportionate for the same reason given
in T005's own note (the `no-go` verdict is unaffected either way) — so it was not done.
**T057 is therefore marked incomplete (`- [ ]`)**: this holds under either scope reading
from round 15, since a defect is now formally on the record and unremediated regardless
of how the intro sentence is read. See `tasks.md`'s T057 note for the full account. This
is not a new, independent defect distinct from T005; it is the same underlying gap, now
closed out with a genuinely dispatched check and its consequence for T057's own checkbox
honestly recorded. **PR review round 18** correctly pressed one step further: T057's own
text ("record findings; remediate any defect found before T058") and the Dependency
Graph's `T057 → T058` step together state an explicit ordering rule — textually parallel
to T012's own "No User Story task below may begin until this checkpoint is confirmed" —
and, since the eighth pass's FAIL was never remediated, T058 ran without that rule's own
precondition genuinely holding. **This is accepted as a second, distinct out-of-contract
gate**, disclosed rather than argued away, exactly as T012's own violation was in round
12. It does not change T058's own checkbox: T058's own literal action (produce an honest
report) is independent of T057's substantive remediation status, ran, and is evidenced —
including honestly disclosing both T057's incompleteness and this ordering violation
itself — the same "own distinct literal action, independent of an upstream defect"
reasoning already applied, and left uncontested, to T012's downstream User Story tasks.
See `tasks.md`'s T057 round-18 addendum and T058's own round-18 note for the full account.

## Honest maturity label

Feature 008 (`specs/008-spec-kit-hook-viability/`) is **executed, out-of-contract on
two blocking gates, and independently audited across eight dispatched passes**. It ran and
reached a recorded verdict, but per PR review round 12, T012's own blocking-checkpoint rule
("No User Story task below may begin until this checkpoint is confirmed") could not be
genuinely satisfied at execution time (T005's gap); and, per PR review round 18, T057's own
parallel blocking rule ("record findings; remediate any defect found before T058") could not
be genuinely satisfied either, once the eighth audit pass returned a FAIL that was disclosed
rather than remediated — so this is disclosed as an **out-of-contract execution on two
distinct gates**, not an unqualified "executed end-to-end" one — see the "Independent audit"
section above for both the T012 paragraph and the round-18 addendum, and root `plan.md`'s
Phase 7 row for the corrected overall status wording. The audit itself is a fresh-context LLM
**consistency and compliance audit** of the session-scoped evidence bundle: seven passes
against items (a)–(f) of T057's own defined checklist, plus an eighth, later-dispatched
pass (PR review round 16) that specifically checked the FR-011/strongest-mechanism
question neither the original seven nor items (a)–(f) themselves cover — see T057's own
note in `tasks.md`. That eighth pass independently confirmed, rather than newly
discovered, the same T005/T024 FR-011 gap already found by PR review (it was given only
FR-011's text, the mechanism-hierarchy contract, and `network-denial.json` — not the
separate T012 dependency-certification materials — so it speaks to that gap only, not to
T012's own status); because the defect it confirmed was disclosed rather than remediated,
T057 itself is now a **third** unchecked exception alongside T005 and T012 (PR review
round 17), and the same disclosed-not-remediated fact is also, per PR review round 18,
the source of the second blocking-gate violation named above (T057's own rule for T058).
None of this is ADR-0014's rung-2
maturity state (reproducible, self-verifying,
fail-closed evidence from a maintainer-owned isolated reference repository — the bar
Phase 6 met); **"reference-verified"
is deliberately not claimed for this spike**. It is **not released**, **not
externally validated**, and **not adopted**. Its own contract verdict is
**`no-go`** (mutation trigger, both install and remove). Three tasks are
explicitly left incomplete in `tasks.md` (`- [ ]`): **T005** — its own
mechanism-selection did not meet the contract's strongest-available-mechanism
requirement (see Limitations, above); this does not invalidate the
invocations it gated (fully evidenced under rank 3) or change the `no-go`
verdict — **T012** — the Foundational checkpoint's own defined action is
certifying its full named dependency set (including T005) is satisfied, and
per PR review round 11 it cannot claim that while T005 remains unchecked,
even though T012's narrower sub-check (its seven listed outputs exist and
cohere) is independently true — but, per PR review round 12, T012's own
blocking-gate rule ("No User Story task below may begin until this
checkpoint is confirmed") was **not** honored in execution order, since the
User Story tasks that already ran necessarily began before that rule's
precondition genuinely held (see the Limitations entry above for the full
account) — and **T057** — its own dispatched audit (the eighth pass, PR
review round 16) found a genuine FAIL on the FR-011/strongest-mechanism
question, and this task's own text requires remediating any defect found
before T058; because that remediation did not happen (only disclosure did),
this task's own literal completion bar is unmet under either round-15 scope
reading of its intro sentence, and it is marked incomplete accordingly (PR
review round 17) — see the "Independent audit" section above for the full
account. **Per PR review round 18**, T057's own text and the Dependency
Graph's `T057 → T058` step together also make this the source of the run's
*second* blocking-gate violation: T058 ran without T057's remediation
precondition genuinely holding, textually parallel to T012's own violation
above. One additional task, **T024**, remains checked (`- [X]`) but carries its own
explicit disclosure (PR review round 13): the `hook-fire` invocation it captured ran
under T005's same rank-3 mechanism, so FR-011's own network-disabled requirement was not,
in the strict sense, met for that specific invocation — T024's own defined action
(capture and honestly record which mechanism actually ran) was performed correctly and is
not disputed, so this is disclosed rather than treated as a fourth checkbox exception; see
T024's own note in `tasks.md` and the "Network / credential limits" section above.
**T058 also remains checked (`- [X]`)** despite being the point at which the second
blocking-gate violation became visible in execution order (PR review round 18): its own
literal action — produce an honest report — is independent of T057's substantive
remediation status, ran, and is evidenced, including honestly disclosing both T057's
incompleteness and this very ordering violation; see T058's own round-18 note in
`tasks.md`. None of these checked-but-disclosed or unchecked-exception tasks cascades to
the User Story tasks' own
checkboxes (T013 onward remain `- [X]`, **with the sole exception of T057**, unchecked as
of PR review round 17 for its own separate, disclosed reason — see `tasks.md`'s own T057
note), each of which has its own
independently-evidenced, literally-described action — but this is a
narrower, checkbox-level claim, not a claim that the overall run honored
either T012's or T057's blocking rule in its intended order (see above). It is a disposable
compatibility spike, not a shipped adapter or integration
(`spec.md`: "It does not produce that adapter"). Feature 009
(`specs/009-catalog-binding-viability/`) is separately governance-authorized
(its own preconditions are already satisfied) but was, per root `plan.md`'s
execution sequence, deliberately **scheduled to run only after this spike
completed end-to-end**; this spike executed and reached a recorded verdict,
**but out-of-contract on two blocking gates (T012's and T057's own), with the
T005/T012/T057 exceptions above disclosed and unresolved** — this index reports that state
honestly rather than declaring the "completed end-to-end" precondition
unconditionally, cleanly satisfied. Whether that state is sufficient to
begin feature 009 is a judgment this index does not make; it is left to
root `plan.md`'s own maintainer review at the time feature 009 is next
considered — root `plan.md`'s Phase 7 row explicitly states the 008→009
sequencing precondition is **not** established as satisfied by this spike's
run alone. Feature 009 still requires its own
technical safety gate (a genuinely blocking network-denial mechanism,
FR-018/T006) at execution time; this index does not itself initiate, weaken,
or bypass that gate.
