---
schemaVersion: 0.1.0
id: "0022"
title: Ship a static adoption badge and defer a computed status badge
status: proposed
date: 2026-08-09
deciders: ["@mbeacom"]
tags: [distribution, docs, site, privacy, governance]
scope: org
reversibility: two-way-door
blastRadius: team
relatesTo: ["0004", "0011", "0014", "0016", "0019", "0021"]
affects:
  - type: path
    pattern: "site/public/badge/**"
  - type: path
    pattern: "site/src/content/docs/badges.mdx"
provenance:
  authoredBy: agent-drafted
review:
  tier: async
  tierReason: >-
    Adds a static asset and a documentation page, and records a standing refusal
    to serve a computed badge endpoint from adrkit.dev. The expensive half — a
    `adr badge` CLI surface and anything dynamic on the schema origin — is
    deferred rather than authorized here, so this record does not spend an ARB
    review on a surface it does not create.
reviewBy: 2027-02-09
---

# ADR-0022: Ship a static adoption badge and defer a computed status badge

## Context

Adopters want a badge. The request arrives as one thing and is actually three,
distinguished by what the image *claims*:

| Kind | Claim | Verifiable by the viewer? |
|---|---|---|
| Adoption | "this repository uses adrkit" | yes — `docs/adr` is right there |
| Status | "the ADR corpus is clean / has N proposed records" | only if freshly computed |
| Certification | "this corpus meets an adrkit standard" | no — there is no such standard |

Only the first is true by construction. The second is the one people actually
want, and it is the one that can lie.

**A status badge fails in the opposite direction from a test.** A test that
breaks goes red; that is the whole value. A badge backed by a committed JSON
blob keeps rendering its last written value indefinitely, and the value it keeps
rendering is *green*, because a corpus that was clean at generation time is what
got committed. Nothing about the badge decays visibly when the fact behind it
does. ADR-0016 already names this failure class for tool output — "`0`, `[]`,
and 'no X found' render identically whether the tool looked and found nothing or
could not look at all" — and ADR-0021 refused a marker design that would let a
file make a claim it could not support. A stale status badge is the same
category of artifact: a claim whose evidence has silently left.

Two mechanical facts sharpen this, and both are stated from documented behavior
rather than measured here:

- GitHub renders README images through its `camo` image proxy, which fetches
  server-side and caches. That blunts the privacy concern for GitHub-rendered
  READMEs — an origin sees the proxy, not viewer IPs — and simultaneously makes
  dynamic badges *lag*, because the cached copy is what most viewers get. Other
  renderers (npm package pages, GitLab, docs sites, blogs) do not necessarily
  proxy.
- `shields.io` also caches, and its `endpoint` badge type fetches JSON from a URL
  the adopter controls.

There is also prior art vendored inside this repository. `packages/core/test/fixtures/madr-corpus/0008-add-status-field.md`
is MADR's own record considering shields.io badges for ADR status, and it lists
against them: reliance on an online service, and badge proliferation — one image
per status per record. We ship that argument in our own test fixtures.

Finally, adrkit already has a settled position on what `adrkit.dev` serves.
ADR-0011 made the origin a **static, versioned, immutable** host for bytes
derived from a source of truth in git, chosen specifically because "a static docs
deploy can serve a static JSON file at a fixed path for free… with no extra
infrastructure." A badge endpoint that computes anything per request is a
different kind of thing on that origin, and ADR-0004 puts the source of truth in
git with no authoritative service behind it.

## Decision

**Ship the badge that asserts adoption, document the badge that already asserts
status truthfully, and defer the computed badge until demand exists — while
refusing, now, to host one.**

### 1. A static adoption badge, delivered as bytes the adopter owns

Provide a badge asset and a copy-paste snippet whose claim is "this repository
records decisions with adrkit," linking to the adopter's own `docs/adr`.

Two forms, both static:

```md
[![ADRs: adrkit](https://img.shields.io/badge/ADRs-adrkit-6E56CF)](./docs/adr)
```

and a committable SVG published under `site/public/badge/` for adopters who
prefer to vendor the image rather than depend on `shields.io` at all.

**We do not encourage hot-linking `adrkit.dev` for the badge.** Not because it
would be heavy, but because it is the one form of this that quietly turns README
renders into a usage signal we never decided to collect. `camo` blunts that on
GitHub and not everywhere else, and "mostly proxied" is not a privacy posture.
Serving the file so adopters can *take* it is different from asking them to
point at us.

### 2. Document the status badge that already exists and is honest

A workflow that runs `adr check` (or the `@adrkit/ci` Action) already produces a
GitHub Actions badge with zero new code:

```md
[![ADRs](https://github.com/OWNER/REPO/actions/workflows/adr.yml/badge.svg?branch=main)](https://github.com/OWNER/REPO/actions/workflows/adr.yml)
```

This is not immune to staleness — a workflow that stops triggering keeps showing
its last conclusion. It is *honest under staleness*, which is the property that
matters. Its claim is past-tense and attributable: "the last run of this workflow
concluded X," with the run, its date, and its logs one click away. A computed
corpus badge makes a present-tense claim — "the corpus is clean" — that is simply
false the moment the corpus moves without regeneration, with nothing on the image
to indicate that it moved.

This is documentation work in `site/src/content/docs/`, not product work, and it
likely absorbs most of the demand that reads as "we want an adrkit badge."

### 3. Defer `adr badge`, and constrain it in advance

A computed badge is not rejected — it is unfunded until someone asks for it with
a concrete use. If it is built, it must satisfy all of:

- **Output lands in the adopter's repository, not ours.** `adr badge --json`
  writes shields `endpoint` JSON that the adopter commits or publishes from their
  own Pages; `img.shields.io/endpoint?url=…` renders it. Git stays the source of
  truth (ADR-0004) and adrkit ships no runtime service.
- **The artifact carries its own provenance** — the commit SHA and the UTC
  generation timestamp it was computed from — so staleness is inspectable rather
  than invisible.
- **It must be able to render "unknown."** A badge that can only ever show a
  last-known-good value is the failure mode in the Context section. Regeneration
  is a CI step on the default branch, and its absence has to be expressible.
- **It reports one fact, not a grade.** Counts and check status are facts.
  "adrkit certified" is not, because no such certification exists, and inventing
  one in an image is worse than not shipping it.

### 4. No hosted badge service

Refused now so it is not re-litigated per request. It would add an availability
dependency to every adopter's README, put a computed endpoint on the origin
ADR-0011 deliberately made static and immutable, and make badge renders a
de-facto telemetry stream about who uses adrkit — a data-collection decision
disguised as a rendering detail.

## Options considered

### Option A: Static adoption badge now, documented workflow badge, computed badge deferred (chosen)

| Dimension | Assessment |
|---|---|
| Truthfulness | Every shipped claim is verifiable by the viewer |
| Cost | One SVG, one docs page, one README snippet |
| New failure modes | None — no code, no endpoint, no regeneration to forget |
| Reversibility | Two-way door; assets are additive and removable |
| Risk | Under-delivers against the request most people are actually making |

### Option B: Build `adr badge` (shields `endpoint` JSON) now

**Pros:** answers the real demand; consistent with git-as-source-of-truth if the
JSON lives in the adopter's repo; genuinely useful on an actively-maintained
corpus.
**Cons:** a new public CLI surface under the lockstep semver contract, for a
feature with no requesting user yet; the stale-green failure mode has to be
designed against rather than assumed away; `camo` and shields caching mean it
lags even when correct. Deferring costs nothing, because §3 records the
constraints while the reasoning is fresh.

### Option C: Host a badge endpoint on adrkit.dev

**Pros:** always current; no adopter CI wiring; strongest adoption signal.
**Cons:** contradicts ADR-0004 and puts a computed surface on the origin
ADR-0011 froze as static and immutable; every adopter README gains an uptime
dependency on us; and it collects usage data as a side effect of rendering.
Rejected on posture, not on effort.

### Option D: Do nothing

**Pros:** zero work; nothing to maintain or get wrong.
**Cons:** badges are how this category advertises itself, and the adoption badge
is both the cheapest and the only one with no truth problem. Declining it
forfeits distribution value (ADR-0019) for no correctness gain.

## Trade-offs

The chosen option is deliberately the less satisfying half of the request.
Someone who asks for "an adrkit badge" usually pictures a live corpus status,
and this record hands them a decorative badge plus a pointer to GitHub's own
workflow badge. That gap is the cost, and it is worth paying only because the
satisfying version is the one that can silently misreport.

Recommending `shields.io` for the adoption badge trades our origin's exposure for
a third party's, which is a real dependency even if a ubiquitous one. The
committable SVG exists so that adopters who object have a way out, but two
delivery paths is more surface to keep consistent than one.

Publishing an SVG under `site/public/` puts a non-derived asset next to bytes
ADR-0011 requires to be generated and byte-checked. The badge is not schema
output and no guard should imply it is; keeping it in a dedicated `badge/`
directory is what keeps that boundary legible.

The constraints in §3 are written before any implementation exists, so they are
reasoning, not measurement. If `adr badge` is ever built, they should be
re-derived against a real corpus rather than inherited on this record's
authority.

## Consequences

- Easier: adopters can signal usage today; the honest status badge becomes a
  documented pattern instead of something each project reinvents; the hosted
  variant stops needing re-argument each time it is proposed.
- Harder: two badge stories to explain instead of one, and the more useful one
  is somebody else's feature. Requests for a real status badge will keep
  arriving, and §3 has to be quoted rather than re-reasoned.
- **How we would know this was wrong:** the adoption badge sees no measurable
  uptake within two release cycles (nobody wanted a decorative badge), *or*
  requests for corpus status arrive with concrete use cases and the documented
  workflow badge is repeatedly rejected as insufficient. The first says ship
  less; the second says fund `adr badge` under §3's constraints. Review by
  2027-02-09.
- Revisit if: a computed badge is funded; or a second surface (a directory
  listing, a registry) requires a dynamic endpoint on `adrkit.dev` and forces
  ADR-0011's static-origin property to be reopened on its own merits.

## Action items

1. [ ] Fix the badge's brand color against the site palette; the Action's
       `purple` branding and the placeholder `6E56CF` above are not yet
       reconciled.
2. [ ] Add `site/public/badge/` with the committable SVG, and confirm no
       schema-derivation guard treats it as generated output (ADR-0011).
3. [ ] Write `site/src/content/docs/badges.mdx` covering both the adoption
       snippet and the workflow-badge pattern, and link it from the CI page.
4. [ ] Verify the workflow-badge snippet end to end against a repository running
       `adr check`, including the `?branch=` form — the snippet is quoted from
       documented behavior and has not been observed rendering (ADR-0016).
