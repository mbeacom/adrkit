---
schemaVersion: 0.1.0
id: "0026"
title: Identify the CI comment by the strongest author evidence the token allows
status: accepted
date: 2026-08-12
deciders: ["@mbeacom"]
tags: [ci, github-actions, governance, agents]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0004", "0014", "0016"]
affects:
  - type: path
    pattern: "packages/ci/src/github.ts"
  - type: path
    pattern: "packages/ci/src/index.ts"
  - type: path
    pattern: "packages/ci/src/comment.ts"
  - type: path
    pattern: "packages/ci/action.yml"
  - type: path
    pattern: "scripts/check-ci-comment.ts"
  - type: path
    pattern: "specs/004-ci-surface/spec.md"
  - type: path
    pattern: "specs/004-ci-surface/research.md"
  - type: path
    pattern: "specs/004-ci-surface/quickstart.md"
  - type: path
    pattern: "site/src/content/docs/ci.mdx"
assertions:
  - id: ci-comment-unique
    description: >-
      After the governing-decisions Action runs on a pull request, that pull
      request carries exactly one comment whose first line is the marker, and a
      bot authored it. Asserted as "exactly one" rather than "at most one"
      deliberately: an empty comment list satisfies "at most one", and an empty
      list is what a revoked permission, a wrong pull-request number, and a
      silently-degraded Action all produce.
    engine: custom
    expression: ci-comment-unique
    input: source
    severity: error
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Relaxes a stated safety rule rather than tightening one. R5/FR-005 froze comment
    identity as "the marker AND the Action's own author identity", and this record
    keeps that only where the exact login is knowable, substituting two weaker signals
    where it is not. Loosening a guard on a write path deserves more scrutiny than
    narrowing one, even though the guard being loosened is shown below to have never
    once been satisfied in the documented workflow — which is the second reason this
    is more than a bug fix, because the property that "held" was unfalsifiable rather
    than true.
  queuedAt: 2026-08-12T00:00:00Z
  slaDays: 30
  approvals: ["@mbeacom"]
  decidedAt: 2026-08-12T22:10:00Z
reviewBy: 2027-02-12
---

# ADR-0026: Identify the CI comment by the strongest author evidence the token allows

## Context

[Issue #107](https://github.com/mbeacom/adrkit/issues/107) reports that the
`packages/ci` Action posts a **new** governing-decisions comment on every push,
accumulating one near-identical comment per push on a long-lived pull request. The
reporter confirmed via the API that these are distinct comments rather than one being
edited, and that adding `env: GITHUB_TOKEN: ${{ github.token }}` to the step makes the
same pull request stay at one comment whose `updated_at` advances past `created_at`.

> `R<n>` and `FR-<n>` below are numbered decisions and requirements in this
> repository's CI-surface specification —
> [`specs/004-ci-surface/research.md`](../../specs/004-ci-surface/research.md) and
> [`spec.md`](../../specs/004-ci-surface/spec.md). `RC<n>` numbers a review comment
> that revised one. The two that matter here are **R5/FR-005**, which froze how the
> Action recognises its own comment.

The upsert itself is correct. What fails is the identity it depends on.

**The rule.** [`specs/004-ci-surface`](../../specs/004-ci-surface/research.md) R5,
revised under review comment RC5 and frozen as FR-005, says the Action locates its own
comment by **both** a stable hidden marker **and** its own author identity, because
"marker-only matching is insufficient: a human could quote the marker." Absent a
resolved identity, `findOwnComment` adopted nothing and a fresh comment was created.

**Why the identity was never resolvable.** The Action posts under the default
`GITHUB_TOKEN`, which is a GitHub App installation token. Such a token cannot call
`users.getAuthenticated`, so the login had to come from a fallback, and that fallback
was gated on recognising the token as the default one:

```ts
const providedToken = core.getInput('token');
const runnerToken   = process.env.GITHUB_TOKEN ?? '';
const isDefaultToken = runnerToken !== '' && token === runnerToken;
```

Two facts make `isDefaultToken` unreachable in the documented workflow. `action.yml`
declares `token` with `default: ${{ github.token }}`, so `getInput('token')` is always
non-empty and the input is always the token that gets used. And GitHub Actions does not
export `GITHUB_TOKEN` into a step's environment unless the workflow asks for it, which
[the documented snippet](https://adrkit.dev/ci/) does not. So `runnerToken` is `""`,
`isDefaultToken` is `false`, the fallback returns `undefined`, and every run creates.

Passing `token:` explicitly does not help, because the input already defaults to the
same value. There is no mechanical repair: the comparison needs `${{ github.token }}`
inside the Node process, a `node24` action cannot set its own `env:`, and an input's
declared default is indistinguishable from a caller passing that same value. **The
identity has to come from the API or not at all**, and the API will not give a login
to the token every documented adopter uses.

This left the project asserting a property that could not be observed either way. The
guard's coverage — `findOwnComment` returning `undefined` for an unknown identity — is
tested and passes, but nothing tested that the identity was ever *known* in the path
that ships. Per [ADR-0016](./0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md),
a green check that means "I am blind" is the failure mode this project has already
named: `undefined` rendered identically whether the lookup answered "not us" or could
not look at all.

**What the guard is actually for.** FR-005's own words are that it exists so the Action
"never edits a human's comment that happens to contain the marker" and never misses its
own comment on an unfetched page. Neither purpose needs an exact login.

## Decision

We will resolve identity to **the strongest evidence the token affords**, as a
three-way classification, and match with the strength that evidence supports.

| Identity | How it arises | Match rule |
|---|---|---|
| `login` | `users.getAuthenticated` answered | marker anywhere in the body **and** `user.login` equals it |
| `app-installation` | it was refused with "Resource not accessible by integration", whatever status carried it — or with a bare 403 on a run that was not throttled | `user.type === "Bot"` **and** the marker is exactly the body's **first line** |
| `unknown` | anything else — 401, 404, a throttled bare 403, a 5xx, a network error | nothing is adopted |

A permission-shaped refusal of `users.getAuthenticated` is not an absence of
information. It is exactly how an app installation token is refused, so it is positive
evidence that the caller is an app and therefore a **bot**. That is one of the two
signals FR-005 wanted, and it is the one that excludes the case FR-005 named — a human.

The classifier is deliberately narrower than `isPermissionError`, which folds 401 and
404 in with 403 because at the top of the Action either answer means "we cannot
comment". Here the answer decides *how much author evidence a comment needs*, so
breadth is not free: 401 is invalid or expired credentials and 404 is not a documented
response of this endpoint, and reading either as "we are an app" would hand the weaker
bot-plus-marker rule to a credential that is not an app at all. The message is the
definitive signal and the status is the fallback, in that order — keying solely on the
message would make this fix hostage to an English string GitHub may reword, which is
the failure this record exists to prevent.

The refusal message is also read **before** throttling, not after. GitHub returns
`x-ratelimit-remaining` on every response, so an app whose installation quota happens to
be exhausted would otherwise have its own refusal read as "throttled" and lose that run
to a duplicate comment. Being throttled does not make us not an app: the refusal names
what we are and a rate-limit header does not. A **bare** 403 is genuinely ambiguous —
it covers both an app refusal and throttling — so that branch, and only that branch,
still defers to the throttling check.

The second signal replaces the login. Both renderers in `comment.ts` emit
`<!-- adrkit:ci -->` as the body's **first line**, and have in every revision of that
file, so requiring the marker to be exactly the first line is true of every comment
the Action has ever posted and false of the way a human or another bot would reproduce
it — behind a `>`, or below their own prose. So the degraded path trades an exact
author for a stricter marker, rather than simply dropping a condition.

This is not a new rule in this package. `queue-issue.ts` already establishes ownership
of the managed ARB queue issue by exactly this test — `body.split(/\r\n|\n|\r/, 1)[0]
=== MARKER` — with marker-only, LF, CRLF, and CR bodies all accepted, and it is
reference-verified on [ADR-0014](./0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
rung 2. The comment path adopts that same predicate verbatim, so both Actions answer
"is this ours?" the same way.

`unknown` keeps the old behaviour, deliberately. A network error, a 5xx, or being
**throttled** proves nothing about who we are — throttling in particular also arrives
as a 403, and reading that as "we are an app" would claim a comment on evidence the run
never obtained. For a transient failure the cost is one duplicate comment that the next
run absorbs. For a **persistent** one it is a duplicate per push, which is the original
defect: the difference is that it is now **logged as a warning** naming the cause,
rather than passing silently as it did for two releases. That is the intended trade —
an adopter who sees the warning can act on it, whereas adopting a comment on unknown
identity would be a silent write we cannot justify.

Where several comments match, the **last** one wins rather than the first. Every pull
request opened before this fix carries one comment per push, and the newest is both the
one a reader reaches at the bottom of the thread and the one worth keeping current. The
Action is comment-only and deletes nothing, so the older copies remain until a human
removes them.

Making the update path reachable also makes a race reachable that never fired while it
was dead: the comment can be deleted between the list and the update. A 404 there means
"gone", not "forbidden", so the Action creates a replacement instead of surrendering
that push's comment to `isPermissionError`'s fork-token degrade. A 403 still degrades.

The `isDefaultToken` plumbing is deleted. `GITHUB_TOKEN` remains a fallback *source*
of the token for a workflow that blanks the input, but it is no longer consulted to
decide who we are.

## Options considered

### Option A: classify the lookup failure; match on bot-ness plus a leading marker (chosen)

| Dimension | Assessment |
|---|---|
| Fixes the documented workflow | Yes — no `env:` block, no input change |
| Fixes a custom GitHub App token | Yes — such a token is also refused `/user`, and now finds its own comment |
| Preserves FR-005's stated purpose | Yes — a human's comment is never adopted, on either path |
| Residual exposure | Another **bot** posting a comment whose **first line** is exactly adrkit's private marker |
| Statelessness (ADR-0004) | Unchanged — no comment id is stored |
| Reversibility | Two-way door; one pure function and one client method |

### Option B: fall back to `github-actions[bot]` on any `/user` failure

The fix the issue suggests first, and the shape of any "just name the identity"
variant — including taking the app's login as a workflow input. It repairs the default
path, but it *asserts* a login rather than observing one, and the assertion is wrong for
any custom App token — which posts as `<app>[bot]`, would go looking for
`github-actions[bot]`, and would therefore both miss its own prior comment and, having
repo write, edit one authored by a different bot while believing it was its own. It
fixes the common case by making the identity model less true, and leaves the
duplicate-comment bug in place for everyone using `actions/create-github-app-token`.

**Pros:** smallest diff; no port change.
**Cons:** claims an identity it has not observed; still broken for custom App tokens;
the residual exposure is *worse* than Option A's despite looking narrower, because the
comparison now names a specific foreign author.

### Option C: document `env: GITHUB_TOKEN: ${{ github.token }}` as required

The reporter's verified workaround, promoted to the fix.

**Pros:** zero code change.
**Cons:** makes correct behaviour opt-in and silently absent for every adopter who
follows the current documented snippet — including this repository. The docs promise
"posts a single comment"; this option keeps the promise false by default and moves the
cost onto every reader. It also encodes an internal detail of identity resolution into
the public workflow contract, which is the sort of thing that cannot be removed later.

### Option D: store the comment id

**Pros:** exact identity, no heuristics.
**Cons:** refused by [ADR-0004](./0004-git-is-source-of-truth-database-is-an-index.md) —
it is the side database that record forbids, for a comment the pull request already
holds.

### Option E: do nothing

The behaviour is cosmetic in the sense that nothing is computed wrongly. But the
comment is the entire product of this surface, and a reviewer scrolling past nine stale
copies to find the current one is not reading the governing decisions — which is the
one thing the Action exists to make them read. Doing nothing also leaves an asserted
property in the specification that the shipped code has never satisfied.

## Trade-offs

The degraded path can adopt a comment adrkit did not post, if some other bot posts a
comment whose first line is exactly `<!-- adrkit:ci -->`. That is the cost, stated
plainly. Taking the last match rather than the first does not remove it — it only
changes which contrived ordering loses, and is chosen because it is the ordering that
helps the real, non-adversarial case of a pull request full of duplicates.

It is worth paying because the exposure requires a second bot to reproduce adrkit's
private marker as its own first line; the damage is one overwritten comment, recoverable
from GitHub's edit history; and the guard being relaxed was buying nothing, since it
has never been satisfied in the documented workflow. A guard that has never fired is
not protection, it is an untested branch.

A rejected way to keep exact identity: take the app's login as a workflow input and
compare it. That returns the correctness of the default path to something the adopter
must configure — the failure mode of Option C — and it cannot help the default token,
which has no login to name. Identity that only holds when the caller supplies it is not
identity.

A second, smaller trade: identity now uses two different matching rules depending on
how it was resolved. That is more to hold in the head than one rule. The alternative is
one rule at the weaker strength, which would needlessly discard an exact login when we
have one.

## Consequences

- **Easier:** one comment per pull request in the documented workflow, with no `env:`
  block; the same for a custom GitHub App token, which never worked; and an
  unresolvable identity now says so in the job log instead of looking like a normal run.
- **Harder:** the identity model has three states rather than a login-or-nothing, and
  the "marker is the body's first line" invariant in `comment.ts` is now load-bearing
  for the degraded path — moving the marker off the first line would silently
  reintroduce duplicate comments. A test asserts it for both renderers.
- **Not fixed:** comments a pull request accumulated before the upgrade. The Action is
  comment-only and deletes nothing; it updates the newest and leaves the rest. The
  documentation says so rather than promising a cleanup the Action does not perform.
- **How we would know this was wrong:** a report of adrkit editing a comment it did not
  author. None is expected; the exposure requires a foreign bot to lead its body with
  adrkit's marker. Conversely, if a pull request on this repository or a reference
  repository ever shows two governing-decisions comments again, the fix has regressed.
- **Revisit if:** GitHub exposes the acting app's identity to an installation token —
  at which point the degraded path collapses back into `login` and this record's
  weaker rule can be deleted rather than maintained.

## Action items

1. [x] Replace `getAuthenticatedLogin` with `getSelfIdentity` on the `GitHubClient`
   port and classify the lookup failure.
2. [x] Delete `fallbackSelfLogin`/`DEFAULT_TOKEN_LOGIN` and the `isDefaultToken`
   plumbing in `src/index.ts`.
3. [x] Warn on an unresolvable identity instead of degrading silently.
4. [x] Create a replacement when the prior comment is deleted between the list and the
   update, rather than letting a 404 take the fork-token degrade path.
5. [x] Cover the app-installation path, including the negative cases a human and a
   quoting bot present, watched failing first per ADR-0016.
6. [x] Amend R5 in `specs/004-ci-surface/research.md` and FR-005 in `spec.md` by
   reference, following ADR-0013's precedent, and remove the obsolete `env: GITHUB_TOKEN`
   block from `quickstart.md`, which documented the broken model.
7. [x] Note in `site/src/content/docs/ci.mdx` that a `v*` release tag is annotated, so
   `uses:` needs the dereferenced commit rather than the tag object's own SHA.
8. [x] **Confirmed 2026-08-14.** A second dispatch updates the comment rather than
   posting another, observed on the maintainer-owned isolated reference repository
   ([`adrkit-t018-dogfood#16`](https://github.com/mbeacom/adrkit-t018-dogfood/pull/16),
   run 31773788433, adrkit pinned at `b840e91`): the Action logged `created` then
   `updated`, and the comment id was `#5289930628` after both dispatches, from a pull
   request that carried zero comments beforehand. Running the artifact exposed four
   defects in it; the cited run is the one against the corrected copy, because an
   artifact fixed after its own verification run is an unverified artifact. The full index is
   [`specs/004-ci-surface/checklists/reference-verification-evidence.md`](../../specs/004-ci-surface/checklists/reference-verification-evidence.md);
   the artifact that produced it is
   [`specs/004-ci-surface/evidence/reference-repo/`](../../specs/004-ci-surface/evidence/reference-repo/README.md).
   **A reviewer verdict is still outstanding**, and ADR-0014 rung 2 requires the evidence
   to be reviewed, so the comment path remains `implemented` and is not yet
   `reference-verified`.

   Three things the run established that reading could not:

   - **The FR-014 degrade works, and had never been observed anywhere.** Under
     `pull-requests: read` the Action logged `an app installation token, whose login is
     not resolvable; matching on the marker and a bot author` and then the read-only
     notice, left the job green, and wrote nothing. That is this record's degraded
     identity path executing in the wild, not inferred from source.
   - **A `pull-requests: read` token can list issue comments at all** — previously
     unestablished, and the reason the snapshot step asserts its result is non-empty.
   - **`updated_at` does not move on a byte-identical PATCH.** In every attempt the
     Action logged `updated` while `updated_at == created_at`. The gate asserts **id
     stability** instead precisely because that API detail is uncontractual, and a design
     hedge became an observation.

     The `duplicate` rule has also now been observed **firing** on a real two-comment
     state rather than only on a fixture — caused, instructively, by this repository's own
     reference instructions, which told the operator to clear the comment before pushing
     and thereby put two writers into create mode simultaneously. Corrected there; the
     rule behaved correctly, though its message named #107 as the cause when a concurrent
     writer was responsible, and now names both.

     **`updated_at` is not a reliable signal, and that — not any particular direction —
     is why the gate does not use it.** The same operation gives opposite results:

     | Context | Actor | Body | Gap | `updated_at` |
     |---|---|---|---|---|
     | `adrkit#143` probes ×3 (6 PATCHes, +5s to +310s) | User via OAuth | byte-identical | seconds–minutes | **unchanged** |
     | `adrkit-t018-dogfood#16`, both dispatches, every run | `github-actions[bot]` | identical render | seconds, one run | **unchanged** |
     | `openleague#328`, 3 same-commit workflow re-runs | `github-actions[bot]` | SHA-256 identical | minutes, separate runs | **advanced every time** |

     An earlier revision asserted, on the first row alone, that "GitHub does not bump
     `updated_at` for a PATCH whose body is byte-identical", and called it measured. That
     claim is **withdrawn**. A later revision then named the **actor** as the remaining
     variable — also wrong, and contradicted by the table it sat beside: rows 2 and 3 are
     the same actor with opposite outcomes. Ruled out by measurement: the endpoint (both
     paths call `issues.updateComment`) and elapsed time (probed to ~5 minutes). No single
     variable has been isolated, and **the mechanism is not established**. It is left
     unexplained rather than given a third plausible story.

     **The falsification strengthened this decision rather than weakening it**, which is
     the part a reader should take from it. Asserting **id stability** never depended on
     the direction `updated_at` moves — only on the field being uncontractual. Contexts
     that disagree evidence that far better than agreement would have: an artifact
     asserting `updated_at` advanced fails rows 1–2, one asserting it held fails row 3,
     and id stability holds in all three.

9. [x] **Deferred when this record was written; done 2026-08-14 ([#135](https://github.com/mbeacom/adrkit/issues/135)).**
   This repository did not run its own governing-decisions Action on its own pull
   requests. `self-dogfood` runs the **CLI** with `contents: read`, so it never
   constructed a GitHub client, resolved an identity, or posted — meaning the surface
   this record is about had no automated signal at all, which is precisely how the
   defect survived two releases while every suite stayed green.

   Closed as the `action-dogfood` job in `.github/workflows/ci.yml`, backed by
   `scripts/check-ci-comment.ts`, asserting the `ci-comment-unique` assertion declared
   above. It runs `uses: ./packages/ci` **twice** against the pull request and checks,
   over the API, that exactly one comment leads with the marker and a bot authored it.
   Structured as a repository script for the reasons
   [ADR-0006](./0006-license-apache-2-and-single-monorepo.md) action item 2 gives for
   `check-dco.ts` — it imports only builtins, so a broken dependency graph cannot take
   the gate down with it — and observed rejecting the real duplicate-comment shape
   before it counted as coverage
   ([ADR-0016](./0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)),
   with the negative cases kept in `scripts/__fixtures__/ci-comment/`.

   Four properties are load-bearing and easy to undo by accident:

   - **It is the first job in this repository that can write.** `pull-requests: write`
     is scoped to that one job rather than raised at the workflow level, so the
     capability is visible in one place. `ci.yml` executes the *pull request's own*
     definition ([#137](https://github.com/mbeacom/adrkit/issues/137)), so a
     contributor who can push a branch here can edit the job and use that token; what
     bounds it is that only collaborators can push such a branch, which is the same
     trust boundary as merging, and a fork's token is read-only regardless.
   - **Fork and Dependabot pull requests are excluded, and must stay excluded.** Their
     token is read-only whatever `permissions:` declares, so the Action correctly
     degrades to a log notice (FR-014) and posts nothing — the assertion would fail a
     *healthy* Action. `pull_request_target` would close that blind spot by running
     base-repo workflows with a write token against fork-authored code, and is
     rejected: that is not a trade this repository will make for a CI signal. The
     uncovered path is instead covered at rung 2 by item 8's `pull-requests: read`
     scenario, which this repository's own CI structurally cannot exercise.
   - **`needs: clean-clone-builds` is correctness, not ordering hygiene.** `uses:` runs
     the *committed* `packages/ci/dist`, so without the bundle-drift gate ahead of it
     the job could pass over a stale bundle while the source it claims to cover is
     broken.
   - **The assertion also runs between the two dispatches, on a bounded retry.** GitHub
     can serve the comment list from a replica, and a second dispatch that listed
     before the first comment became visible would create a duplicate and fail a
     healthy Action. The second assertion is deliberately not retried — a stale read
     there can only hide a duplicate, never invent one, and duplicates persist until a
     human removes them.
   - **Two cross-checks the comment list cannot answer on its own.** The list is
     compared against the comment count GitHub reports for the issue, because a caller
     who loses `--paginate` sees page one and a duplicate on page two then reads
     exactly like a healthy single comment; and the surviving comment's **id** is
     compared against the one observed after the first dispatch, because an update
     preserves the id while a create issues a new one. The second replaces an earlier,
     weaker idea — asserting that `updated_at` advanced — which cannot be relied on,
     since whether GitHub bumps it on a PATCH with a byte-identical body is not
     contractual. Id stability is contractual, and it is a specific observed value
     rather than a count.

   - **Ownership is bot-authored *and* marker-leading, exactly as this record defines
     it.** The verifier's rule must not be *stricter* than the Action's. It was until
     the deep review of [#143](https://github.com/mbeacom/adrkit/pull/143): counting any
     marker-leading comment as ours let anyone who can comment turn the check red with
     one line that renders invisibly, and the failure text then blamed #107 for a defect
     that did not exist. A non-bot marker-leading comment is now reported as an
     *impostor* and never counted toward the duplicate rule.

   **What this rung does not cover.** After a pull request's first push its comment
   already exists, so a dispatch that writes *nothing* satisfies both assertions — one
   comment, same id, which is precisely what a no-op produces. The gate therefore
   catches the inverse of #107 on every newly-opened pull request's first run, and not
   on subsequent pushes within one pull request; the rung-2 artifact, which runs against
   a fresh reference pull request, covers the create-then-update pair from a clean state.
   Closing it at rung 1 would mean either an Action **output** naming what it wrote —
   rejected, because expanding a published contract to serve a test is the wrong
   direction, and because a self-report is the evidence #107 already defeated — or
   deleting the prior comment before each run, which would notify every subscriber on
   every push. Stated as a bounded limitation rather than closed badly.

   Still open: making `action-dogfood` a required check on the `main` ruleset, which
   cannot happen until it has run green at least once, since it skips on the pull
   requests that cannot satisfy it. Two operational facts belong with that step, because
   both live in repository settings rather than in this repository: the check is named by
   the **job id `action-dogfood`**, so renaming or relocating that job leaves every pull
   request waiting on a check that will never report, which only an administrator can
   clear; and disabling the gate means removing it from the ruleset, not editing
   `ci.yml`, since a workflow edit lands in the same pull request the gate is blocking.
10. [ ] **Deferred, tracked separately.** `v0` is a moving tag with no documented
    rollback, so recovering from a bad Action release depends on a maintainer knowing
    to force-move it by hand.
