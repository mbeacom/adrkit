---
description: "Draft one new ADR from the decision the current work actually makes. Writes a single new record, as proposed."
argument-hint: "[decision title]"
---

## Resolve the CLI first

Try, in order: `$ADRKIT_CLI`, then `./node_modules/.bin/adr`, then `adr` on
`PATH`. `@adrkit/cli` is normally a dev dependency, so a bare `adr` is **not** on
`PATH` in most projects — trying only that and concluding "no CLI is available"
is a false negative. If all three fail, say so and tell the user to install
`@adrkit/cli`. Never fall back to reading ADR frontmatter by hand: it cannot
expand glob matchers, cannot read inbound `@adr` markers, and has no exit code,
so it produces an answer that looks complete and is not.

Draft one architecture decision record for `$ARGUMENTS`.

**Check first, then write.** Before scaffolding anything:

1. Run `/adr-check` over the paths this decision would govern, or
   `adr check <paths...> --json` directly. If an existing decision already
   covers this, do not write a second record — either the work complies, or the
   right output is a record that **supersedes** the existing one. A duplicate
   record is worse than none, because it makes the corpus ambiguous.

2. Check for an existing rejection, with `search_decisions` and
   `status: ["rejected"]` (or `adr graph`) — not `list_superseded`, which
   returns only `superseded` records and never a rejected one. If this was
   already rejected, say so and stop. Re-proposing it needs a human reason, not a
   scaffold.

Then create exactly one record:

```bash
adr new "<title>"
```

Fill in what the scaffold leaves open:

- **`status: proposed`.** You are drafting, not ratifying. Do not write
  `accepted` — ratification is a human act, and a record that claims to be
  accepted when nobody accepted it corrupts every downstream check.
- **`provenance.authoredBy: agent-drafted`.** `adr new` scaffolds
  `authoredBy: human`, and it has no flag to change that — so a record you
  drafted ships claiming a human wrote it unless you correct it. Two things
  break if you leave it. The audit trail can no longer separate agent-originated
  decisions from human ones, which is the reason the field exists. And the
  `agent-accepted-requires-ratifier` invariant only fires for `agent` and
  `agent-drafted`, so a record mislabeled `human` can later reach `accepted`
  with no named ratifier — the guard is disarmed by the mislabel, silently.
- **`deciders`** — the humans who will actually decide, not you.
- **`affects`** — the matchers binding the decision to the code it governs. A
  record with no `affects` matcher governs nothing: it never surfaces in
  `explain`, `check`, or CI, so it is documentation rather than decision memory.

  ```yaml
  affects:
    - type: path
      pattern: "src/db/**"
  ```

- **`supersedes`** — set it on **this** record when it replaces an earlier
  decision. Do **not** touch the record it replaces.

  That restraint is load-bearing, and getting it wrong is worse than leaving it
  alone. A drafted record is `proposed`, so it governs nothing yet. Flipping the
  predecessor to `status: superseded` in the same edit therefore leaves the
  affected paths governed by **neither** record — the old one has become
  historical and the new one is not binding. In a governance tool, silently
  un-governing a path is the worst available outcome. It is also schema-invalid:
  `superseded` requires a `supersededBy`, so `adr lint` fails with
  `superseded-requires-supersededBy`, and the now-invalid record drops out of the
  corpus, which makes your own `supersedes` reference dangle as well.

  Leave the predecessor `accepted` and untouched. It keeps governing until a
  human ratifies the replacement, which is exactly right — the question is still
  open. The reciprocal change, setting the old record to `status: superseded`
  with `supersededBy`, belongs to ratification, not drafting. State plainly in
  the new record which decision it would replace.
- **Context, Decision, Consequences** — and the **alternatives actually
  considered and rejected**. The rejected option is usually the more valuable
  half of the record; it is what stops the next person re-proposing it.

Validate before you report done:

```bash
adr lint
```

Report the path of the record you created, its id, and — plainly — that it is
`proposed` and awaiting human ratification. Write exactly one record. If the
work made two decisions, say so and let the caller ask for the second.
