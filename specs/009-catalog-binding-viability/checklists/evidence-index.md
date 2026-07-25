# Spike 009 evidence index (FR-019 / FR-025)

**Purpose**: The tracked, sanitized evidence index this non-shipping compatibility
spike's own `spec.md` (FR-019) anticipates as the *task/plan housekeeping record*
of an executed run. It mirrors ADR-0014's rung-2 discipline — content hashes, tool
versions, network/credential limits, negative-test results, and a reviewer
verdict — **without** embedding the full raw evidence bundle, corpus checkouts, or
live-session transcripts, which remain scratch/session-artifact-only per this
spike's own contract (`spec.md` FR-019: "the evidence bundle itself MUST remain
scratch/untracked output"). Because this run's own recorded verdict is `blocked`
(not `go-explicit`), no "landed" claim is made by this index, and no tracked
sanitized evidence index beyond this task/plan-completion record is warranted or
authorized. **This index does not itself constitute, cause, or substitute for
Phase 6 external/community validation, optional externally-validated maturity, or
any production/shipping integration decision.**

**Executed**: this session, from `main` post-PR-#36 merge `8c06dc656cdd9abf22d59e5ae49da9eb058c604d`.
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [tasks.md](../tasks.md) · [data-model.md](../data-model.md) · [contracts/](../contracts/)

## Recorded verdict

**`outcome: "blocked"`**, `blockedShortfall: "envelope-or-scale-evidence-incomplete"`.

Precedence was evaluated in the fixed order `no-go` → `go-explicit` → `blocked`
(data-model.md §23; SC-012). Neither `no-go` nor `go-explicit` fired; `blocked`
is the exhaustive, honestly-reached fallback.

- **`no-go` (did not fire)**: all eight named unsafe conditions were checked
  against the assembled evidence — determinism (`mutation-baselines.json`: 11/11
  gated invocations byte-identical), network/credential isolation
  (`network-denial.json`, `credential-absence.json`), whole-operation atomicity
  (`atomic-failure-records.json`: 13/13 `runAborted=true`,
  `partialSnapshotProduced=false`), repository-mismatch rejection,
  invalid-pattern/invalid-shape rejection, envelope-rejection correctness
  (tampered/stale/wrong-repository/malformed-kind), repository-isolation, and
  cross-run byte-identical output — **none fired**.
- **`go-explicit` (did not fire)**: every User Story 1–7 acceptance scenario
  passed exactly as specified **except** Phase 8 (US6), which requires a
  populated envelope/scale-evidence record for every real-corpus pass. The
  pinned `community-plugins` and `rhdh-plugins` corpora each contain a genuine,
  pre-existing `duplicate-canonical-id` defect (unsubstituted Backstage
  software-template skeleton files sharing the literal, un-templated
  `metadata.name: "${{ values.name | dump }}"` placeholder — **five** such files
  in `community-plugins` and **nine** in `rhdh-plugins`; a tenth `rhdh-plugins`
  descriptor, `bulk-import`, carries a *different* unsubstituted placeholder,
  `${{ values.name }}`, so it canonicalizes distinctly and is not part of that
  collision cohort — sixteen unsubstituted skeleton files in all, fourteen
  colliding; see "Correction 1" and "Correction 2" below) that deterministically,
  correctly, fail-closed-triggers rejection on all 6 repetitions, byte-identically,
  for both corpora. SC-001 (byte-identical output) and SC-002 (whole-operation
  atomicity) both **hold** — the rejection itself is deterministic with zero
  partial output — but SC-010 (three populated envelopes) is unsatisfiable for 2
  of 3 required real-corpus passes. This is the generator working exactly as
  designed against a genuine corpus defect, not a bug — disclosed, not patched
  (this is a non-shipping spike; no production-code fix is authorized or
  attempted).
- **`blocked` (fired, exhaustive fallback)**: `blockedShortfall =
  "envelope-or-scale-evidence-incomplete"`, affecting the `community-plugins` and
  `rhdh-plugins` passes only — the `synthetic` pass fully produced a populated
  9-entity envelope. B/C comparison-heuristic measurement (391 measurements,
  independent of the Phase 8 snapshot-pipeline shortfall) succeeded fully for
  both real corpora and synthetic data.

## Reference oracle (T014–T016; pre-generator gate)

`reference-oracle.json` sha256 `8f0e260fbf86eadf495726f6f8d6f569586c75ed0f74cafa1b5c8411610ae9d5`
was authored by the maintainer role, frozen, and hashed **before** any
generator-derived output existed. It was independently audited pre-generator
(T014a) by a fresh-context sub-agent with no prior authoring involvement, which
recomputed the sha256 (match confirmed) and confirmed all six required case
classes (positive / negative / overlap / annotation-absent vs. explicit-empty /
canonical collision / repository mismatch) present and correctly labeled, with
the contract's bounded zero-false-positive/zero-false-negative bar satisfied.

**Authoritative audit record (post-remediation): `reference-oracle-audit.opus48.json`
sha256 `4702d17c3da8bbdedf97b15744bc23a9637eb48977251792817956acdf8826d9`** (internally
recorded `auditedReferenceOracleSha256` matches `reference-oracle.json`'s sha256 above).
Performed by a fresh, independent
Claude **Opus 4.8** sub-agent, satisfying both the task-file's own reviewer-independence
requirement and this session's explicit Opus 4.8/GPT-5.6 Sol model-policy override for
this specific audit role. It independently recomputed the sha256 of all ten input
fixture files (matching `reference-oracle-inputs.sha256` exactly) and the oracle's own
sha256, then re-derived every case class from raw fixture bytes against every relevant
contract from scratch (not by trusting the prior audit). **Verdict: PASS.**

**Original audit record (superseded, preserved as historical record, not deleted):
`reference-oracle-audit.json` sha256 `f80b67c021ddcbd9bc155921252c5cb73c36b2b185c08bc2ba050dca08f87c48`.**
This run used an independent, fully context-isolated Claude **Sonnet 4.6** sub-agent —
genuine context-isolated independence was achieved and the audit passed on its merits, but
the specific model does not match this session's Opus 4.8/GPT-5.6 Sol requirement for this
audit role (it is not Opus 4.6 either, so the explicit "never Opus 4.6" prohibition was not
violated — but it also does not satisfy the instructed alternative). **PR #37 review
correction:** this deviation was flagged by automated review and remediated with the
compliant Opus 4.8 rerun above, which is now the authoritative T014a gate record for T016.
The original file is retained unmodified rather than deleted, matching this evidence
bundle's own no-destructive-rewrite convention.

**New finding disclosed only by the compliant rerun:** the oracle's `positive` case records
`expectedOutcome.derivedPathPatterns` in input order (`["packages/payments/**",
"apis/payments/**"]`) rather than the `compareCodeUnits`-sorted order
`owned-paths-annotation.md` §3 mandates for the `explicit-paths` derived array (the correct
sorted order is `["apis/payments/**", "packages/payments/**"]`, since `"a"` sorts before
`"p"`). This does not change the case class, three-state discriminator, or accept/reject
outcome for any case, and none of this spike's own scratch tooling diffs generator output
against these named oracle fixture files (the oracle is a maintainer-authored,
pre-generator-output ground-truth reference per FR-025, not an executed test harness in this
spike) — so it has no bearing on any recorded result. It is disclosed here for legibility;
the already-frozen oracle was deliberately left uncorrected rather than risk any appearance
of backfilling a frozen artifact after generator/derivation work had already run against its
existence as a gate.

## Network-denial mechanism (T006; FR-018; SC-011)

Rank-1 mechanism selected and applied for all 11 gated derivation/probe
invocations: **`podman run --network none`** (client 5.8.5), pinned image
`docker.io/oven/bun:1.3.14`. Live-verified as genuinely blocking (an in-container
`fetch()` to an external host failed with a connection error), not merely
"no network calls happened to occur." Docker daemon was unavailable;
`/usr/bin/sandbox-exec (deny network*)` was probed and confirmed functional but
not selected (syscall-filter/allowlist-based, weaker than Podman's kernel
network-namespace isolation). Allowlist-only reliance was explicitly rejected.
`network-denial.json` sha256 `13b25fe1699ad986397817bcfd890b4d66dd2038f1bdfaeeb722d1666af6dd88`.

## Credential absence (T069; FR-018)

`capture.sh`'s `podman run` invocation never passes `-e`/`--env` for any host
variable — structurally, no credential is forwarded into any container. An
empirical probe run inside the same harness confirmed the container's actual
environment contains exactly 8 standard container/runtime variables and zero
credential/bearer-token-shaped names. `credential-absence.json` sha256
`788281b3510eb0704d72aafcf4efaee841501e053ea5febbfa125b36e95ebd6d`.

## Mutation baselines (T070; FR-019; SC-012)

All 11 gated invocations show `git status --porcelain=v1` byte-identical before
and after, for both the tracked repository and whichever scratch repository was
in scope. `mutation-baselines.json` sha256
`d71b94708d71006450ad838bd7513a69311136a6c42b5a9c5f360b7165732886`.

## Negative-test / trigger-class coverage (T071)

All 13 required `AtomicFailureRecord.triggerClass` values were genuinely
exercised through the full generator pipeline (not merely asserted); the 14th,
`"other-invalid-input"`, is a deliberately-empty, non-required backstop.
`trigger-class-coverage.json` sha256
`d16643930650d7d5b97b3540b163168aa4467d6d29e08013e19e47edd63413a8`.

## Independent audit (T085)

**Reviewer verdict: PASS, zero defects.** A fresh-context sub-agent (Claude
**Opus 4.8**, no prior authoring involvement) reviewed the complete evidence
bundle (`spike-009-evidence.{json,md}`) against every FR-001–FR-038,
SC-001–SC-014, and all eleven `contracts/*.md` files, checking: (a)
JSON↔Markdown internal consistency; (b) fixed no-go→go-explicit→blocked
precedence with no skipped/reordered step; (c) `drivingEvidence` non-empty and
naming real `EvidenceBundle` fields; (d) no `releaseVehicleDecision` (or
equivalent) ever non-null; (e) all three SC-013 disclaimers present and
correctly worded; (f) all 13 required trigger classes genuinely exercised; (g)
no fabricated/assumed evidence (8 claims spot-checked and traced to source,
including an independently recomputed reference-oracle sha256 match); (h)
`blocked` is honest, non-gamed fail-closed behavior; (i) no scope creep (no
`packages/adapters/catalog-*/**`, clean tracked git status, no adoption claim).
Two non-blocking, self-disclosed observations were noted at the time T085 ran (the T014a
model-brand deviation above; one Phase 7 synthetic fixture's internal
rejection label reading `invalid-yaml-syntax` for what is actually a
duplicate-YAML-key case — the fail-closed *outcome* itself was unambiguous and
correct even before the fix below) — both transparent disclosures, not hidden defects.
**Both have since been resolved for real** (see "PR #37 review remediation" below);
`t085-independent-audit.json` carries a non-destructive `postAuditAddendum` documenting
both resolutions without altering its original PASS verdict or checks.
`t085-independent-audit.json` sha256
`13c7558a3de7b400a8304394c6c9ae60946d5d4a8049d9268dfcbe6bb2057712`.

## PR #37 review remediation

An automated Copilot code review of PR #37 returned seven findings; each was
independently verified against source before acting. Two were confirmed as reviewer
misreadings and required no change (T071's completeness — the task's own text explicitly
permits an unfavorable-but-populated result to count as populated; T085's model policy —
this session's own top-level instructions explicitly override the task-file default for
this specific role, authorizing Opus 4.8). The remaining five were genuine and are recorded
above at their own task/section: the T014a model-policy deviation (compliant Opus 4.8
rerun now authoritative, see "Reference oracle" above); the `duplicate-yaml-key` labeling
issue (root-caused to a regex in the spike's own scratch harness that never matched
yaml@2.9.0's real error text — **fixed** in scratch tooling only, not shipping code — and
both affected probes re-run under the same rank-1 Podman mechanism with full before/after
provenance; see `t045-t048-us5-run.remediation-rerun.*` and
`t071-trigger-class-coverage.remediation-rerun.*` in the scratch transcripts directory);
T051/T055 checkbox honesty (`tasks.md` now correctly `- [ ]` — both real-corpus derivations
deterministically fail-closed-rejected, so no populated `SnapshotEnvelope` could ever exist;
T052/T056 scale-evidence and the driving `blocked` verdict are unaffected); and a T076
"correctly skipped in its entirety" annotation added for reviewer legibility (no functional
change — `recommendation` was and remains `null`, matching feature008's own convention).
**None of these corrections change the recorded `blocked` verdict**, which remains driven
solely by the pre-existing dual-corpus `duplicate-canonical-id` defect and the resulting
envelope-population shortfall.

**Third round (auto-triggered by the second remediation push; two findings).** (1) The
`envelopes` field's *type* was still bare `ArtifactFileReference`, so a consumer reading the
bundle JSON alone could not tell which of two possible schemas a given `envelopes.*` target
uses without opening and sniffing the file. **Genuinely fixed**, not re-explained:
`data-model.md` §22 now types each entry as `EnvelopeOrRejectionRef = ArtifactFileReference &
{ contentShape: "snapshot-envelope" | "fail-closed-rejection-record" }`, and
`spike-009-evidence.json`'s actual `envelopes` field now carries that discriminator on all
three entries (`synthetic: "snapshot-envelope"`;
`community-plugins`/`rhdh-plugins: "fail-closed-rejection-record"`, each matching its file's
independently-verified actual top-level shape). `spike-009-evidence.json` was re-hashed
accordingly (see below); `spike-009-evidence.md` and `verdict.json` are byte-unchanged — the
Markdown mirror narrates `envelopes` rather than restating its per-entry structure, so no
JSON↔Markdown divergence is introduced, and `verdict.json` does not embed `envelopes`.
(2) The frozen-oracle sort-order finding was **not** remediated by correcting the oracle —
see "Limitations and scope" below, where it is recorded as an explicit carry-forward blocker.
**Neither round-three item changes the recorded `blocked` verdict, its `blockedShortfall`, or
any underlying evidentiary fact.**

## Full evidence bundle (scratch-only; hashes recorded here for integrity)

`spike-009-evidence.json` sha256
`639154ce8e70aa908902a8585e1f26971171f178b6888992dc057e4fa91cf246` · `spike-009-evidence.md`
sha256 `38bc6a21987d25007822deaef0b200fce718d992d4b4fde3f10c7d976005e30c` · `verdict.json` sha256
`75edda1a75b5e57924b553b76886a8d14b4476c21c34360e7d9448289b240e60`. **PR #37 second-round
review remediation:** `drivingEvidence` was missing `envelopes` despite
`blockedShortfall = "envelope-or-scale-evidence-incomplete"` naming that field directly and
the `t074BlockedEvaluation` detail citing both non-synthetic `envelopes` targets as the
shortfall's specific evidence; `envelopes` has been added. **PR #37 third-round review
remediation:** `spike-009-evidence.json`'s hash above is the recomputed value after the
`contentShape` discriminator was added to its `envelopes` entries (superseding
`7dbd0dd389a99b8322c9fe31a8638919cef980a2add897f829ef6995d35eb84c`, recorded before that
fix); `spike-009-evidence.md` and `verdict.json` were not modified in that round and their
hashes are unchanged. All three values above are the current, recomputed ones. These
files, all raw transcripts (`transcripts/*.{stdout,stderr,meta.json}`), corpus checkouts, and
scratch repositories are session-artifact-only per FR-019 and are **not** part
of this repository's tracked history.

## Frozen upstream commits and tool versions (T005–T013)

`backstage/backstage@1121a4facd9e321179d0402c3f355e4a649e84d9`,
`backstage/community-plugins@92e9e4e09c76cc57f3475029b73e5ec84498a459`,
`redhat-developer/rhdh-plugins@3b355ddfedb23c6656bd9effc8510f9926b765c1` — all
re-verified reachable via `git fetch --depth=1` + `git cat-file -e` (never
`ls-remote`/branch-HEAD substitution) before any work began. Toolchain: Bun
1.3.14, `yaml` 2.9.0, `picomatch` 4.0.5 (restricted positive-only dialect,
overlap-as-union).

## Limitations and scope

This spike is **non-shipping**: it introduces no `packages/adapters/catalog-*`
package, authorizes no production catalog adapter, and makes no release-vehicle
or version/tag decision. Its `blocked` verdict does not satisfy, cause, or
substitute for optional external/community validation or optional
externally-validated maturity (ADR-0014 rung 3), regardless of the recorded
outcome — Phase 6 remains exactly landed/reference-verified as before, rung 3
still open. Any future change to `spec.md`/`plan.md`/`tasks.md` that this
spike's findings might suggest is a separate, later, explicitly-scoped
follow-up decision — not something this execution performed or decided
unilaterally.

### Carry-forward blocker: the frozen reference oracle is not reusable as-is

The frozen `reference-oracle.json`'s `positive` case records
`expectedOutcome.derivedPathPatterns` in **input order**
(`["packages/payments/**", "apis/payments/**"]`) rather than the
`compareCodeUnits`-sorted order `owned-paths-annotation.md` §3 mandates for the
`explicit-paths` derived array (correct: `["apis/payments/**",
"packages/payments/**"]`). This was surfaced by the compliant Opus 4.8 T014a
rerun and is restated here — rather than left only in that task's prose — so it
cannot be silently inherited.

**Why it was not corrected in this run.** The oracle was authored, frozen, and
hashed before any generator output existed; its sha256
`8f0e260fbf86eadf495726f6f8d6f569586c75ed0f74cafa1b5c8411610ae9d5` has never
changed. Editing it *now*, after generator/derivation work (T017+) has already
run against its existence as a gate, is precisely the backfilling of a frozen
pre-output artifact that FR-025/T014a exist to prevent. The defect also changes
no case class, no three-state discriminator, no accept/reject outcome, and no
recorded result: none of this spike's scratch tooling diffs generator output
against these named oracle fixture files, and the recorded verdict is `blocked`
— already the most conservative of the three outcomes, and driven solely by the
pre-existing `duplicate-canonical-id` corpus defect.

**What it blocks.** The oracle is therefore **not** a valid ground truth to
reuse as-is. Any future feature009 execution, and any landing PR, MUST begin
with a fresh **T014 → T014a cycle** — correct the ordering, re-freeze, re-hash,
and obtain a new independent pre-output audit — **before** producing any
generator-derived output. Reusing the current oracle without that cycle would
carry a known-wrong expected result forward into a run whose outcome could
actually depend on it.

### Correction 1: placeholder-descriptor counts ("five", asserted of each corpus)

**What the tracked record said.** Two merged summaries understated and
mis-distributed the count of unsubstituted software-template skeleton
descriptors:

- This document (the `go-explicit` bullet above) read that the two corpora
  "**each** contain a genuine, pre-existing `duplicate-canonical-id` defect
  (**five** unsubstituted Backstage software-template skeleton files …)". The
  defect is the universal quantifier **"each"**, which distributes "five" across
  both corpora — false for `rhdh-plugins`. The corrected sentence retains "each"
  only over *"contain a … defect"* (both corpora do) and attributes the counts
  separately per corpus, so no number is distributed.
- The root [`plan.md`](../../../plan.md) Phase 8 row read "(**five**
  unsubstituted Nunjucks template skeletons sharing a literal `metadata.name`
  placeholder)", stated once for both corpora together.

**What the evidence records, and where it is itself imprecise.** Cross-checked
between the `finding` field of each raw scratch envelope and a direct read of
both pinned corpora (see "Basis of this re-derivation" below). **Two different
quantities have to be kept apart**, and the merged record conflates them:

| Corpus | Pinned commit | Descriptors sharing the identical `${{ values.name \| dump }}` form (the collision cohort) | Unsubstituted placeholder descriptors of any form |
|---|---|---|---|
| `community-plugins` | `92e9e4e09c76cc57f3475029b73e5ec84498a459` | **5** | **5** |
| `rhdh-plugins` | `3b355ddfedb23c6656bd9effc8510f9926b765c1` | **9** | **11** |
| **Total** | — | **14** | **16** |

The right-hand column was recorded as 10 and 15 until a full re-enumeration
found an eleventh `rhdh-plugins` placeholder descriptor; see "Correction 2"
below. The collision cohort is unaffected.

The two columns diverge for one reason. The `rhdh-plugins` envelope `finding`
enumerates ten workspaces — `dcm`, `homepage`, `app-defaults`, `global-header`,
`quickstart`, `bulk-import`, `adoption-insights`, `scorecard`, `translations`,
`cost-management` — and describes all ten as "sharing the identical, literal,
unsubstituted Nunjucks placeholder `${{ values.name | dump }}`". **That sentence
is internally inconsistent.** The `bulk-import` descriptor carries
`${{ values.name }}`, without the `| dump` filter. It is equally unsubstituted,
but it is a *different string*, so it canonicalizes to a different id and cannot
participate in the same duplicate group. The collision cohort is therefore
**nine** in `rhdh-plugins`, not ten.

**Basis of this re-derivation.** The counts above are not taken from the envelope
`finding` text alone. All placeholder descriptors were read directly from the two
pinned corpora — `community-plugins` at
`92e9e4e09c76cc57f3475029b73e5ec84498a459` and `rhdh-plugins` at
`3b355ddfedb23c6656bd9effc8510f9926b765c1` — and their literal `metadata.name`
values compared. Anyone can reproduce this by fetching the same files at
the same two commits. In `community-plugins`, all five (`rbac`, `topology`,
`mend`, `mta`, `ocm`) carry `${{ values.name | dump }}`, so "five" is confirmed
correct for that corpus on both measures. In `rhdh-plugins`:

| Workspace | Literal `metadata.name` | In collision cohort |
|---|---|---|
| `dcm` | `${{ values.name \| dump }}` | yes |
| `homepage` | `${{ values.name \| dump }}` | yes |
| `app-defaults` | `${{ values.name \| dump }}` | yes |
| `global-header` | `${{ values.name \| dump }}` | yes |
| `quickstart` | `${{ values.name \| dump }}` | yes |
| **`bulk-import`** | **`${{ values.name }}`** | **no — different string** |
| `adoption-insights` | `${{ values.name \| dump }}` | yes |
| `scorecard` | `${{ values.name \| dump }}` | yes |
| `translations` | `${{ values.name \| dump }}` | yes |
| `cost-management` | `${{ values.name \| dump }}` | yes |
| **`orchestrator`** | **`${{ values.entityName }}`** | **no — different string** |

The `orchestrator` row is not in the envelope's enumeration at all; see
"Correction 2".

**Substantive consequence.** The `rhdh-plugins` duplicate group is nine
descriptors, not ten. `bulk-import` is not a member of it. It remains an
*invalid* entity name — see the named finding below, which it bears on directly
— but invalidity and duplication are distinct conditions, and this descriptor is
the corpus's own demonstration that they are.

So: **"five" is correct for `community-plugins` on both measures.** It is wrong
only as a claim about `rhdh-plugins`, and wrong as a claim about the corpora
jointly. The originally-proposed replacement "fifteen in total" was wrong on both
counts — wrong for the collision cohort, which is the quantity the surrounding
sentence is actually about, and, as Correction 2 records, wrong for the
unsubstituted total as well.

**Provenance, stated neutrally.** The "five" phrasing entered the tracked record
during PR #37 round-3 review remediation and merged in `5ff8705`; it was written
by the coordinating session as summary narrative. It does **not** originate in
the spike execution's own evidence artifacts — those record the two corpora
separately, so the "each … five" distribution is not theirs. The nine-versus-ten
imprecision above **is** in the `rhdh-plugins` envelope `finding` itself, and is
recorded here as an **observed inaccuracy in the scratch evidence**: that field
asserts all ten enumerated workspaces share `${{ values.name | dump }}`, which a
direct read of the corpus disproves. The envelope is disclosed, **not edited** —
it is frozen by convention like every other scratch artifact, and this remains a
tracked-narrative correction only. This correction therefore fixes a summary
error in one place and discloses an evidence-artifact error in the other; **no
evidence artifact is edited**, in either case.

**Scope of this correction.** Narrative only. No evidence artifact, hash,
`EvidenceBundle`, task checkbox, FR, or SC is affected, and the recorded verdict
is unchanged (`blocked`, `blockedShortfall =
"envelope-or-scale-evidence-incomplete"`). The reason for the shortfall is
identical either way: both corpora deterministically fail-closed-reject on
`duplicate-canonical-id`. Only the magnitude and distribution were misstated.

**Limit of this correction.** The placeholder descriptors were read
directly at both pinned commits, so the figures above are corpus-derived and
independently reproducible rather than inherited from the envelope text. What
was **not** done is any wider re-enumeration: no count of total descriptors,
total entity documents, or any other collision group in either corpus was
re-derived here. These figures are a targeted correction, **not** a fresh corpus
census, and nothing beyond the placeholder cohort should be read out of them.

### Correction 2: a sixteenth placeholder descriptor, in a third placeholder form

**What was wrong.** Every prior statement of these counts — the merged record,
Correction 1 above, and the draft ADR — put the unsubstituted placeholder total
at **fifteen**, with **ten** in `rhdh-plugins`. Both figures were low by one. The
true totals are **sixteen** and **eleven**.

**What was missed, and why.** Correction 1 re-derived its figures by reading the
descriptors the envelope `finding` enumerated. That is a closed list, so it could
correct the *classification* of those files but could never discover a file the
finding never mentioned. This descriptor is exactly that case:

| Path | `kind` | `metadata.name` |
|---|---|---|
| `workspaces/orchestrator/entities/greet-with-new-component/skeleton/catalog-info.yaml` | `Component` | `${{ values.entityName }}` |

It sits at `entities/<name>/skeleton/`, not the
`examples/template/content/` path shared by the other ten `rhdh-plugins`
placeholders, and it carries a **third** distinct placeholder form —
`${{ values.entityName }}`, not `${{ values.name }}` or
`${{ values.name | dump }}`. It is inside the 38-file corpus that this index's
own file/document finding records, and it was found by enumerating every
`metadata.name` in both corpora rather than only the enumerated subset.

**Corrected figures**, from a full enumeration of both corpora at their pinned
commits:

| Corpus | `${{ values.name \| dump }}` | `${{ values.name }}` | `${{ values.entityName }}` | Unsubstituted total |
|---|---|---|---|---|
| `community-plugins` | 5 | 0 | 0 | **5** |
| `rhdh-plugins` | 9 | 1 | 1 | **11** |
| **Total** | **14** | **1** | **1** | **16** |

**What does not change.** The **collision cohort is still fourteen** — five and
nine — because the new descriptor's placeholder is a distinct string that
canonicalizes to a distinct id, exactly like `bulk-import`. No
`duplicate-canonical-id` grouping, trigger class, hash, task checkbox, FR, SC,
or the recorded `blocked` verdict is affected. The shortfall's cause is
unchanged.

**Why it is recorded as its own correction.** This is the third revision of the
same figure, and the pattern is worth naming rather than quietly fixing again.
Each prior attempt narrowed its evidence to the source it inherited: first the
summary narrative, then the envelope `finding`'s enumeration. Both were faithful
to their source and both were wrong, because the source was the wrong object to
be faithful to. The count is a property of the corpus, and only a full
enumeration of the corpus can establish it. Correction 1's own stated limit
anticipated this — it said no wider re-enumeration had been performed and that
nothing beyond the placeholder cohort should be read out of its figures. That
limit was correct and is what this correction discharges.

**Basis.** Full enumeration of every YAML document in every
`basename == "catalog-info.yaml"` file in both corpora at
`92e9e4e09c76cc57f3475029b73e5ec84498a459` and
`3b355ddfedb23c6656bd9effc8510f9926b765c1` — 156/167 and 38/39 respectively,
zero parse errors, every document carrying a string `metadata.name`. The same
enumeration produced the two named findings recorded below, and is subject to
the same three limits stated there.

**Method, stated precisely because a looser one can get a different answer.**
Each document was parsed and the value read **structurally, from the
`metadata.name` path of the parsed document object**. It was *not* obtained by
scanning for `name:` keys in the file text. That distinction is worth stating
because it is one of two independent choices that determine these figures — but,
as the table below shows, it is **not** individually sufficient to change the
placeholder count. Only combined with the looser file matcher does it over-count.

The concrete trap is
`workspaces/bulk-import/examples/template/create-pr-with-catalog-info.yaml`. A
text scan for `name:` lines carrying a `${{ … }}` placeholder matches line 46 of
that file, `name: ${{ parameters.name }}` at ten-space indent — which is a
scaffolder **step input**, at `spec.steps[].input.values.name`, not an entity
identity. The document is `kind: Template` and its actual `metadata.name` is
`create-pr-with-catalog-info`: substituted, valid, and not a placeholder at all.
A scan that makes **both** of the mistakes below reports **seventeen**
placeholder descriptors instead of sixteen.

That single file carries two mistakes that are independent **in kind** but, for
this count, **conjunctive in effect** — both are required to reach seventeen:

1. **Path matching.** It is `endswith("catalog-info.yaml")` but not
   `basename == "catalog-info.yaml"`, so it falls outside the 38-file set under
   the strict matcher these figures use — the same distinction limit 1 of the
   file/document finding below records.
2. **Key extraction.** Even when the file *is* included, structural extraction
   of `metadata.name` rejects the line, because that document's `metadata.name`
   is `create-pr-with-catalog-info` and carries no placeholder at all.

Executed across the `rhdh-plugins` corpus at
`3b355ddfedb23c6656bd9effc8510f9926b765c1`, all four combinations give:

| File set | Extraction | Placeholder descriptors |
|---|---|---|
| `basename ==` (38) | structural | 11 |
| `basename ==` (38) | text scan | 11 |
| `endswith` (39) | structural | 11 |
| **`endswith` (39)** | **text scan** | **12** |

**Only the fourth row is wrong.** Either mistake alone still yields 11, and the
three correct combinations agree on the members as well as the count, not merely
by coincidence of totals.

Two consequences, both worth stating because they differ:

- **For the placeholder counts, the mistakes are conjunctive.** Neither alone
  corrupts them.
- **For the file and document counts, path matching alone is sufficient.**
  `endswith` gives 39/40 rather than 38/39 regardless of how names are
  extracted, because that figure counts files and documents rather than names.

So the two quantities fail differently, and both the matcher choice and the
extraction method still have to be stated whenever either is quoted — not
because either mistake alone breaks every figure, but because which figure each
one breaks is not obvious.

**On depth heuristics.** An indentation-aware scan *can* separate these two
lines: the real `metadata.name` sits at 2 spaces and the step input at 10. The
argument for structural extraction is therefore not that depth is incapable in
principle, but that it is fragile — it depends on formatting YAML does not
constrain, and would not survive a flow mapping, a differently-indented file, or
a `metadata` block nested inside a list. Structural extraction is correct by
construction rather than by the corpus happening to be formatted conveniently.

### Named finding: `metadata.name` is canonicalized without ever being validated

Recorded here as a standing, named limitation alongside the carry-forward
blocker above. **This finding is independent of the recorded verdict and of any
future re-run**; it is a gap in the frozen contract text that exists whether or
not feature009 is ever executed again.

**The gap.** [`contracts/entity-identity.md`](../contracts/entity-identity.md)
§1 defines canonicalization as exactly two steps — default the namespace, then
lowercase `${K}:${NS}/${N}` in full. There is **no admissibility or
validation step anywhere ahead of it.** Whatever string appears at
`metadata.name` is accepted as a name and folded into a canonical ID. Nothing in
`specs/009-catalog-binding-viability/**` references Backstage's own entity-name
validators at any point.

**Why that is a defect, on Backstage's own terms.** At the pinned research
commit `1121a4facd9e321179d0402c3f355e4a649e84d9`, `makeValidator.ts` binds
`isValidEntityName := KubernetesValidatorFunctions.isValidObjectName`, whose
predicate is `/^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/` with a 63-character
limit, and `FieldFormatEntityPolicy` applies it to `metadata.name` as a
**required** field. All three unsubstituted forms present in the corpora fail
that predicate on character class — in `${{ values.name | dump }}` the `$`, `{`,
`}`, `|` and spaces are all outside the permitted set, and `${{ values.name }}`
and `${{ values.entityName }}` fail on the same grounds minus the pipe — while
ordinary descriptor names pass it unchanged.

**The consequence.** Every one of these descriptors fails Backstage's own
`metadata.name` validator — all sixteen unsubstituted ones: the fourteen
carrying `${{ values.name | dump }}`, the one carrying `${{ values.name }}`, and
the one carrying `${{ values.entityName }}`, since each fails on character
class. This spike's contract instead accepts each one as a well-formed name,
lowercases it, and concatenates
it. For the fourteen that share a string, they then collide with each other and
the collision is reported as `triggerClass: "duplicate-canonical-id"`. The
fail-closed rejection itself is correct and required by §3; what is imprecise is
the *classification*. A descriptor that is not a valid Backstage entity at all is
being characterized as a duplicate-identity condition between valid entities.

**`bulk-import` and `orchestrator` are the sharper illustration.** Their
placeholders are `${{ values.name }}` and `${{ values.entityName }}` rather than
`${{ values.name | dump }}`, so each canonicalizes to a *unique* id and collides
with nothing. Both are exactly as invalid as the other fourteen under
`isValidObjectName`, but the contract has **no mechanism of any kind** that would
notice. The duplicate rule catches the fourteen only incidentally — as a side
effect of their sharing a string — and there is nothing behind it. This is why
the gap is a contract gap rather than a reporting one: duplicate detection is
not, and was never intended to be, a validity check, and the corpus contains two
descriptors that prove the conditions come apart.

**What this finding does and does not assert.** It asserts that the contract
canonicalizes unvalidated input and that this mis-classifies at least one real,
recorded condition. It does **not** assert that adding validation would change
the recorded verdict, satisfy SC-010, unblock this spike, authorize a re-run, or
sanction any production adapter — none of those follow from it, and none are
claimed here. Whether to close the gap, and how, is a separate decision requiring
its own explicitly-scoped authorization; a draft ADR proposing one approach is
under maintainer review and is **not** ratified.

### Named finding: two `community-plugins` names fail only on length

Independently verified by a fresh-context `claude-opus-5` reviewer with no
authorship of this record, and re-derived here by direct enumeration of both
pinned corpora. Recorded because it is a second, structurally different way the
unvalidated-`metadata.name` gap above manifests in real data — and one that no
duplicate-detection rule could ever surface.

Exactly **two** descriptors in `community-plugins` at
`92e9e4e09c76cc57f3475029b73e5ec84498a459` carry a `metadata.name` longer than
the 63-character limit `isValidObjectName` enforces. Both are `kind: Component`.
Both satisfy the character-class regex completely and fail **only** on length:

| Path | `metadata.name` | Length |
|---|---|---|
| `workspaces/azure-devops/plugins/azure-devops-backend/catalog-info.yaml` | `backstage-plugin-catalog-backend-module-azure-devops-annotator-processor` | 72 |
| `workspaces/pingidentity/plugins/auth-backend-module-pingfederate-provider/catalog-info.yaml` | `backstage-community-plugin-auth-backend-module-pingfederate-provider` | 68 |

`rhdh-plugins` at `3b355ddfedb23c6656bd9effc8510f9926b765c1` has **zero**
over-length names; its longest is 45 characters
(`red-hat-developer-hub-bulk-import-backend-api`).

**Why this pair is the cleanest case.** Fourteen of the placeholder descriptors
recorded above at least collide, so the contract aborts for an adjacent reason.
The two over-length names do not — and neither, as it happens, do the
`bulk-import` and `orchestrator` placeholders, for the same underlying reason.
Each canonicalizes to a unique id, participates in no duplicate group, and
passes through the contract's every check while being an entity Backstage's own
validators reject. There is no incidental mechanism that catches any of them.
The over-length pair is the cleanest illustration only because it fails on a
different predicate clause, so it cannot be dismissed as an artefact of
un-rendered templating.

**"Over 63" is not the count of invalid names.** The two above are the
descriptors failing on *length*. In `community-plugins` the total failing
`isValidObjectName`
is **seven** — these 2 on length, plus the 5 template placeholders on character
class. In `rhdh-plugins` it is **eleven**, all on character class, none on
length. Do not restate "2" as a count of invalid names.

### Named finding: descriptor files and entity documents are not the same count

Independently verified by a fresh-context `claude-opus-5` reviewer and
re-derived here. Recorded because several figures in this spike's tracked
narrative are *file* counts, and the corpora contain multi-document descriptor
files, so file counts understate the entity population:

| Corpus | Pinned commit | Files | Entity documents | Δ | Parse errors |
|---|---|---|---|---|---|
| `community-plugins` | `92e9e4e09c76cc57f3475029b73e5ec84498a459` | 156 | 167 | +11 | 0 |
| `rhdh-plugins` | `3b355ddfedb23c6656bd9effc8510f9926b765c1` | 38 | 39 | +1 | 0 |

The `community-plugins` delta comes from exactly 11 two-document files; the
`rhdh-plugins` delta from a single one,
`workspaces/bulk-import/plugins/bulk-import-backend/catalog-info.yaml`. Both
repository trees were retrieved with `truncated: false`. Every document has a
string `metadata.name`; none is absent or non-string.

Three limits, all of which must travel with these figures:

1. **The 38/39 figure holds only for `basename == "catalog-info.yaml"`.** A
   looser `endswith("catalog-info.yaml")` matcher additionally admits
   `workspaces/bulk-import/examples/template/create-pr-with-catalog-info.yaml`,
   giving 39/40 instead. `community-plugins` is unaffected — both matchers
   return 156. State the matcher or the `rhdh-plugins` figure is wrong by one on
   both axes. That same file is also the source of a second, independent
   over-count trap in the placeholder figures; see "Method, stated precisely"
   under Correction 2 above.
2. **These counts enumerate the full git tree, not the spike's input manifest.**
   Exact agreement with the recorded figures on both corpora is strong evidence
   that the two scopes coincide, but it is not proof, and neither the reviewer
   nor this record asserts it. Anything depending on the manifest scope
   specifically must establish it separately.
3. **Two parsers, two methods, same answer.** The reviewer used PyYAML
   `compose_all` counting non-`None` nodes; this re-derivation used the `yaml`
   npm package's `parseAllDocuments` filtered on `contents !== null` — the same
   library family the spike's own scratch tooling used. Agreement across two
   independent parsers is a genuine cross-check, but both apply the same
   *definition* of "document", so a disagreement about that definition would not
   have been caught by either. Both also extracted names structurally, from the
   parsed `metadata.name` path. Under the strict file matcher used here a text
   scan happens to return the same answer, but that is a property of these
   particular files rather than a guarantee; see the four-way table under
   Correction 2.

**Scope.** Both findings above are narrative additions to this index. Neither
changes any evidence artifact, hash, `EvidenceBundle`, task checkbox, FR, SC, or
the recorded verdict, which remains `blocked` with `blockedShortfall =
"envelope-or-scale-evidence-incomplete"`. Neither authorizes a re-run, a spike
task, a `specs/009-**` contract amendment, a generator change, or any production
adapter.
