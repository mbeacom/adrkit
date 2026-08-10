---
schemaVersion: 0.1.0
id: "0023"
title: "Read a marker only where the format hides it: fences and markdown prose"
status: accepted
date: 2026-08-10
deciders: ["@mbeacom"]
tags: [core, matching, governance, agents, docs]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0016", "0021", "0022"]
affects:
  - type: path
    pattern: "packages/core/src/markers/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: async
  tierReason: >-
    Narrows an existing heuristic inside one pure function. No schema change, no
    new surface, no I/O, and the change can only ever remove a declaration or add
    one in a comment form nobody could previously use. What makes it more than a
    bug fix is that ADR-0021 stated the fenced-example false positive as an
    accepted cost of refusing to parse, so the argument for why this is still not
    parsing belongs in a record rather than in a commit message.
reviewBy: 2027-02-10
---

# ADR-0023: Read a marker only where the format hides it: fences and markdown prose

## Context

ADR-0021 shipped inbound `@adr` markers with one rule doing all of the work: a
marker counts when a comment introducer begins the physical line and `@adr` is
the comment's first content. The rule is deliberately language-agnostic, and it
earned that. Issue #97 measured it cutting marker-looking lines on this
repository from 51 to 4.

Issue #101 then measured what the remaining four were. Three are fenced examples
**in our own documentation of the feature**, and all three resolve:

```
$ adr explain packages/cli/README.md
Decisions governing packages/cli/README.md:
  0012  [accepted] Bind catalog entities to owned paths with an explicit annotation
    declared by packages/cli/README.md:34 (@adr 0012)
```

ADR-0012 has nothing to do with the CLI README. The file is *showing the syntax*
and the scanner reads it as *using the syntax*. The status is `accepted`, which
is the bucket an agent treats as binding, so the failure mode is not cosmetic:
it is the class ADR-0012 itself called "the worst class of bug this project can
ship" — silently reclassifying which decisions govern which code.

Reviewing #106 surfaced a second lane of the same defect that no measurement had
covered, because this repository happens not to contain an instance. The
introducer list includes `#` and `*`. In markdown those are a heading and a list
bullet:

```
# @adr 0012
* @adr 0012 explains this
```

Both declare today. Neither is a comment — both render, and a reader sees them.

Two things changed the cost of leaving this alone. First, #106 wires markers into
`adr check` and the Action, so a false positive stops being a local `explain`
oddity and starts appearing in a pull-request comment that reviewers read.
Second, ADR-0021's own exit condition names this: *"the comment-introducer
heuristic produces false positives that cannot be silenced without a per-language
parser. Either reopens this record."* The claim under test is the "cannot" — and
it is false for these two lanes.

## Decision

**A marker is read only where the file's own format hides the line from its
output. Two rules, both line-lead, neither a parser.**

**1. A marker inside a fenced code block is an example, not a declaration.**
CommonMark-lite fence tracking: a run of three or more backticks or tildes as the
line's first content (after at most three spaces) opens a block; it closes only
on a line of at least as many of the *same* character and nothing else. A longer
fence closes a shorter one and never the reverse, ``` and ~~~ do not close each
other, a backtick fence's info string may not itself contain a backtick, and an
unclosed fence runs to the end of the window — which is what stops an example at
the end of a document from un-fencing everything above it.

**2. In a markdown file, the introducers are markdown's, not a source
language's.** `.md`, `.mdx`, and `.markdown` accept `<!--` and `{/*` and nothing
else. `{/*` is added to the shared list at the same time, because MDX rejects an
HTML comment outright and that dialect would otherwise have no way to declare at
all. Observed rather than assumed — adding `<!-- @adr 0012 -->` to a page under
`site/` fails the build, and MDX names the replacement itself:

```
Unexpected character `!` (U+0021) before name, expected a character that can
start a name, such as a letter, `$`, or `_`
(note: to create a comment in MDX, use `{/* text */}`) (mdx-jsx:unexpected-character)
```

### Why this is still not a parser

ADR-0021 refused per-language parsing, and this record keeps that refusal. The
test it has to pass is not "is this markdown-aware" but "does this require
knowing the language of the file."

- **The fence rule reads exactly one thing per line: what the line starts with.**
  That is the same primitive the marker rule already uses. It carries one bit of
  state across lines — open or closed — and that state is derived from line-leads
  only. Nothing is tokenized, no construct is nested, and no grammar is consulted.
  A fence in a `.ts` file is treated the same as a fence in a `.md` file, because
  the scanner does not know or ask which it is.
- **The markdown rule is a statement about a format's comment syntax, not about
  its content.** It changes *which line-leads count*, not *how a line is read*.
  `#` is a comment in a shell script and a heading in markdown; that is a fact
  about the two formats, available from the path the caller already passes for
  provenance. Choosing an introducer set by extension is one lookup. Parsing
  markdown would mean knowing that `#` inside a list item at column five is still
  a heading, and this does not.

The honest way to state it: ADR-0021 said adrkit does not parse the file, and it
still does not. What it did not say, and should have, is that the introducer list
was always a *union of source-language comment syntaxes* — and applying that
union to a prose format was the bug, not the absence of a parser.

### Both rules only ever subtract, with one named exception

Rule 1 and rule 2 can only remove a declaration. A marker that resolved before
and resolves now is untouched; nothing new becomes governed. The single exception
is `{/*`, which adds a form that previously could not declare anywhere — recorded
here rather than smuggled in as a side effect of rule 2.

That direction is deliberate. A missed declaration is a file that does not get
extra context. An invented one is an agent told that an `accepted` decision binds
code it has never governed. ADR-0021 already chose this asymmetry for the ref
grammar (`@adr 0012 1234567` reads one reference, not two); this applies it to
the line rule.

## Options considered

The four options below are #101's own list, plus the lane that reviewing #106
added.

### Option A: Fence tracking plus markdown's own introducers (chosen)

| Dimension | Assessment |
|---|---|
| Correctness | Fixes all three measured instances and the unmeasured `#`/`*` lane |
| Fidelity to ADR-0021 | Keeps the line-lead rule and the no-parser refusal; narrows the introducer union it never justified |
| Failure direction | Subtracts declarations; the one addition (`{/*`) is named |
| Cost | ~30 lines in one pure function, one bit of cross-line state |
| Reversibility | Two-way door — nothing is persisted, no schema, no output shape |

### Option B: Leave it, and rely on ADR-0021 already stating the trade-off

**Pros:** zero code; the record is honest about the limitation, which is more
than most projects manage.
**Cons:** a stated bug is still a bug. It is also getting worse rather than
staying still: #106 moves markers from a local `explain` command onto the
pull-request comment, so the three instances become reviewer-facing. And the
record's own "how we would know this was wrong" criterion has now fired, which
makes "the record says so" a reason to reopen it rather than a reason to close
the issue.

### Option C: Change our own documentation so the examples do not lead the line

**Pros:** the smallest possible diff; fixes the three visible instances today.
**Cons:** it fixes this repository and nobody else's. Every downstream project
that documents the marker syntax inherits the same false positive, and the only
advice we could give them is "indent your examples." It also makes our
documentation worse to make our tool look correct, which inverts the relationship
between the two. It does nothing at all for the `#`/`*` lane.

### Option D: A per-language parser, or an opt-out comment (`@adr-ignore`)

**Pros:** a parser is exact; an opt-out is explicit and needs no format knowledge.
**Cons:** the parser is the thing ADR-0021 exists to refuse, and it would need a
grammar per language forever. The opt-out is worse than it looks: it makes the
*documentation author* responsible for suppressing a claim the tool invented, and
it only works if they already know the tool misread their file. A default that is
wrong until annotated is not a default.

### Option E: Do nothing about markdown, fence-only

**Pros:** matches the literal text of #101 and keeps the diff smaller.
**Cons:** it fixes the lane with instances and leaves the lane without them, even
though `* @adr 0012 explains this` is the same defect and needs the same
argument. Splitting one decision across two records means the second one has to
re-argue the first one's premise.

## Trade-offs

**A fence nested in a block-comment continuation is not detected.** In this
shape the fence no longer leads the physical line, so a marker inside it still
declares:

```
/**
 * ```
 * @adr 0012
 * ```
 */
```

This is pinned as a negative test rather than fixed. Detecting it means stripping
a continuation introducer before testing for a fence, which is a per-language
assumption about what a continuation looks like — the line this record is
declining to cross. No instance exists in this repository.

**An indented (four-space) code block in markdown is not detected either.**
Rule 2 already removes `#`, `*`, `//` and the rest from markdown, so the residue
is a four-space-indented `<!-- @adr 0012 -->`. Distinguishing that from a list
continuation requires block context, which is parsing. Recorded, not fixed; no
instance exists.

**The scanner now behaves differently for two files with identical bytes.** A
`.md` and a `.txt` containing the same text resolve differently. That is a real
cost — the pure API's result is no longer a function of the text alone — and it
is why the introducer set is selected from the *extension* and nothing else, so
the dependency is one visible lookup rather than a sniff of the content.

**A marker in a genuinely fenced block is now unreachable.** Anyone who wanted a
declaration inside a fence — for instance in a generated file that wraps its
header — cannot have one. This is the subtract-only direction working as
intended, but it is a capability removed, not merely a bug fixed.

**`{/*` is a scope enlargement.** It closes one of the two false negatives
ADR-0021 recorded. It is included because rule 2 would otherwise leave MDX unable
to declare at all, and answering it for `.tsx` at the same time avoids a rule
that is true in one file type and false in another. The other recorded false
negative — a bare continuation line inside a block comment — is untouched.

## Consequences

- **Easier:** documenting the marker syntax without claiming to be governed by
  the decision used as the example; adopting adrkit in a docs-heavy repository
  where `#` starts most lines.
- **Harder:** the scanner now carries state across lines, so a future change to
  the loop has to keep the fence and the marker rules straight. Two introducer
  sets now exist, and a future entry has to be classified as a comment syntax or
  a prose one rather than simply appended. (Order within a set is *not* load
  bearing: no introducer is a prefix of another, and a candidate that matches the
  line-lead but fails the `@adr` test falls through to the rest of the list
  rather than returning.)
- **How we would know this was wrong:** a `dangling-marker` or missing-declaration
  report traced to fence tracking swallowing a real declaration — the false
  *negative* this trades for. Or a second prose format arriving (reStructuredText,
  AsciiDoc) and needing its own introducer subset, which would mean the extension
  lookup is growing into the per-format table this record says it is not. Two
  entries is a fact about formats; six is a parser wearing a hat. Review by
  2027-02-10.
- **Revisit if:** the block-comment-continuation or indented-code lane acquires a
  real instance, or a consumer asks to declare inside a fence.

## Relationship to ADR-0021 and ADR-0022

This record narrows the introducer rule ADR-0021 set, and contradicts one
sentence of its trade-offs — that a fenced example "still reads as a marker" and
avoiding it "requires language-specific parsing." Under CONTRIBUTING that would
normally call for a superseding record.

It is filed as an amendment instead, for a reason that is mechanical rather than
a matter of taste: `supersededBy` is single-valued, and ADR-0022 (#106) has
already claimed ADR-0021's slot. A second record naming ADR-0021 as superseded
would either lose the link at ratification or encode a corpus state the schema
cannot represent. Recording two supersessions of one record is the falsehood; an
amendment that says exactly which sentence it narrows is not.

If the maintainer would rather this supersede ADR-0021 and ADR-0022 be
re-pointed, that is a one-field change at ratification — noted here so the choice
is made rather than inherited.

## Action items

1. [ ] Ratify or reject; if ratified, decide whether this supersedes ADR-0021 or
       stays an amendment alongside ADR-0022 (see above).
2. [x] Re-measure on this repository, so the next change to the rule has a
       current baseline. Declarations resolved by the scanner over every tracked
       file: **4 before this change, 1 after** — `packages/core/src/check/index.ts:1`,
       the only real one. (#97's reported 51 → 4 counted marker-*looking* lines
       under the pre-#97 rule, which is a different measurement; 4 → 1 here is
       resolved declarations before and after, taken the same way on both sides.)
3. [ ] Decide whether the second false negative ADR-0021 recorded — a bare
       continuation line inside a block comment — is worth closing now that
       `{/*` is closed.
