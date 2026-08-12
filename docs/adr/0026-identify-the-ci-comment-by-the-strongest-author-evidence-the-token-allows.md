---
schemaVersion: 0.1.0
id: "0026"
title: Identify the CI comment by the strongest author evidence the token allows
status: proposed
date: 2026-08-12
deciders: []
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
    pattern: "packages/ci/action.yml"
provenance:
  authoredBy: agent-drafted
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
| `app-installation` | that call was refused with 401/403/404 and the run was not throttled | `user.type === "Bot"` **and** the marker is exactly the body's **first line** |
| `unknown` | it failed any other way, including a throttled 403 | nothing is adopted |

A permission-shaped refusal of `users.getAuthenticated` is not an absence of
information. It is exactly how an app installation token is refused, so it is positive
evidence that the caller is an app and therefore a **bot**. That is one of the two
signals FR-005 wanted, and it is the one that excludes the case FR-005 named — a human.

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
never obtained. One duplicate comment that self-heals on the next run is the right cost
for that. It is now **logged as a warning** rather than passing silently, which is what
made this defect look like normal operation for two releases.

Where several comments match, the **last** one wins rather than the first. Every pull
request opened before this fix carries one comment per push, and the newest is both the
one a reader reaches at the bottom of the thread and the one worth keeping current. The
Action is comment-only and deletes nothing, so the older copies remain until a human
removes them.

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
4. [x] Cover the app-installation path, including the negative cases a human and a
   quoting bot present, watched failing first per ADR-0016.
5. [x] Remove the obsolete `env: GITHUB_TOKEN` block and its rationale from
   `specs/004-ci-surface/quickstart.md`, which documented the broken model.
6. [x] Note in `site/src/content/docs/ci.mdx` that a `v*` release tag is annotated, so
   `uses:` needs the dereferenced commit rather than the tag object's own SHA.
7. [ ] Confirm on a reference repository that a second push updates the comment
   ([ADR-0014](./0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
   rung 2); rung 1 is the unit and contract coverage above.
