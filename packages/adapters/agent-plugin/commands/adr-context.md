---
description: "Load the architecture decisions that govern the paths you are about to change, before planning against them. Read-only."
argument-hint: "[paths...]"
---

## Resolve the CLI first

Try, in order: `$ADRKIT_CLI`, then `./node_modules/.bin/adr`, then `adr` on
`PATH`. `@adrkit/cli` is normally a dev dependency, so a bare `adr` is **not** on
`PATH` in most projects — trying only that and concluding "no CLI is available"
is a false negative. If all three fail, say so and tell the user to install
`@adrkit/cli`. Never fall back to reading ADR frontmatter by hand: it cannot
expand glob matchers, cannot read inbound `@adr` markers, and has no exit code,
so it produces an answer that looks complete and is not.

Load the decision record governing `$ARGUMENTS` into context, so the plan that
follows is informed by it rather than corrected at review time.

1. Treat every argument as a repo-relative path the work will touch. Real paths
   give a far sharper answer than none.

2. Resolve the governing decisions.
   - With the `adrkit` MCP server connected, call
     `get_decision_context(files: [...])`.
   - Otherwise run `adr check $ARGUMENTS --json`.
   - With no arguments, run `adr queue` instead: every decision still `proposed`,
     with its SLA state. Those are the questions already open. Planning against
     them as if settled is the mistake this command exists to prevent.

3. Also pull the already-rejected records, with `search_decisions` and
   `status: ["rejected"]` (or `adr graph`), so a rejected option is not
   re-proposed as a fresh idea. `list_superseded` will not do here: it returns
   only records whose status is `superseded`, never a rejected one.

4. Report what you loaded, in three groups, and keep them distinct:
   - **Binding** (`governedBy` / `governing`) — follow these, or say plainly in
     the plan that you are departing from one and why.
   - **In flight** (`activeProposals`) — not binding. Name any the work touches;
     never assume one will land.
   - **History** — superseded and rejected. This is where "we already tried
     that" lives.

5. On a non-zero exit, read stderr and report it verbatim. Exit `1` means the
   corpus has error-severity findings — the report is still complete and still
   worth reading. Exit `2` means a bad invocation or an unreachable corpus.
   Neither is "nothing governs this."

Read-only: this command writes nothing. The corpus defaults to `docs/adr` and is
overridable with `ADRKIT_DIR`.
