---
description: "Draft one new ADR from the decision the current work actually makes. Writes a single new record, as proposed."
argument-hint: "[decision title]"
allowed-tools: ["view", "grep", "glob", "bash"]
---

Draft one architecture decision record for `$ARGUMENTS`.

**Check first, then write.** Before scaffolding anything:

1. Run `/adr-check` over the paths this decision would govern, or
   `adr check <paths...> --json` directly. If an existing decision already
   covers this, do not write a second record — either the work complies, or the
   right output is a record that **supersedes** the existing one. A duplicate
   record is worse than none, because it makes the corpus ambiguous.

2. Check the graveyard (`list_superseded`, or `adr graph`). If this was already
   rejected, say so and stop. Re-proposing it needs a human reason, not a
   scaffold.

Then create exactly one record:

```bash
adr new "<title>"
```

Fill in what the scaffold leaves open:

- **`status: proposed`.** You are drafting, not ratifying. Do not write
  `accepted` — ratification is a human act, and a record that claims to be
  accepted when nobody accepted it corrupts every downstream check.
- **`deciders`** — the humans who will actually decide, not you.
- **`affects`** — the matchers binding the decision to the code it governs. A
  record with no `affects` matcher governs nothing: it never surfaces in
  `explain`, `check`, or CI, so it is documentation rather than decision memory.

  ```yaml
  affects:
    - type: path
      pattern: "src/db/**"
  ```

- **`supersedes`** — set it when this replaces an earlier decision, and leave
  the old record in place with `status: superseded`. Never delete history.
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
