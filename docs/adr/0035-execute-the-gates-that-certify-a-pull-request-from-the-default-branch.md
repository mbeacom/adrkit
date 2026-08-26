---
schemaVersion: 0.1.0
id: "0035"
title: Execute the gates that certify a pull request from the default branch
status: proposed
date: 2026-08-26
deciders: ["@mbeacom"]
tags: [ci, governance, security, supply-chain, provenance]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0006", "0007", "0014", "0016", "0026"]
affects:
  - type: path
    pattern: ".github/workflows/**"
  - type: path
    pattern: ".github/actions/**"
  - type: path
    pattern: "scripts/**"
  - type: path
    pattern: "packages/ci/**"
  - type: path
    pattern: "CODEOWNERS"
assertions:
  - id: gate-change-acknowledged
    description: >-
      A pull request that changes a gate-defining path — any file under
      .github/workflows/, .github/actions/, scripts/, or packages/ci/, or
      CODEOWNERS itself — must carry the gate-change-acknowledged label, which
      requires triage or write access to apply.
    engine: custom
    expression: gate-change-acknowledged
    input: source
    severity: error
provenance:
  authoredBy: agent-drafted
review:
  tier: arb
  tierReason: >-
    Changes how this repository's own provenance guarantees are enforced, which
    ADR-0006 treats as effectively irreversible once external contributions land,
    and adds a privileged workflow trigger to the surface ADR-0007 keeps
    mechanical and self-contained.
  queuedAt: 2026-08-26T00:00:00Z
  slaDays: 30
reviewBy: 2027-02-26
---

# ADR-0035: Execute the gates that certify a pull request from the default branch

> **Status: proposed.** Agent-drafted. It binds nothing until a human accepts it
> (ADR-0016 action item 1 shape). It does not supersede any record; it closes the
> gap #137 opened against ADR-0006's provenance claim.

## Context

Every CI gate in this repository is executed from the pull request's own
checkout, so a pull request can neuter the check that is supposed to certify it
and still produce a green required status.

**Measured, not assumed.** `pull_request` workflows run the *pull request's*
`ci.yml`, not `main`'s. PR #98's `clean-clone-builds` executed steps named
`Typecheck (network denied)`, `Build (network denied)`, and `Verify publishable
package tarballs (network denied)` — steps that exist only on that branch, while
`main`'s `ci.yml` contained zero occurrences of `network-denied`. The property is
not specific to any one gate: it holds for `check-deps`, `audit-gate`,
`check-freeze-hashes`, `check-doc-cli-versions`, `check-changelog`, the schema
emit-parity gate, the `packages/ci/dist` bundle diff, `adr check` in
`self-dogfood`, and `dco`.

**Why the obvious partial fix does not work.** Reading a script from a trusted
base revision — `git show origin/main:scripts/check-dco.ts` — leaves the
*workflow step that invokes it* under the pull request's control, so the same
change simply edits the step. A control that looks like a control and is not one
is worse than a documented gap ([ADR-0016](0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).

**Why it matters most for DCO.** A neutered `check-deps` yields a bad dependency
edge, fixable in a follow-up. A neutered sign-off check yields unsigned commits
in the permanent history of an Apache-2.0 project, and
[ADR-0006](0006-license-apache-2-and-single-monorepo.md) calls licensing "the
most irreversible decision in the project." Same mechanism, asymmetric blast
radius.

### What actually held the line before this record

Not review, and not CODEOWNERS. Read from the live configuration on 2026-08-26
rather than from memory:

| Control | State as measured |
|---|---|
| `main` ruleset (`19149458`) | `deletion`, `non_fast_forward`, `required_status_checks` only — **no `pull_request` rule**, so no review is required |
| That ruleset's bypass | `RepositoryRole` 5 (admin), `bypass_mode: always` |
| Ruleset `19149448` | `copilot_code_review` — requests a review, cannot approve or block |
| `CODEOWNERS` | `/docs/adr/`, `/schema/`, `LICENSE`, `NOTICE`, `CONTRIBUTING.md` — **not** `/scripts/` or `/.github/workflows/` |
| Fork PR workflow approval | `first_time_contributors` |
| Default workflow permissions | `read`; `can_approve_pull_request_reviews: false` |
| Actions SHA pinning | **not** required |

What remained was that merging requires write access, and that a diff disabling a
gate is visible to whoever merges. That is a real control, but it is *attention*
— and ADR-0016 Option B already argues, with evidence from its own drafting, that
attention is not the constraint.

### The option #137 did not have

The issue listed five options and judged required review the honest first move.
Its option 3 — workflows that run outside the pull request's control — was
dismissed as organization-only, and therefore unavailable to a deliberately
personal namespace (ADR-0006).

That dismissal was correct about *organization required workflows* and wrong
about the capability. `pull_request_target` runs outside the pull request's
control on any repository, personal or not, and GitHub tightened it further on
2025-12-08: the workflow file, every referenced action, and the
`actions/checkout` commit are now taken from the repository's **default branch**,
regardless of the pull request's base branch. `GITHUB_REF` resolves to the
default branch and `GITHUB_SHA` to its tip. A pull request cannot edit what runs
under this trigger — only what it is run against.

The reason this was not already in use is that `pull_request_target` is the most
commonly misused trigger in Actions: it carries the base repository's token and
secrets, so checking out pull-request code under it is the classic "pwn request."
That is an argument for using it carefully, not for not using it. `actions/checkout`
v7 — already pinned here — refuses fork pull request refs under this trigger by
default, which turns the most common form of that mistake into a build failure.

### The half a trusted workflow does not close

A required status check is matched by *name*. A pull request that cannot edit the
trusted job can still declare a job of its own with the same name and let the
later result stand. So moving the gate is necessary and not sufficient: the
`.github/workflows/` surface itself has to become something a pull request cannot
change quietly.

## Decision

**We will execute the gates whose verdict must not be editable by the pull
request they judge from the repository's default branch, and we will require an
explicit maintainer acknowledgment for any change to the surface that defines a
gate.**

Concretely, in `.github/workflows/trusted-gates.yml`, on `pull_request_target`:

1. **`trusted-dco`** runs `scripts/check-dco.ts` — `main`'s copy, from `main`'s
   workflow — over the pull request's commits. The commits are fetched as git
   *objects* and read with `git log`; they are never checked out and never
   executed. The `dco` job in `ci.yml` is retained as a faster advisory report and
   is explicitly no longer the authority.
2. **`gate-integrity`** blocks any pull request that changes
   `.github/workflows/**`, `.github/actions/**`, `scripts/**`, `packages/ci/**`,
   or `CODEOWNERS` unless the `gate-change-acknowledged` label is present.
   Applying a label requires triage or write access, so an external contributor
   cannot self-authorize, and the act is recorded in the timeline against whoever
   performed it.

Both jobs import Node builtins only and run with no `bun install`, so a hostile
or broken dependency graph cannot take them down — the property ADR-0006 action
item 2 already claimed for the sign-off gate, now also true of the job that runs
it. Both declare read-only `permissions`, use `persist-credentials: false`, and
pass untrusted values through `env:` rather than `${{ }}` inside `run:` bodies.

Alongside, and recorded here because they are part of the same boundary:

3. **`CODEOWNERS` names the gate-defining paths explicitly.** This adds no
   coverage today, because the default `*` line already assigns them; it adds
   explicitness and survives a future narrowing of that default.
4. **Actions must be pinned to a full-length commit SHA.** Enabled on the
   repository on 2026-08-26 (`sha_pinning_required: true`, previously `false`).
   The repository already pinned every action by SHA, so this costs nothing and
   removes the ability to introduce a mutable tag — including inside a change
   that has been acknowledged.

### What we are explicitly not doing, and why

**We are not adding a required-review rule.** This is a reversal of the issue's
preferred option, on measured grounds rather than preference. GitHub does not
permit an author to approve their own pull request. With a sole maintainer who is
also the sole code owner, `required_approving_review_count >= 1` — or
`require_code_owner_review`, which needs a code owner's approval and so implies
the same — deadlocks every self-authored change. The available escape is the
admin bypass that is already configured `always`, which converts the rule into a
bypass performed on every merge. For an external contributor the rule adds
nothing, because they cannot merge in the first place.

A rule that is either a deadlock or a routine bypass is precisely the control
ADR-0016 warns about. Recording that finding is more useful than shipping the
rule.

## Options considered

### Option A: Trusted gates on `pull_request_target` plus an acknowledgment label (chosen)

| Dimension | Assessment |
|---|---|
| Closes the mechanism | Yes for the gate's *definition*; the executed workflow and script come from the default branch |
| Closes name-shadowing | Yes, indirectly — every route runs through `.github/workflows/`, which `gate-integrity` blocks |
| Available to a personal namespace | Yes, unlike organization required workflows |
| Cost | One new workflow, one new script with tests, a label on gate-touching pull requests |
| New risk introduced | A privileged trigger. Mitigated by never executing pull-request code, read-only permissions, and `actions/checkout` v7's refusal of fork refs |
| Honest limit | Whoever can merge can label. Merge access remains the boundary |

### Option B: Required review on the `main` ruleset, plus CODEOWNERS entries

**Pros:** cheapest to configure; upgrades "whoever merges happens to look" to "a
review is required"; the issue's own preferred option.
**Cons:** not available as a real control here, for the reason given above — a
sole maintainer cannot approve their own pull request, so the rule either
deadlocks or is bypassed on every merge. It also leaves the mechanism untouched:
a reviewed pull request can still be the author of the check that certifies it.
The CODEOWNERS half is adopted anyway, as explicitness rather than as a gate.

### Option C: A pinned external action for the gates that matter

**Pros:** an immutable SHA cannot be edited by the pull request.
**Cons:** still invoked from a pull-request-controlled workflow, so it closes only
the script half — the same defect as reading the script from `origin/main`. It
also moves a governance check outside the surface
[ADR-0007](0007-adapter-isolation-and-public-surface-build.md) keeps mechanical
and self-contained, and ADR-0006 action item 2 already declined the DCO app on
that ground. Adopted in the weaker form that survives: SHA pinning is now
*required* repository-wide.

### Option D: Organization-level required workflows

**Pros:** runs genuinely outside the repository's control.
**Cons:** unavailable — the namespace is personal by decision (ADR-0006), and
moving it to solve this would be a far larger reversal than the problem warrants.
`pull_request_target` provides the trusted-execution property that made this
option attractive.

### Option E: A gate asserting the gates are unmodified relative to base

**Pros:** attacks name-shadowing directly.
**Cons:** the issue dismissed this as self-referential, and as a `pull_request`
job it would be — the assertion would live in the file it asserts about. Run from
`pull_request_target` it stops being self-referential, which is what makes
`gate-integrity` viable. The remaining objection, that it blocks every legitimate
change to a check, is answered by the acknowledgment rather than by an
exemption a pull request could set for itself.

### Option F: Document the property and accept it

**Pros:** honest; zero mechanism; merge access is genuinely the real boundary.
**Cons:** this is the status quo, and it leaves ADR-0006's provenance claim
resting on attention. It is also strictly weaker than Option A at a small cost
difference, now that a trusted execution path is known to exist. What it gets
right — that the residual must be stated rather than hidden — is kept: the
sections above say exactly what remains open.

## Trade-offs

Every pull request that touches a workflow, a script, `packages/ci/`, or
`CODEOWNERS` now needs a label before it can merge. That includes Dependabot's
`github_actions` bumps, which is friction on a real and recurring flow. It is
accepted rather than exempted: an action bump *is* a change to gate-executing
code, and `ci.yml` already argues that pinning exists to make such a bump "a
reviewed change rather than an ambient one." An author-based exemption would be
the same shape of hole this record exists to close.

The label is also a self-authorization for whoever can merge. What it buys is not
authority but *shape*: a gate change stops being one line among two hundred and
becomes an explicit, attributed, timestamped act that blocks the merge until
performed. This record does not claim that makes gate changes tamper-proof, and
no wording anywhere in the implementation should.

`pull_request_target` adds a privileged trigger to a repository that previously
had none on pull requests. That is a genuine new attack surface, mitigated but not
eliminated by the constraints listed under the decision.

## Consequences

- **Easier:** trusting the `trusted-dco` verdict; noticing a gate change, because
  it fails loudly rather than reading as ordinary diff.
- **Harder:** changing a check, by one labelling step; landing a Dependabot action
  bump, by the same step.
- **How we would know this was wrong:** if the label is applied reflexively —
  visible as acknowledgments arriving in the same minute as the merge, with no
  intervening comment — the mechanism has degraded into attention with extra
  steps, and Option F becomes the honest position. Conversely, if a gate change
  is ever caught at the label step, the mechanism paid for itself.
- **Revisit if:** the repository moves to an organization, which makes required
  workflows available and makes `gate-integrity` redundant; or if GitHub ships
  per-check provenance that makes name-shadowing impossible.

## Action items

1. [ ] **Ratify or reject.** This record is `proposed` and agent-drafted; it binds
       nothing until a human accepts it.
2. [ ] **Add the trusted contexts to the `main` ruleset — after merge.** This
       cannot be done before merge and must not be faked: `pull_request_target`
       executes the workflow from the default branch, so `trusted-dco` and
       `gate-integrity` do not exist until this lands, and adding a required
       context that never reports would block every pull request including this
       one. The exact operation, and the verification that it took, are in
       [`docs/repository-trust-operations.md`](../repository-trust-operations.md).
3. [ ] **Observe both trusted jobs on a real pull request after merge**, per
       ADR-0016. The kernel of `gate-integrity` has been observed blocking on this
       change's own real changed-path list and passing once the label is applied;
       its three fail-quiet guards — empty list, truncated list, unreadable
       payload — have each been observed firing; and a rename that carried a gate
       path out of the protected prefix has been observed blocking after that
       bypass was found and closed. The *deployed workflow* has not run, and
       cannot until it is on the default branch. All of it is recorded in
       `docs/repository-trust-operations.md` rather than asserted here.
4. [ ] **Decide on the fork-PR approval policy.** Currently
       `first_time_contributors`. Tightening to `all_external_contributors` means
       no fork's workflows run without a maintainer's explicit action, at the cost
       of friction for repeat contributors. Left as a maintainer judgment rather
       than changed silently; the command is in the operations document.
5. [x] **Enable required SHA pinning for actions.** Done 2026-08-26 —
       `sha_pinning_required` moved `false` → `true`, verified by re-reading
       `/repos/mbeacom/adrkit/actions/permissions`.
6. [x] **Name the gate-defining paths in `CODEOWNERS`**, with both caveats stated
       in the file so the lines are not mistaken for a gate.
7. [x] **Drop the "known limitation" note in `scripts/check-dco.ts`** where it
       stopped being true, and say precisely which invocation is the authority and
       which is advisory — #137's third "done when".
