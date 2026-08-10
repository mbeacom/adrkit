---
schemaVersion: 0.1.0
id: "0022"
title: Scan inbound markers in check and CI without giving them exit-code authority
status: accepted
date: 2026-08-08
deciders: ["@mbeacom"]
tags: [core, cli, ci, matching, governance, agents]
scope: component
reversibility: two-way-door
blastRadius: cross-team
supersedes: ["0021"]
relatesTo: ["0009", "0012", "0014", "0016"]
affects:
  - type: path
    pattern: "packages/core/src/markers/**"
  - type: path
    pattern: "packages/core/src/check/**"
  - type: path
    pattern: "packages/cli/src/index.ts"
  - type: path
    pattern: "packages/ci/src/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    ADR-0021 reached `adr explain`, a command a developer runs against a file
    they already own, and took the `async` tier on that basis. This record points
    the same reader at content a fork pull request authored, inside CI, and
    renders strings derived from it into a comment signed by
    github-actions[bot]. That is a change of kind rather than of degree — the
    first time `@adrkit/core` opens untrusted input in an automated context — and
    it is why this record carries a cross-team blast radius where its predecessor
    carried component. The failure modes are all quiet ones: an existence oracle
    handed to a fork, a live link inside a trusted comment, a 422 turning
    authored content into a failed check. Two of those three were closed by
    review rather than by design, which is the argument for the higher tier
    rather than against it.
reviewBy: 2027-02-08
---

# ADR-0022: Scan inbound markers in check and CI without giving them exit-code authority

## Context

[ADR-0021](0021-resolve-inbound-source-annotations-without-changing-the-schema.md)
shipped inbound `@adr` markers in v0.4.0 and deliberately stopped at one surface.
Its own words:

> `adr explain <path>` only. `checkChanges` stays pure — no filesystem — and the
> `@adrkit/ci` Action bundle is deliberately unchanged. Wiring markers through
> `adr check <files...>` and the Action is a separate decision, because it
> changes what CI enforces.

It closed with that separate decision as an open action item, and with a
one-sentence limit on its own security analysis: the in-tree symlink states it
disclosed "would become a capability delta if a future CI surface scanned an
untrusted fork's paths. This record does not wire markers into such a surface."

This record is that surface, and therefore that separate decision. It does not
revise ADR-0021's reasoning; it answers the question ADR-0021 left open, which
is why it supersedes rather than edits it.

**Why now.** The asymmetry has a cost that only shows up in use. The inbound edge
exists precisely for a file that no `affects` pattern names, and the place a
governing decision most needs to be visible is the pull request — `adr check`
and the Action comment. As shipped, a decision reachable *only* through a marker
is visible in a local `adr explain` and invisible everywhere governance is
actually enforced, including the Spec Kit context script, which calls `adr check`.
That is the inverse of the feature's purpose (#100).

**What genuinely changed since v0.4.0** is not the grammar or the resolver. It is
a willingness to read pull-request-authored file contents inside CI. ADR-0021 was
right to treat that as a distinct decision with its own threat model, and right
that its own analysis did not cover it.

## Decision

**We will scan inbound markers in `adr check <files...>` and the
governing-decisions Action, and no marker-derived information will be able to
change an exit code.**

Three properties make that safe enough to state as a rule rather than an
intention:

1. **The reads stay outside the pure kernel.** Callers scan; `checkChanges`
   receives a complete `SourceMarkerBatchScan` and resolves it. The determinism
   contract — identical inputs, identical output — is unchanged, and
   `markers-purity.test.ts` still holds `checkChanges` to no filesystem import.
2. **Marker findings are advisory by construction.** `dangling-marker` is `warn`,
   `marker-unresolvable` is `info`, `marker-scan-capped` is `warn`. `CheckOutcome.ok`
   and the Action's failure condition read only validation errors on changed ADR
   records — the corpus the repository owns.
3. **A marker claim is rendered as a claim.** Pattern matches render as `via`;
   markers render as `declared by <path>:<line>`, so a reviewer can always see
   which end of the edge asserted the relationship.

### The trust boundary is the comment body, not just the severities

Property 2 is not sufficient on its own, and the gap is worth recording because
it was found by review rather than by design.

The Action posts a comment. GitHub rejects a body over 65,536 characters with a
`422`, which is not a permission error, so it escapes the Action and fails the
job. One 8 KB header window holds roughly 630 marker lines, and each rendered
line carries a path the author also chose: a single added file produced a
70,585-character body. Marker content could therefore fail a check while every
marker *finding* was correctly non-blocking.

A filename is authored content in a second way. Git permits a backtick in one,
and an unescaped inline code span lets ``src/x`[Approved](https://evil.example)`y.ts``
close the span early and render a live link inside a comment authored by
`github-actions[bot]`.

So the rule is stated over the rendered artifact: declarations are capped per
decision, optional finding field/message detail is bounded so a blocking path and
rule survive, and the whole body truncates to a still-marked comment. Every path,
rule, field, and matcher is rendered in a code span it cannot escape, with control
characters escaped rather than delimited. Fence sizing scans backtick runs
iteratively; it never spreads an authored value into a variadic call that can exceed
Node's argument limit before the body limiter runs. "No exit-code authority" means
nothing an author writes can fail the job, by any route.

### Every symlink component is refused

ADR-0021 checked confinement twice — lexically, then on the real path — and
recorded that resolving an in-tree symlink discloses whether its external target
exists. Local callers own their tree, so that was inert. A fork author does not,
so it is not.

`lstat` now rejects **every** symlink component beneath the working tree as
`unreadable`, before the target is resolved or probed. Valid in-tree, broken, and
out-of-tree symlinks render identically, so the scanner cannot be used as an
existence or permission oracle. The cost is explicit and is a behavior change
from v0.4.0: `adr explain` no longer scans a perfectly safe in-tree symlink.

With no symlink in the path, the canonical location is the canonical root plus
the lexical remainder, and it is derived that way rather than obtained from
`realpath` — which rewrites a backslash *inside* a POSIX filename into a
separator, so `src/we\ird.ts` opened `src/we/ird.ts` and reported that file's
markers under a path the caller never named, as `scanned` rather than `absent`.

The check/open race ADR-0021 recorded remains open and remains recorded. The
Action normally scans a static checkout; a workflow that first executes a fork's
code has already granted it more capability than this.

### The scan cap is GitHub's cap

The reader normalizes, deduplicates, and sorts unique paths, scans the first
3,000 with at most 16 reads in flight, and reports absent, unreadable,
out-of-tree, truncated, and skipped paths exactly.

3,000 is not a comfort number. It is `pulls.listFiles`' ceiling. The Action
already refuses to evaluate a changed-file list that reached that ceiling, so
every diff it answers contributes at most 2,999 current/head-side paths to the
marker reader. A rename's previous path still participates in `affects` matching,
but it no longer exists in the checkout and is not handed to the reader. The scan
cap therefore cannot drop a current file: "the Action answered" means "every
current file was read for markers". A lower cap would make marker-only governance
quietly incomplete on large pull requests, which is the one place its absence is
hardest to notice. What the cap still bounds is a local `adr check` handed a
runaway glob.
`@adrkit/ci` holds the assertion that the two caps compose, because
`@adrkit/core` cannot import the provider constant — the dependency runs the
other way.

## Options considered

### Option A: Scan in `check` and the Action, advisory only — chosen

| Dimension | Assessment |
|---|---|
| Governance value | The inbound edge appears where decisions are enforced and where agents read them, which is the reason the edge exists |
| Trust | A pull request can add information to the comment; it cannot change the verdict, by severity and by rendering bound |
| Purity | `checkChanges` keeps its determinism contract; every read is hoisted to a caller |
| Cost | 2,999 files × 8 KB, 16 in flight — measured at 123 ms |
| Reversibility | Two-way door: the callers stop passing `markerScans` and the kernel is unchanged |

### Option B: Scan in `check` and the Action, with markers able to fail the job

**Pros:** a dangling `@adr 9999` becomes enforceable; the inbound edge gets the
same authority as the outbound one, which is arguably more honest.

**Cons:** hands a fork author a lever on the check's verdict. A marker names a
record the corpus does not own and cannot be required to be complete for — a
vendored file, a generated header, a file copied from another repository — so
the failure mode is a red check nobody can silence without editing a file they
may not control. This is the same reasoning that makes `corpus-file-skipped` a
`warn`, applied to input the repository owns even less.

### Option C: Keep ADR-0021's asymmetry — do nothing

**Pros:** no new CI capability at all; the security analysis in ADR-0021 remains
exactly as audited; the Action bundle stays byte-identical.

**Cons:** leaves the feature pointed away from its purpose. The case markers
exist for — a file no pattern names — stays invisible in CI and to the Spec Kit
context script. ADR-0021 recorded this as an open question, not as a settled
end state.

### Option D: Scan only behind an opt-in Action input

**Pros:** consumers choose when to accept the new read capability.

**Cons:** a governance default that must be discovered is a governance default
that is off. It also doubles the tested surface permanently — every marker
behavior needs an on and an off path — to defer a decision this record is
willing to make. Reconsider if a consumer reports a concrete reason to refuse
the scan.

## Trade-offs

What Option A costs, stated as plainly as what it buys:

- **CI reads pull-request-authored file contents.** Bounded — at most 3,000
  regular files beneath the working tree, 8193 bytes each, read-only,
  non-blocking, no traversal, no network, no credentials — but it is a new
  capability, and the bound is the argument, not the intent.
- **Part of the comment is authored by the pull request.** A reviewer sees
  `declared by`, which is honest, but the governing list is no longer sourced
  from the corpus alone. Anyone can make an accepted record appear in the comment
  by writing `// @adr 0007` in a file. It says who claimed it; it cannot verify
  the claim is apt.
- **In-tree symlinks stop being scanned.** A real regression against v0.4.0 for
  repositories that symlink source files, accepted to remove the oracle.
- **`adr check` is no longer a pure function of its arguments.** It opens files.
  Two runs against the same corpus and the same path list can differ if the tree
  changed between them.

## Consequences

- **Easier:** a decision that governs a file only through a marker is visible in
  the pull request, in `adr check --json`, and to any agent surface that already
  calls `check`. Scan states are reported exactly, so "no markers" and "could not
  look" are different answers — the failure ADR-0016 exists to prevent.
- **Harder:** the Action's comment now has two authorship sources, and any future
  change to its rendering has to hold the body bound and the escaping. Both are
  covered by tests observed failing.
- **How we would know this was wrong:** a consumer reports that a fork PR used
  markers to make the governing comment misleading in a way `declared by` did not
  make obvious; or the scan measurably slows a real CI run; or `unreadable`
  symlink reports become common enough that refusing them is worse than the
  oracle was. Review by 2027-02-08.
- **Revisit if:** GitHub raises or lowers the `pulls.listFiles` ceiling the scan
  cap is pinned to; local `adr check` invocations routinely exceed 3,000 paths;
  or a consumer needs the scan to be opt-out (Option D).

## Action items

1. [ ] Reassess the 8192-byte header window against real corpora once markers
       are in use; it is a chosen default, not a measured one — carried forward
       from ADR-0021, still open.
2. [ ] Decide whether record titles and finding messages, which are still
       rendered as free prose in the Action comment, need the same escaping the
       code spans now have.
