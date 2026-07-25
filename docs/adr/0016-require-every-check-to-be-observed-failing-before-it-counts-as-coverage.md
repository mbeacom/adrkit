---
schemaVersion: 0.1.0
id: "0016"
title: Require every check to be observed failing before it counts as coverage
status: draft
date: 2026-07-25
deciders: []
tags: [governance, testing, evidence, quality]
scope: org
reversibility: two-way-door
blastRadius: team
relatesTo: ["0014"]
affects:
  - type: path
    pattern: "packages/*/test/**"
  - type: path
    pattern: "packages/core/src/validate/**"
provenance:
  authoredBy: agent-drafted
review:
  tier: async
  tierReason: >-
    Changes how contributors are expected to write and review checks across every
    package, but is a reversible process convention rather than a schema or
    interface commitment. No external consumer depends on it.
---

# ADR-0016: Require every check to be observed failing before it counts as coverage

## Context

Over a single session closing issues #39–#42, #50, and #51, the same defect
shape appeared four times in four unrelated subsystems:

| Where | The output | What it actually meant |
|---|---|---|
| `adr lint` (#41) | `checked 0 records, 0 errors` | every record was misnamed and invisible |
| `adr queue` (#51) | `0 item(s) \| 0 corpus finding(s)` | a proposed ARB record was invisible |
| `migrate --from madr` (#50) | `has no deciders` | the source named deciders in an unreadable form |
| a proposed test assertion | `filter(f => f.severity === 'error')` is empty | the field could have been renamed |

Each reports success. None is a crash, a stack trace, or a failing test. In every
case the tool had **failed to look**, and rendered that indistinguishably from
having looked and found nothing.

This is worse than a loud failure in a governance tool specifically. A crash gets
fixed; a green check that means "I could not see" gets trusted, and the thing it
was supposed to guard proceeds ungoverned. #41 and #51 both shipped as exit-0
successes while the corpus governed nothing.

**The tell is a check that reports a count or an absence.** Those are the two
renderings where "nothing" and "nothing visible" are the same string. `0`,
`[]`, `no X found`, and a missing section all have this property. A check that
reports a positive assertion about a specific observed thing does not.

The fourth row is the one that generalizes the problem past parsing. It was a
proposed *fix* — tightening an over-broad test assertion — that would itself have
had the defect, because an empty filter result is indistinguishable from a clean
input. The bug reproduces inside its own remedy. That is what moves this from a
run of coincidences to something structural enough to write down.

## Decision

**A check does not count as coverage until it has been observed to fail.**

Concretely, when adding or tightening any assertion, lint rule, or CI gate:

1. Construct an input the check is supposed to reject, and confirm the check
   actually fails on it. "The existing suite still passes" establishes only that
   the assertion does not crash.
2. Keep that input as a permanent negative case, not a throwaway. The artifact
   that proves the check works is the case that makes it fail.
3. Prefer asserting on a specific observed value over asserting on a count or an
   absence. Where a count or absence is genuinely the right assertion, the
   negative case is mandatory rather than advisory, because nothing else
   distinguishes a passing check from a blind one.
4. **When deferring the work to someone else, hand over the failing case, not
   the instruction.** "Verify the tightened assertion actually fires" reads as
   diligence but transfers the entire cost of constructing the input — and the
   recipient has no way to tell whether the author ever built one. An
   instruction to observe a failure, with no failure attached, is a check that
   cannot fail dressed as a handoff.

This is a convention for contributors and reviewers. It is deliberately not
tooling: see Option C.

Clause 4 was added after the rule was violated by a note written *about* the
rule: a deferral instructing a future reader to confirm a tightened assertion
fires, supplied without the record that makes it fire. The convention is easiest
to break at exactly the moment you are explaining it to somebody else.

### The complementary half: report what was examined, not only what was concluded

Observing a check fail proves it *can* see. It does not make blindness visible
in the output when it recurs later. The second half of the remedy is to have the
check state its inputs, so a reader can tell "looked and found nothing" from
"could not look."

Every fix that motivated this record is an instance of it, which is why they are
worth reading together rather than as six separate bugs:

| Before | After |
|---|---|
| `checked 0 records, 0 errors` | + `corpus-file-skipped`, naming each file discovery could not see |
| `0 corpus finding(s)` | + `corpus.file-skipped`, naming the record that never reached the queue |
| `has no deciders` | + `import-deciders-unmapped`, naming the values the parser could not read |

In each case the conclusion was already correct. What was missing was the
observation that produced it. This generalizes past checks: any report about a
system observed with latency — a test suite, a CI summary, a status message
between two agents working in parallel — has this failure mode, because
"there is nothing wrong" and "I cannot see anything wrong" are the same
sentence unless the report says what it looked at.

## Options considered

### Option A: Require an observed failure per check (chosen)

Cheap, needs no new dependency, and attacks the actual mechanism — a check
nobody has seen reject anything is an untested function that happens to live in
a test file. Costs one deliberate red run per assertion.

### Option B: Rely on code review to catch it

**Pros:** zero process cost; already in place.
**Cons:** it is what we were already doing. Three of the four instances were
written, reviewed, and merged. The fourth was proposed by a reviewer who had
just diagnosed the same shape twice. Vigilance is not the constraint — the
failure is invisible by construction, which is precisely why attention does not
catch it.

### Option C: Adopt mutation testing

**Pros:** mechanical, continuous, no reliance on discipline.
**Cons:** disproportionate today. It needs a runner, CI budget, and a triage
process for surviving mutants, and it answers a broader question than the one we
have. Revisit if the negative-case convention is adopted and still misses
instances — that would be evidence the problem needs tooling rather than a rule.

### Option D: Do nothing

The instances are individually cheap to fix once found. But #41 and #51 were
both found by external dogfooding rather than by the suite, months apart from
when they were introduced, and each shipped a period of false assurance. The
cost is not the fix; it is the interval during which governance silently covered
nothing.

## Known instances outside this repository

`mbeacom/adrkit-t018-dogfood` carries an instance in its own validation scripts:
`assert-queue-report.ts` and `assert-managed-issue-body.sh` assert a blanket
absence of corpus findings where they mean the conditional *no findings of
`error` severity* — the script's own header comment states the narrower intent.

The two forms are **equivalent at that repository's current pin** (`bbe63e01`,
where `CorpusFinding.severity` is the `'error'` literal) and diverge only once
#52 lands. That repository has recorded the tightening as a forward dependency,
naming both the target and the fail-quiet risk that a naive
`filter(severity === 'error')` reintroduces — and, per clause 4, supplying the
record that trips the assertions rather than instructing a future reader to
construct one.

Measured, not predicted — and measured **twice, independently, agreeing**. That
repository ran it, and this one re-ran its unmodified `assert-queue-report.ts`
against its corpus rather than relaying the reported number: under #52's head
the corpus still reports `totalCorpusFindings: 0`, the script passes unmodified,
and the QueueReport is byte-identical at `716e21b7…` in both runs. The
tightening is therefore a correctness-of-intent change, not a repair of a break.

The attribution is deliberate. A claim about #52's effect on a downstream
repository is one where each party is interested in a different direction, so
either measurement alone is weaker than the pair. "Measured" that does not say
by whom reads with authority and cannot be traced — the same shape as an
unattributed disclaimer, in a record whose subject is the provenance of
verification.

Recorded here as evidence that the pattern is not local to adrkit, **not** as an
action item. That repository is outside this record's `affects` scope and
outside this project's control; making its maintenance a precondition for
closing this record would create an action item that cannot be completed from
here — which is its own small instance of a check that cannot fail.

## Trade-offs

Requiring a deliberate red run slows each assertion slightly, and the discipline
is unenforceable — nothing prevents someone from asserting they saw it fail. It
buys detection of a defect class that is invisible to the suite by construction,
which is the only kind of bug where "the tests pass" is actively misleading
rather than merely incomplete.

The rule is also easy to over-apply. It is aimed at checks guarding a *corpus*
or an *input* the tool must not silently skip. Applying it to every trivial
equality assertion would be cargo cult.

## Consequences

- **Easier:** trusting a green run; reviewing an assertion, since the negative
  case documents what it is actually for.
- **Harder:** adding a check, by one deliberate failing run; retrofitting the
  existing suite, which this record does not require.
- **How we would know this was wrong:** if a fifth instance of the pattern ships
  *despite* the convention being followed, the problem is not discipline and
  Option C is the answer. Conversely, if twelve months pass with no new instance
  and no contributor friction, it worked.
- **Revisit if:** the convention proves unenforceable in practice, or mutation
  testing becomes cheap enough to subsume it.

## Action items

1. [ ] Ratify or reject — this record is `draft` and agent-drafted; it binds
       nothing until a human accepts it.
2. [x] Carry both directions for the two checks that motivated this. The tests
       accompanying `corpus-file-skipped` and `corpus.file-skipped` already
       assert both that they fire on a skipped file and that they stay silent on
       a clean corpus, and both were observed distinguishing the two before the
       fix landed.
3. [ ] Fold the rule into `CONTRIBUTING.md` if accepted.

Every item above is completable from inside this repository. The external
instance is recorded under "Known instances outside this repository" and is
deliberately not tracked here.
