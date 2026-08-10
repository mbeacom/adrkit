---
schemaVersion: 0.1.0
id: "0024"
title: Ship badges as recipes over existing output, not a new CLI surface
status: proposed
date: 2026-08-09
deciders: ["@mbeacom"]
tags: [distribution, docs, site, ci, privacy, governance]
scope: org
reversibility: two-way-door
blastRadius: team
relatesTo: ["0004", "0011", "0014", "0016", "0019", "0021"]
affects:
  - type: path
    pattern: "site/public/badge/**"
  - type: path
    pattern: "site/src/content/docs/badges.mdx"
  - type: path
    pattern: ".github/workflows/adr-queue-badge.yml"
provenance:
  authoredBy: agent-drafted
review:
  tier: async
  tierReason: >-
    Adds a static asset, a documentation page, and a workflow, and creates no new
    published API. The two expensive options — an `adr badge` CLI surface under
    the lockstep semver contract, and a computed endpoint on the schema origin —
    are refused here rather than authorized, so this record does not spend an ARB
    review on surfaces it declines to create.
reviewBy: 2027-02-09
---

# ADR-0024: Ship badges as recipes over existing output, not a new CLI surface

## Context

Adopters want a badge. The request arrives as one thing and is actually three,
distinguished by what the image *claims*:

| Kind | Claim | Verifiable by the viewer? |
|---|---|---|
| Adoption | "this repository uses adrkit" | yes — `docs/adr` is right there |
| Status | "the corpus is clean / N decisions await review" | only if freshly computed |
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
- `shields.io` also caches, and its `dynamic/json` badge fetches JSON from a URL
  the adopter controls.

Adjacent prior art exists but does **not** decide this. `packages/core/test/fixtures/madr-corpus/0008-add-status-field.md`
is MADR weighing a status badge *inside each record* as an alternative to a
`status:` frontmatter field, and its objections are mostly about that shape —
"many badges have to be generated… for each ADR number," hard to read in
markdown source. None of that transfers to one repository-level badge. The
single portable point is its first con, reliance on the online service
shields.io, and that is answered here by also shipping a committable SVG rather
than by declining to ship a badge. Recorded so this fixture is not later cited
as support it does not provide.

Finally, adrkit already has a settled position on what `adrkit.dev` serves.
ADR-0011 made the origin a **static, versioned, immutable** host for bytes
derived from a source of truth in git, chosen specifically because "a static docs
deploy can serve a static JSON file at a fixed path for free… with no extra
infrastructure." A badge endpoint that computes anything per request is a
different kind of thing on that origin, and ADR-0004 puts the source of truth in
git with no authoritative service behind it.

### What measurement changed

An earlier draft of this record deferred a computed badge on the premise that it
required a new CLI surface (`adr badge`) under the lockstep semver contract.
**That premise is false**, and the correction is why this record ships a status
badge instead of postponing one:

1. **`QueueReport` v1 already carries everything a badge needs.**
   `adr queue --format json` emits `totalItems`, `asOf`, and `corpusFingerprint`
   as top-level fields. The depth is already a scalar; nothing needs computing.
2. **shields reads it with no adrkit code.** Observed directly: a
   `dynamic/json` badge with `query=$.version` against this repository's raw
   `package.json` rendered `adrkit version: 0.4.0`.
3. **Its failure renders are honest.** A missing file renders
   `resource not found`; a missing key renders `no result`. Neither shows a
   plausible-looking number.
4. **Queue *depth* does not depend on `asOf`.** `buildQueueReport` selects items
   by `record.frontmatter.status === 'proposed'` and uses `asOf` only for
   per-item SLA state and deadlines (`packages/core/src/queue/kernel.ts`). So the
   number a depth badge shows changes only when the corpus changes, and
   regenerating on corpus change — not on a schedule — keeps it correct.

Point 4 is what makes this affordable. A badge over *SLA state* (say, a breach
count) would be `asOf`-dependent: an item crosses its deadline with no commit at
all, so the artifact would need a scheduled rebuild, and a scheduled rebuild
means a bot commit every day whether or not anything happened. Depth costs
nothing and stays true; breach count costs daily churn to stay true. They look
like the same feature and are not.

The verification above covers the shields mechanism and the kernel's behavior. It
does **not** cover an end-to-end render against a published `queue.json`, because
none exists yet; that is an action item, per ADR-0016.

## Decision

**Badges ship as documented recipes over output adrkit already produces. No new
CLI surface, and nothing computed on our origin.**

### 1. A static adoption badge, delivered as bytes the adopter owns

The claim is "this repository records decisions with adrkit," linking to the
adopter's own `docs/adr`:

```md
[![ADRs: adrkit](https://img.shields.io/badge/ADRs-adrkit-cb492d)](./docs/adr)
```

A committable SVG is also published under `site/public/badge/` for adopters who
prefer to vendor the image rather than depend on `shields.io` at all.

The colors are the site's own palette, converted from its `oklch` tokens to
sRGB: `#cb492d` (`--adr-coral`) and `#1d1311` (`--adr-ink`). The Actions
`branding.color` fields in `packages/ci` are a *different* system — GitHub
restricts those to a fixed named palette — so the two are not expected to match
and neither should be changed to chase the other.

**We do not encourage hot-linking `adrkit.dev` for the badge.** Not because it
would be heavy, but because it is the one form of this that quietly turns README
renders into a usage signal we never decided to collect. `camo` blunts that on
GitHub and not everywhere else, and "mostly proxied" is not a privacy posture.
Serving the file so adopters can *take* it is different from asking them to
point at us.

### 2. The status badge that already exists, documented rather than rebuilt

A workflow running `adr check` (or the `@adrkit/ci` Action) already produces a
GitHub Actions badge with no new code:

```md
[![ADRs](https://github.com/OWNER/REPO/actions/workflows/adr.yml/badge.svg?branch=main)](https://github.com/OWNER/REPO/actions/workflows/adr.yml)
```

This is not immune to staleness — a workflow that stops triggering keeps showing
its last conclusion. It is *honest under staleness*, which is the property that
matters. Its claim is past-tense and attributable: "the last run of this workflow
concluded X," with the run, its date, and its logs one click away. A present-tense
claim about the corpus has no such anchor.

### 3. A queue-depth badge, as a recipe over `adr queue --format json`

The one number no other tool can produce. A workflow regenerates the queue report
on corpus change; shields reads the committed artifact:

```md
[![ARB queue](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FOWNER%2FREPO%2Fmain%2F.adrkit%2Fqueue.json&query=%24.totalItems&label=ARB%20queue&suffix=%20pending&color=blue)](./docs/adr)
```

Three constraints hold this to the honest shape:

- **Badge `$.totalItems`, not SLA state.** Depth is `asOf`-independent (see
  Context); anything derived from deadlines is not, and silently rots between
  scheduled rebuilds.
- **Regenerate on corpus change, and commit only when the content changes.** No
  schedule, therefore no daily bot commit, therefore no reason for anyone to
  disable the workflow that keeps the badge true.
- **The artifact is generated, and lives where that is obvious.** `.adrkit/queue.json`,
  not inside the hand-authored corpus directory. Discovery tolerates a stray
  `.json` under `docs/adr/` — verified, no findings — so this is a legibility
  choice, not a correctness one.

Pair it with §2. The depth badge cannot detect its own staleness; nothing written
at generation time can. If regeneration stops, the workflow badge beside it goes
red or blank, which is where that signal belongs.

### 4. Refused: a new CLI surface, and a hosted endpoint

- **No `adr badge`.** It would add public surface under the lockstep semver
  contract to reformat a field `adr queue --format json` already emits.
- **No hosted badge service.** It would add an availability dependency to every
  adopter's README, put a computed endpoint on the origin ADR-0011 deliberately
  made static and immutable, and make badge renders a de-facto telemetry stream
  about who uses adrkit — a data-collection decision disguised as a rendering
  detail.

## Options considered

### Option A: Recipes over existing output — adoption SVG, workflow badge, shields over `queue.json` (chosen)

| Dimension | Assessment |
|---|---|
| Truthfulness | Every shipped claim is verifiable, or past-tense and linked |
| New public surface | None — no CLI flag, no endpoint, no schema change |
| Cost | One SVG, one docs page, one workflow |
| Ongoing churn | Only when the corpus changes |
| Reversibility | Two-way door; delete the workflow and the snippets |
| Risk | Depends on shields.io for two of three badges |

### Option B: Build `adr badge` to emit shields `endpoint` JSON

**Pros:** one command instead of a documented `jq`-free recipe; adrkit controls
the rendered label, color, and thresholds rather than leaving them to a URL.
**Cons:** it is a published surface under the lockstep contract whose entire job
is reformatting `totalItems`, a field already emitted. It also concentrates the
staleness problem in a command that *looks* authoritative while being exactly as
stale as the file it wrote. Reconsider only if the URL recipe proves unusable in
practice — not to avoid a long URL.

### Option C: Host a badge endpoint on adrkit.dev

**Pros:** always current; no adopter CI wiring; strongest adoption signal.
**Cons:** contradicts ADR-0004 and puts a computed surface on the origin
ADR-0011 froze as static and immutable; every adopter README gains an uptime
dependency on us; and it collects usage data as a side effect of rendering.
Rejected on posture, not on effort.

### Option D: Adoption badge only; no status badge at all

**Pros:** nothing can go stale; smallest possible surface.
**Cons:** forfeits the one badge that carries information — queue depth is the
number that prompts action, and §3 shows it can be shipped truthfully for the
cost of a workflow. Declining it would be caution spent where there is no
correctness gain.

### Option E: Do nothing

**Pros:** zero work. **Cons:** badges are how this category advertises itself,
and the adoption badge has no truth problem at all. Forfeits distribution value
(ADR-0019) for nothing.

## Trade-offs

**Staleness is mitigated, not solved.** A committed `queue.json` renders its last
value forever if the workflow is deleted. Nothing generated at write time can
detect its own staleness — only a reader can, and shields will not compare `asOf`
to today. Pairing with the workflow badge is a real mitigation and not a proof.
Adopters who want a hard guarantee should read §2's badge as the primary signal
and §3's as the interesting number beside it.

**Two of three badges depend on shields.io.** The committable SVG exists as an
escape hatch for the adoption badge, but there is no offline form of the depth
badge — a dynamic value from a static site necessarily involves a renderer. That
is a dependency this record accepts explicitly rather than discovers later.

**The recipe URL is long and hand-edited.** `OWNER/REPO`, branch, and path are
all inline, and getting one wrong renders `resource not found` — visible, but
only if someone looks. This is the strongest argument for Option B, and it is
recorded here so a future reader can weigh it against the surface cost rather
than rediscovering it.

**Publishing an SVG under `site/public/`** puts a non-derived asset next to bytes
ADR-0011 requires to be generated and byte-checked. The badge is not schema
output and no guard should imply it is; a dedicated `badge/` directory is what
keeps that boundary legible.

**Depth is a weaker signal than health.** `ARB queue: 0` means nothing is
awaiting review; it does not mean the corpus is well-governed, and a repository
with no proposals and no discipline renders identically to a diligent one. The
badge reports a fact, not a grade — deliberately, per ADR-0021's refusal to let
an artifact claim more than it can support — but readers will over-read it.

## Consequences

- Easier: adopters can signal usage and surface review backlog today, with no
  new adrkit surface to version, deprecate, or support; the hosted variant stops
  needing re-argument each time it is proposed.
- Harder: three badge stories to explain instead of one; a long URL to keep
  correct in docs; and a standing obligation to keep `QueueReport` v1's
  `totalItems` stable, because README badges in other people's repositories now
  read it. That last one is a real compatibility constraint created by this
  record.
- **How we would know this was wrong:** the depth badge is widely copied and then
  widely stale (measurable as repositories whose `queue.json` lags their corpus),
  which would argue for Option B's thresholds and an explicit staleness render;
  *or* the URL recipe proves too error-prone to document, which argues the same
  way. Conversely, if nobody adopts any badge within two release cycles, ship
  less. Review by 2027-02-09.
- Revisit if: `QueueReport` reaches v2 and `totalItems` moves or changes meaning
  — external badges make that a breaking change with no deprecation path; or a
  second surface needs a dynamic endpoint on `adrkit.dev` and forces ADR-0011's
  static-origin property to be reopened on its own merits.

## Action items

1. [ ] Verify the depth badge end to end against a published `.adrkit/queue.json`
       — the shields mechanism and failure renders were observed, the full path
       was not (ADR-0016).
2. [x] Fix the badge's brand color against the site palette — resolved to
       `#cb492d` / `#1d1311`, converted from `site/src/styles/custom.css`.
3. [ ] Add `site/public/badge/` with the committable SVG, and confirm no
       schema-derivation guard treats it as generated output (ADR-0011).
4. [ ] Write `site/src/content/docs/badges.mdx`, wire it into the sidebar, and
       link it from the CI page.
5. [ ] Note the `totalItems` compatibility constraint wherever `QueueReport`
       versioning is documented, so a v2 does not break external badges silently.
