# Quickstart Validation Guide: Catalog Entity-to-Path Binding Compatibility Viability Spike

**Feature**: `009-catalog-binding-viability` | **Companion to**: [plan.md](./plan.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

> ⛔ **NOT RUNNABLE TODAY.** This guide describes the steps a *future*
> execution session runs, only after **both** gates in `spec.md`'s banner
> have cleared:
>
> 1. **Phase 6 gate** — `specs/007-arb-queue/spec.md` SC-004, tracked as
>    `specs/007-arb-queue/tasks.md` **T048**/**T049**. **Open as of this
>    plan's authoring** (both unchecked as of `48087e8`).
> 2. **Independent-adopter gate** — an adopter other than the maintainer
>    authoring real `adrkit.io/owned-paths` annotations against their own
>    real catalog and providing a hand-labeled entity/path oracle.
>    **Outstanding.**
>
> The catalog-governance precondition this spec once tracked separately is
> **satisfied**, not outstanding (ADR-0012 `accepted`, ADR-0013 `accepted`)
> — see `plan.md`'s banner for the full disposition. If you are reading this
> and gate 1 or gate 2 is still open, **stop**. Do not run any command
> below. This guide's existence is advance scoping, not authorization (root
> `plan.md`'s "Advance scoping ... is explicitly permitted" note).

## Prerequisites (once both gates clear)

- This repository cloned, on a disposable scratch branch/worktree — never
  `main` (FR-019/A7).
- A separate scratch directory outside any git-tracked clone of
  `mbeacom/adrkit`, for general fixture sources (`research.md` R2 item 1).
- At least two standalone, freshly `git init`'d scratch repositories with
  their own independently-configured `origin` remotes — never linked
  worktrees of this repository — for User Story 2's repository-mismatch
  tests and User Story 7's repository-isolation check (`research.md` R2
  item 2; `contracts/input-manifest.md` §3.1).
- Independently re-verify the three pinned commits from FR-001 are still
  reachable at their exact SHAs (Step 0 below) before touching anything
  else.

## Step 0 — Re-Verify the Frozen Research Inputs (FR-001)

```bash
set -euo pipefail   # fail-fast: any failed command — including `git init` or
                    # `remote add` inside the helper below — halts this preflight
                    # immediately; never continue past a failure, never suppress
                    # one with `|| true`.

# Correctness note: `git ls-remote <url> <sha>` matches against *ref names*
# (branches/tags), not arbitrary commit objects, so it cannot reliably confirm
# that a given commit SHA is reachable unless that exact SHA also happens to
# be a ref tip — which none of these three necessarily are. The reader-test
# review of this quickstart's earlier draft found this exact defect (that
# earlier draft additionally swallowed failures with `|| true`). The
# corrected procedure below actually fetches each commit object into a local
# mirror and confirms its existence directly, per FR-001/FR-018 (this
# one-time preflight fetch is the explicitly-permitted networked acquisition
# step FR-018 itself carves out, distinct from every later derivation run,
# which must run fully offline).

verify_pinned_commit() {
  local url="$1" sha="$2" mirror_dir="$3"
  git init --bare "$mirror_dir" >/dev/null || {
    echo "FAIL: could not initialize bare mirror at $mirror_dir" >&2; return 1;
  }
  git -C "$mirror_dir" remote add origin "$url" || {
    echo "FAIL: could not add origin $url to $mirror_dir" >&2; return 1;
  }
  # Fetch the exact commit object directly, without assuming it is any ref's tip.
  git -C "$mirror_dir" fetch --depth=1 origin "$sha" || {
    echo "FAIL: could not fetch $sha from $url" >&2; return 1;
  }
  # Confirm the object actually exists and is a commit (not merely that the
  # fetch reported success for some other ref).
  git -C "$mirror_dir" cat-file -e "${sha}^{commit}" || {
    echo "FAIL: $sha is not a reachable commit object in $url" >&2; return 1;
  }
  echo "OK: $sha confirmed reachable as a commit in $url"
}

verify_pinned_commit https://github.com/backstage/backstage.git \
  1121a4facd9e321179d0402c3f355e4a649e84d9 /tmp/verify-backstage
verify_pinned_commit https://github.com/backstage/community-plugins.git \
  92e9e4e09c76cc57f3475029b73e5ec84498a459 /tmp/verify-community-plugins
verify_pinned_commit https://github.com/redhat-developer/rhdh-plugins.git \
  3b355ddfedb23c6656bd9effc8510f9926b765c1 /tmp/verify-rhdh-plugins
```

Each `verify_pinned_commit` invocation MUST print `OK: ...` — any `FAIL: ...`
output, any non-zero exit from `git fetch`/`git cat-file -e`, or any other
error MUST halt this step immediately (never proceed past a `FAIL`, and
never suppress a failure with `|| true`, which the reviewed earlier draft of
this step incorrectly did).

**If any of the three does not resolve to the exact SHA above**: STOP. Do
not proceed. The spike MUST fail closed and require spec re-ratification
(`contracts/structural-fixtures-and-corpora.md` §1) rather than substitute a
different commit's contents.

## Step 1 — User Story 1: Prove Option A's Annotation Contract (`contracts/owned-paths-annotation.md`, `contracts/glob-dialect.md`)

In the general scratch directory, author the fixture set named in
`spec.md`'s Acceptance Scenarios 1–8: one valid multi-pattern annotation; one
fixture per rejection reason (`empty`, `leading-slash`,
`absolute-or-drive-or-unc`, `backslash`, `nul-or-control-char`, `brace`,
`bracket`, `parenthesis`, `comma`, `leading-bang`, `traversal-segment`,
`empty-segment`, `disallowed-character` — e.g. a pattern containing `@` or
`~` — and `malformed-double-star` — e.g. `a**b`); the case-only duplicate
**canonical-ID** pair (`Component:Default/Payments` /
`component:default/payments` — two entities whose own primary IDs collide,
classified `"duplicate-canonical-id"` per `contracts/entity-identity.md` §3,
never `"duplicate-canonical-ref"`, which is reserved for an alias colliding
with a different entity's ID or another alias); a descriptor omitting
`metadata.namespace`; an `explicit-empty` (`[]`) fixture; an
`annotation-absent` fixture; the three-way alias-collision fixture (User
Story 1 Acceptance Scenario 7, which **does** produce
`"duplicate-canonical-ref"` classifications, since it collides an alias
against another entity's ID/alias, not two primary IDs against each other);
and the two-distinct-entities overlapping-glob fixture (Acceptance
Scenario 8).

Run each through the decode-then-validate pipeline (`contracts/owned-paths-annotation.md`
§1) and the fixed-order validator (`contracts/glob-dialect.md` §3) **three or
more times**. Confirm byte-identical sorted/deduplicated output every time
for valid fixtures; confirm each rejection fixture reports exactly the one
rule-specific reason `research.md` R9's order predicts; confirm the
case-only duplicate-ID pair is a `"duplicate-canonical-id"` failure, never
silently merged; confirm the default-namespace descriptor canonicalizes using
`"default"` before lowercasing; confirm `explicit-paths`/`explicit-empty`/
`annotation-absent` are recorded as three distinct states.

Separately, run the real `backstage/community-plugins` corpus at the pinned
commit through the same pipeline: confirm all 156 sampled descriptors are
recorded `annotation-absent`, and the 23/156 and 0/156 figures
(`contracts/structural-fixtures-and-corpora.md` §6) are recorded verbatim.

**Acceptance check**: matches `spec.md` User Story 1, all 8 Acceptance
Scenarios; populates `EvidenceBundle.parsingValidationResults` and
`identityCanonicalizationResults` (`data-model.md` §22).

## Step 2 — User Story 2: Repository Boundary and Whole-Operation Atomicity (`contracts/input-manifest.md`, `contracts/atomic-fail-closed.md`)

*(Independent of Step 1 — may run in either order; this story builds its own
standalone repositories and its own six-entity batch, not Step 1's fixture
set.)*

1. `git init` a standalone scratch repository (`contracts/input-manifest.md`
   §3.1), configure `git remote add origin
   github.com/mbeacom/adrkit-spike-fixture` (a throwaway identity per A4,
   distinct from this repository's own real `github.com/mbeacom/adrkit`),
   and make one commit.
2. Read that repository's actual `origin`/`HEAD` via separate git tooling;
   construct one input manifest (`contracts/input-manifest.md` §1) declaring
   the matching, normalized repository ID/revision.
3. Run generation against five valid synthetic entities. Confirm one
   complete envelope is produced naming that exact repository ID/revision.
4. Add a sixth entity with a duplicate canonical ID (reusing Step 1's
   case-only duplicate pattern). Run generation once over all six. Confirm
   the run exits non-zero and **no snapshot** — not even one covering the
   five otherwise-valid entities — was produced or is usable.
5. Construct manifests each violating exactly one manifest-level rejection
   class: the three `contracts/input-manifest.md` §2 version/capability classes
   (`manifestSchemaVersion: "2"`, `requestedSnapshotSchemaVersion: "2"`, a
   `requiredCapabilities` entry other than `"pathOwnership"`), plus §4's
   incomplete-required-source class (a listed source path/digest absent from
   the actual fixture set), plus §1's invalid-manifest-shape class (a
   structurally malformed manifest). Confirm each aborts non-zero before
   deriving any entity's paths.
6. Construct a second standalone scratch repository (or reconfigure the
   first) whose declared manifest repository ID/revision does **not** match
   its actual `origin`/`HEAD`. Confirm generation aborts on repository
   mismatch before deriving any entity's paths.

**Acceptance check**: matches `spec.md` User Story 2, all 5 Acceptance
Scenarios; populates `EvidenceBundle.atomicFailureRecords` and
`repositoryIdentityChecks` (`data-model.md` §22).

## Step 3 — User Story 3: B/C Cardinality and Synthetic Precision (`contracts/comparison-heuristics.md`)

Apply the descriptor-parent (B) and repository-root (C) heuristics to every
sampled descriptor in both pinned corpora; confirm every output row carries
`authoritativeLabel: "non-authoritative"`; reproduce the four real-corpus
findings in `contracts/comparison-heuristics.md` §2's table verbatim.

Separately, build the synthetic labeled entity × changed-file matrix (at
least 10 entities, both a labeled-true and labeled-false example per
entity), apply B and C, classify every pair TP/FP/TN/FN, and compute
`precision`/`falsePositiveRate` per heuristic — recording
`"undefined-for-this-heuristic-on-this-matrix"` for any zero-denominator
metric, per `contracts/comparison-heuristics.md` §3's worked example, and
confirming this never suppresses the other heuristic's defined metric on the
same matrix.

**Acceptance check**: matches `spec.md` User Story 3, all 5 Acceptance
Scenarios; writes `comparison-matrix.json` (referenced by
`EvidenceBundle.comparisonMatrix`).

## Step 4 — User Story 4: Option D No-Effect Confirmation (`contracts/comparison-heuristics.md` §4)

Build `CatalogSnapshot` fixtures with Option-D-normalized `refs` and no
`paths`. Feed them, alongside one Option A entity with a populated `paths`
array covering the same changed-file list, to the **unmodified**
`resolveAffects`/`matchEntityPattern` (`packages/core/src/affects/`) in one
pass. Confirm the Option-D-only entity returns `{ matched: false }` with no
`affects-unresolvable` finding attached, while the Option A entity in the
same run does match.

**Acceptance check**: matches `spec.md` User Story 4, both Acceptance
Scenarios; populates `EvidenceBundle.identityOnlyResults`.

## Step 5 — User Story 5: Structural Edge Cases (`contracts/structural-fixtures-and-corpora.md`, `contracts/glob-dialect.md` §4)

Author and run the three required synthetic fixtures — multi-document,
duplicate-YAML-key, `Location`-not-followed — per
`contracts/structural-fixtures-and-corpora.md` §2–§4. Separately, directly
execute `picomatch@4.0.5` with the frozen options against `.github/**` /
bare `**` or `packages/**` patterns and a `.github/workflows/ci.yml`
changed-file path, confirming the exact results in
`contracts/glob-dialect.md` §4's worked-example table.

**Acceptance check**: matches `spec.md` User Story 5, all 4 Acceptance
Scenarios; populates `EvidenceBundle.structuralEdgeCaseFixtures` and
`dotfilePolicyConfirmation`.

## Step 6 — User Story 6: Deterministic Ordering, Envelopes, and Scale Evidence (`contracts/snapshot-envelope.md`, `contracts/scale-and-security-measurement.md`)

For **each** of the three FR-009 passes (community-plugins-derived,
rhdh-plugins-derived, primary synthetic) — separately, never merged:

1. Construct that pass's own input manifest and repository identity.
2. Run the full derivation (Option A plus the B/C/D measurements) **3 or
   more times** against identical fixture inputs. Diff the outputs — all
   runs for that pass must be byte-identical (cross-pass byte-identity is
   neither expected nor required).
3. Produce that pass's own populated `SnapshotEnvelope`
   (`contracts/snapshot-envelope.md` §1), from an actual run — never a
   schema sketch.
4. Measure and record that pass's scale evidence per
   `contracts/scale-and-security-measurement.md` §2 (fixed workload, 1
   discarded warm-up + ≥5 retained iterations, median + full iteration list,
   environment recorded).

Aggregate all three passes' scale evidence into one combined summary, each
figure attributed to its originating pass, per
`contracts/scale-and-security-measurement.md` §3.

**Acceptance check**: matches `spec.md` User Story 6, all 3 Acceptance
Scenarios; writes the three `snapshot-envelope.*.json` and
`scale-evidence.json` files (referenced by `EvidenceBundle.envelopes` and
`EvidenceBundle.scaleEvidence`).

## Step 7 — User Story 7: Malformed/Tampered/Stale/Misidentified Rejection and Repository Isolation (`contracts/snapshot-envelope.md` §2–§6)

Using the synthetic pass's valid envelope from Step 6 as the base:

1. Construct **five separate** malformed/unsupported copies — one file per
   mutually-exclusive malformation kind (`contracts/snapshot-envelope.md`
   §2/§7: `malformed-invalid-json.json`,
   `malformed-missing-or-wrong-field.json`, `malformed-unrecognized.json`,
   `malformed-missing-source-digest.json`, `malformed-identity-only.json`).
   Confirm a consumer rejects each before any digest/revision/identity check.
   Separately, confirm an otherwise-valid envelope whose entities are all
   `annotation-absent` with `completeness.identityOnly: false` is
   **accepted**.
2. Construct a tampered copy (mutate one entity's `derivedPaths`, do not
   update the digest). Confirm a consumer that independently recomputes the
   digest rejects it, naming the mismatch.
3. Construct a stale copy (different revision, digest recomputed over its
   own actual content). Confirm rejection is attributable to staleness, not
   a digest failure.
4. Construct a wrong-repository copy (different repository ID, digest
   recomputed over its own actual content). Confirm rejection is
   attributable to identity mismatch, not a digest failure.
5. Generate a second, fully independent, valid single-repository envelope
   for a **second** throwaway repository identity. Confirm a tool querying
   across both, scoped to the first repository's ID, returns only that
   repository's entities — **neither envelope is rejected**.

**Acceptance check**: matches `spec.md` User Story 7, all 6 Acceptance
Scenarios; populates `EvidenceBundle.envelopeRejectionResults` and
`repositoryIsolationCheck`.

## Step 8 — Security/Mutation Evidence Across All Runs (`contracts/scale-and-security-measurement.md` §5)

For every derivation run/probe performed in Steps 1–7: confirm one of the
two genuinely-blocking network-denial mechanisms
(`contracts/scale-and-security-measurement.md` §5) was actually used and is
named explicitly with its exact configuration — never an
allowlisted-env-plus-static-review check alone; confirm no credential/
bearer-token environment variable was set; confirm the `git status
--porcelain` before/after capture pair is identical for every run.

**Acceptance check**: matches `spec.md` SC-011; writes `network-denial.json`
and `mutation-baselines.json` (each `MutationBaseline` carrying its `identical`
boolean and referencing its raw `git-status-captures/*.txt` pair), both
referenced by `EvidenceBundle.networkDenial` / `EvidenceBundle.mutationBaselines`.

## Step 9 — User Story 8: Compute the Verdict (`contracts/evidence-bundle-and-verdict.md`)

Follow the fixed precedence procedure exactly: check `no-go` triggers first;
if none fired, check `go-explicit`; otherwise `blocked`. Write
`spike-009-evidence.json` and `spike-009-evidence.md` to the executing
session's own scratch artifacts directory (never this repository —
`research.md` R2/R3). Populate `Verdict.gateDisclaimers` and
`authoritativeGoDistinctionStatement` unconditionally. If the verdict is
`go-explicit`, append the non-binding recommendation per
`contracts/evidence-bundle-and-verdict.md` §4, with `releaseVehicleDecision`
fixed `null`.

## Step 10 — Cleanup

- Discard (or leave, since nothing here is tracked) every scratch directory
  from Steps 1–8, including every standalone scratch repository
  (`research.md` R11).
- Confirm no scratch artifact, envelope, or evidence file was ever staged or
  committed in this repository (`git status --porcelain` at this
  repository's own root should show nothing related to this spike).
- Report the evidence bundle and verdict per `plan.md`'s Completion Report
  and this task's own reporting instruction — never open a PR, never commit
  any fixture, never claim Phase 6 landed or the independent-adopter gate
  cleared because of this spike's own result.

## What This Guide Deliberately Does Not Do

- It does not scaffold `packages/adapters/catalog-backstage` — out of scope
  for this entire feature (`spec.md` Out of Scope;
  `contracts/composition-and-release-boundary.md` §4).
- It does not itself generate `tasks.md` — that task list was already
  produced by a separate follow-up advance-scoping session (T001–T086, all
  unchecked), per root `plan.md`'s scoping exemption (this plan's own banner);
  this quickstart neither regenerates nor executes it.
- It does not decide where a future production adapter would publish or
  ship — `contracts/evidence-bundle-and-verdict.md` §4 fixes
  `releaseVehicleDecision` as permanently `null`.
- It does not claim, at any step, that completing this spike satisfies
  either remaining execution gate, the catalog-governance precondition
  (already separately satisfied), or the hardened contract's "authoritative
  `go`" status.
