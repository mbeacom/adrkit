---
schemaVersion: 0.1.0
id: "0028"
title: Give the comment-posting Action an end-to-end signal on both rungs
status: proposed
date: 2026-08-14
deciders: ["@mbeacom"]
tags: [ci, github-actions, evidence, governance]
scope: component
reversibility: two-way-door
blastRadius: team
relatesTo: ["0004", "0007", "0014", "0016", "0026"]
affects:
  - type: path
    pattern: ".github/workflows/ci.yml"
  - type: path
    pattern: "scripts/check-ci-comment.ts"
  - type: path
    pattern: "scripts/__fixtures__/ci-comment/**"
  - type: path
    pattern: "specs/004-ci-surface/evidence/reference-repo/**"
  - type: path
    pattern: "specs/004-ci-surface/checklists/reference-verification-evidence.md"
provenance:
  authoredBy: agent-drafted
review:
  tier: arb
  tierReason: >-
    Adds the only job in this repository that can write, raising a job's permission
    ceiling from `contents: read` to `pull-requests: write` on a workflow that
    executes the pull request's own definition (#137). A change that grants CI a
    write capability should not be able to happen quietly, even when the write is
    a comment and the trust boundary is unchanged.
  queuedAt: 2026-08-14T00:00:00Z
  slaDays: 30
reviewBy: 2027-02-14
---

# ADR-0028: Give the comment-posting Action an end-to-end signal on both rungs

## Context

[Issue #135](https://github.com/mbeacom/adrkit/issues/135) records that the
governing-decisions Action in `packages/ci` — the surface whose entire product is a
comment on a pull request — has never had an end-to-end signal.

The repository does have a `self-dogfood` job, and it is real coverage: on every pull
request it runs `adr check` over the changed files, exercising the corpus loader,
`affects` resolution, and the exit-code semantics against the project that ships them.
What it does not touch is the Action. It runs the **CLI**, with `contents: read`, so it
never constructs a GitHub client, never resolves an identity, and never posts. Nothing
in `.github/workflows/` used `packages/ci` at all: the three workflows that reference
it **build** it, gate its bundle for drift, and release it.

This is not a hypothetical gap. It is the mechanism by which
[#107](https://github.com/mbeacom/adrkit/issues/107) survived two releases, posting a
duplicate comment on every push to every adopter's pull request. Every suite was green
the whole time, and so was `self-dogfood`, because the defect was not in the logic or
the resolution — it was in an environmental assumption (`process.env.GITHUB_TOKEN`
being present in a step) that exists only in the Action's runtime and that no test
asserted. The job log read:

```
adrkit: created the governing-decisions comment.
```

which is exactly what healthy operation prints.

[ADR-0016](./0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
already names this shape — a check that cannot tell "nothing is wrong" from "I could
not look" — and [ADR-0026](./0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md)
already noted, as its deferred action item 9, that no automated signal would catch a
recurrence before adopters saw it. That deferral is what this record closes.

The single state that distinguishes the healthy case from the broken one is not in any
log. It is the pull request itself: **after two dispatches, how many comments bear the
marker?**

Two further facts shape the answer:

- The `v0` tag adopters pin is a **moving** tag. A regression reaches every adopter on
  the next release, and rolling back means a maintainer knowing to force-move a tag by
  hand (ADR-0026's deferred item 10, still open). Pre-merge signal is worth more here
  than it would be behind an immutable pin.
- The queue Action already has rung-2 reference-repository evidence
  ([`specs/007-arb-queue/checklists/reference-verification-evidence.md`](../../specs/007-arb-queue/checklists/reference-verification-evidence.md)).
  The comment Action, which is the older and more widely used of the two, has none.

## Decision

**We will cover the comment path on both rungs of the
[ADR-0014](./0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
ladder, because each rung sees something the other structurally cannot.**

### Rung 1 — a continuous `action-dogfood` job in this repository's CI

A new job in `.github/workflows/ci.yml`:

1. `needs: clean-clone-builds`, so the bundle-drift gate has passed. `uses:` runs the
   **committed** `packages/ci/dist`, which is what adopters get; without that
   dependency this job could pass over a stale bundle while the source it claims to
   cover is broken — the blind-pass shape again, one level up.
2. Runs `uses: ./packages/ci` **twice** against the same pull request. Twice, not once,
   so the create → update transition is observable within a single run rather than
   depending on the pull request's push history.
3. Asserts, over the API, that the pull request now carries **exactly one** comment
   whose first line is `<!-- adrkit:ci -->`, authored by a **Bot** — once between the
   two dispatches and once after.

The assertion runs *between* the dispatches as well as after them, and the first of the
two is retried on a bounded loop. That is not belt-and-braces: GitHub can serve the
comment list from a replica, so a second dispatch that listed before the first comment
became visible would create a duplicate and fail a **healthy** Action. Retrying turns
that race into a bounded, named failure rather than a false positive. The second
assertion is deliberately not retried — a stale read there can only *hide* a duplicate,
never invent one, and a duplicate persists until a human removes it, so the next push
catches what a stale read missed. Retrying a passing assertion until it fails would be
the opposite of a gate.

The assertion lives in `scripts/check-ci-comment.ts`, alongside `check-dco.ts` and for
the same reasons: the gate stays inside the surface
[ADR-0007](./0007-adapter-isolation-and-public-surface-build.md) keeps mechanical and
self-contained, and it imports only builtins so a broken dependency graph cannot take
it down. It keeps its own copy of the marker string, and a unit test asserts that copy
equals `packages/ci/src/comment.ts`'s — a copy nothing compares is a copy that drifts.

**Exactly one, not at most one.** The property #135 names is "at most one", and that is
the wrong assertion: an empty comment list satisfies it, and an empty list is what a
revoked permission, a wrong pull-request number, and a silently-degraded Action all
produce. Requiring exactly one is what makes the gate unable to pass while blind. The
Bot-author check is the specific observed value ADR-0016 clause 3 prefers over a bare
count: the default `GITHUB_TOKEN` posts as `github-actions[bot]`, so a `User` there
means a person's comment is being counted as the Action's and the real one may be
missing.

**Two exclusions, both required rather than cautious.** Fork pull requests and
Dependabot runs receive a read-only `GITHUB_TOKEN` whatever `permissions:` declares. The
Action then correctly degrades to a log notice (FR-014) and posts nothing, so the
assertion would find zero comments and fail a *healthy* Action. Excluding them keeps the
gate honest; leaving fork coverage to rung 2 is what makes that exclusion acceptable
rather than a hole.

### Rung 2 — a runnable reference-repository artifact, not an instruction

`specs/004-ci-surface/evidence/reference-repo/comment-idempotence.yml` is a drop-in
workflow for the maintainer-owned isolated reference repository. It calls the Action as
a **consumer** does — `uses: mbeacom/adrkit/packages/ci@<40-char sha>` — and asserts its
own outcomes, covering three scenarios, of which the third is unreachable from rung 1:

| Scenario | Assertion |
|---|---|
| Two dispatches | Exactly one marked comment, via the same `check-ci-comment.ts` at the pinned ref |
| Fail-closed: `dir` is a plain file | Step fails, and the comment set is byte-identical before and after |
| **FR-014 degrade: `pull-requests: read`** | Step stays **green**, and the comment set is unchanged |

The third row is the whole argument for keeping both rungs. `action-dogfood` skips fork
pull requests *because* their token is read-only, so this repository's own CI can never
exercise the degrade path it skips over. A reference repository can grant
`pull-requests: read` deliberately and observe it.

Shipping the workflow as a file rather than a task is
[ADR-0016 clause 4](./0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md):
"an instruction to observe a failure, with no failure attached, is a check that cannot
fail dressed as a handoff." The accompanying evidence index is created **empty**, with
every `Observed` cell reading `pending` and a `NOT YET OBSERVED` status, so the gap is
visible rather than merely unrecorded — which is the state it was in before.

### What this deliberately does not do

The Action gains **no new outputs**. Asserting on the Action's self-reported outcome was
the cheaper option, and it is the one #107 defeats: the Action reported `created` and
was believed. Ground truth is the pull request's comment list, so that is what is read.

## Options considered

### Option A: both rungs — continuous in-repo gate plus a runnable rung-2 artifact (chosen)

| Dimension | Assessment |
|---|---|
| Catches the #107 class pre-merge | Yes — on every same-repo pull request, before release |
| Covers the FR-014 read-only degrade | Yes, at rung 2 only; rung 1 structurally cannot |
| Runs the artifact adopters get | Yes — committed `dist`, gated for drift by `needs:` |
| Permission ceiling | One job rises to `pull-requests: write`; every other job stays `contents: read` |
| Fork pull requests | Not covered at rung 1 (documented blind spot), covered at rung 2 |
| Cost | One job, one script, one drop-in workflow, and a comment on every adrkit pull request |
| Reversibility | Two-way door — delete the job and the script |

### Option B: extend or add a sibling job only (rung 1 alone)

**Pros:** smallest change; continuous; catches the regression that actually shipped.
**Cons:** cannot cover the read-only degrade path at all, because the token that
exercises it is the token that makes the assertion impossible. It would also leave the
comment Action as the only shipped surface with no rung-2 evidence while its sibling,
the queue Action, has a full index — an asymmetry that reads as an oversight rather than
a decision.

### Option C: run the Action twice and assert its own reported outcome (no API read)

**Pros:** cheapest; fork-safe, because it needs no write permission and no API read; no
permission ceiling change at all.
**Cons:** it asks the component under test whether it is working. #107 answered
`created the governing-decisions comment` on every one of those pushes and was believed
for two releases. A self-report is precisely the evidence that failed here, and adding
an output to the Action to carry it would also expand a public contract for the benefit
of a test.

### Option D: fold it into ADR-0014 rung 2 only

**Pros:** keeps the ladder as the single place external behaviour is proven; no
permission change; covers the degrade path.
**Cons:** rung-2 runs are maintainer-initiated and episodic. The regression window is
"until someone next runs the reference repository", which for #107 would have been
longer than the two releases it actually took. Continuous pre-merge signal is the thing
that was missing, and this option does not add it.

### Option E: `pull_request_target`

The only shape that would cover fork pull requests.

**Pros:** closes the documented blind spot.
**Cons:** runs the base repository's workflow with a **write** token in a context that
checks out fork-authored code. That is a well-known privilege-escalation footgun, and
trading it for a CI signal on a comment is not a defensible exchange. Rejected outright.

### Option F: do nothing

**Pros:** zero cost; the specific defect is fixed and covered by unit tests.
**Cons:** the fix is covered; the *class* is not. ADR-0026 states plainly how we would
know it was wrong — "if a pull request on this repository or a reference repository ever
shows two governing-decisions comments again, the fix has regressed" — and nothing was
watching for that. Any future change to GitHub's token model, Octokit's error shape, or
the permission semantics of `users.getAuthenticated` that pushes
`identityFromLookupFailure` back toward `unknown` would reproduce #107 exactly, and pass
everything that exists today.

## Trade-offs

**A job in `ci.yml` can now write to pull requests.** This is the honest cost and it is
stated plainly. `ci.yml` runs the *pull request's own* definition — measured directly on
#98 and tracked repository-wide in [#137](https://github.com/mbeacom/adrkit/issues/137)
— so a contributor who can push a branch to this repository can edit the job and use
that token for arbitrary pull-request writes. What bounds it is that only collaborators
can push such a branch, which is the same trust boundary as merging; a fork cannot reach
it, because a fork's token is read-only no matter what the workflow asks for. The
capability is scoped to one job rather than raised at the workflow level so it is
visible in one place, and the exclusions are documented in the job itself rather than
inferred.

**Every adrkit pull request now carries a bot comment.** That is noise on pull requests
whose authors already know the governing decisions. It is also the product working, and
a maintainer reading it on their own pull requests is the fastest route to noticing it
is wrong — which is what "even if that user is only you" means in ADR-0014's framing.

**Fork pull requests get no rung-1 signal.** A regression on a fork-only path would not
be caught here. Rung 2's `pull-requests: read` scenario is the mitigation, and it is
episodic rather than continuous. This is a real gap, recorded as one.

**Two dispatches per pull request cost two API round trips and one extra job.** Small,
but not zero, and it serializes behind `clean-clone-builds`.

**The gate can flake on concurrency, and on read replicas.** Two runs of this job on one
pull request would both list zero comments and both create, failing a correct Action. A
per-pull-request `concurrency` group with `cancel-in-progress` serializes them; a
cancelled run that had already created is absorbed by the next, which finds and updates
it. Replica lag between the two dispatches is handled by the retried mid-run assertion
above. Neither mitigation is a proof, and the residual failure mode is a red run on a
healthy Action — which is the safe direction, and loud rather than silent.

**Rung 2 is authorized, not performed.** This record ships the artifact and the empty
index; it does not claim the run. The comment path stays `implemented` in ADR-0014's
vocabulary and is **not** `reference-verified` until scenarios 1–5 in that index carry
observed values and immutable links.

## Consequences

- **Easier:** a duplicate-comment regression fails a required-check-eligible job on the
  pull request that introduces it, rather than reaching every adopter on the moving `v0`
  tag; and the read-only degrade path becomes verifiable for the first time.
- **Harder:** `ci.yml` now has a job with a write capability, and the reasoning for its
  two exclusions has to be maintained alongside GitHub's token semantics. If GitHub ever
  grants fork pull requests a write token, the fork exclusion becomes wrong and silently
  reduces coverage rather than failing.
- **How we would know this was wrong:** the gate fails on a pull request whose Action
  behaved correctly — the most likely cause being a token-model change that makes the
  read-only exclusions incomplete. A recurring `absent` verdict on healthy runs is the
  signal to revisit, and it is loud rather than silent by construction. Conversely, if a
  duplicate-comment report ever arrives from an adopter *while this job is green*, the
  gate is measuring the wrong thing and this record has failed.
- **Revisit if:** GitHub exposes a safe mechanism for fork pull requests to obtain a
  scoped write token, at which point the fork exclusion and much of Option E's objection
  disappear; or if the rung-2 index is completed, at which point the comment path can be
  labelled `reference-verified` and this record's rung-2 half becomes maintenance rather
  than an open item.

## Action items

1. [x] Add `scripts/check-ci-comment.ts` — exactly-one, Bot-authored, reporting what it
   examined — with permanent negative fixtures for the duplicate (#107), absent, empty,
   and human-authored shapes, each observed rejecting per ADR-0016 clause 1.
2. [x] Assert the gate's marker copy equals `packages/ci/src/comment.ts`'s, and observe
   that test failing on a deliberately drifted copy.
3. [x] Add the `action-dogfood` job to `.github/workflows/ci.yml`, gated on
   `clean-clone-builds`, excluding fork and Dependabot pull requests, serialized per
   pull request.
4. [x] Ship the rung-2 reference-repository workflow as a runnable file, with its
   fail-closed and read-only-degrade scenarios, rather than as an instruction.
5. [x] Create the rung-2 evidence index empty and explicitly `NOT YET OBSERVED`.
6. [x] Close ADR-0026 action item 9 by reference.
7. [ ] Run the rung-2 artifact in `mbeacom/adrkit-t018-dogfood` against this record's
   merge commit and fill in the evidence index. Until then the comment path is
   `implemented`, not `reference-verified`. This also satisfies ADR-0026 action item 8.
8. [ ] Make `action-dogfood` a required status check on the `main` ruleset once it has
   run green on at least one pull request. It cannot be required before it has run,
   since it skips on the pull requests that cannot satisfy it.
9. [ ] Consider one rung-2 run pinned to a **pre-`1426916`** adrkit commit, which would
   let scenario 1 be observed failing against real published behaviour rather than
   against a fixture. Recorded as an option that was not taken, not as a plan.
