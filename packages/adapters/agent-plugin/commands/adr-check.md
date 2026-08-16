---
description: "Check the current change, or a plan, against the decisions that govern it and report a verdict per decision. Read-only."
argument-hint: "[paths-or-plan-file...]"
allowed-tools: ["view", "grep", "glob", "bash"]
---

Reconcile `$ARGUMENTS` against the decision record that governs it.

1. Establish the target paths.
   - Arguments that are paths are the target set.
   - An argument that is a plan or spec document: read it and extract the paths
     it touches.
   - No arguments: use the working tree's changed paths — both tracked and
     untracked:

     ```bash
     git diff --name-only HEAD
     git ls-files --others --exclude-standard
     ```

     The second command is not optional. `git diff` reports only tracked files,
     so a brand-new source file — the case most likely to introduce something a
     decision governs — is invisible to it, and the check would report a clean
     result for a change it never looked at.

     If both are empty, say the check is unscoped and ask for paths rather than
     checking everything and reporting noise.

2. Run the check.

   ```bash
   adr check <paths...> --json
   ```

   Or call `get_decision_context(files: [...])` on the `adrkit` MCP server.

3. Add the non-binding context: `adr queue` for decisions still `proposed`, and
   the graveyard for anything already rejected. Re-proposing a rejected option
   is a finding even when it conflicts with nothing currently binding.

4. Give **one verdict per governing decision**, never one verdict for the whole
   change: `complies`, `departs`, `supersedes`, `unreconciled`, or
   `re-proposes-rejected`. For anything other than `complies`, state what the
   decision requires, what the work does instead with a `path:line`, and which
   resolution applies — comply, justify the departure in the plan, or supersede
   the record.

5. Close with the honest gaps: paths that resolved to nothing, `affects`
   matchers too coarse to be conclusive, and whether a corpus error finding is
   polluting the result.

Interpret the exit code rather than collapsing it: `0` clean; `1` findings, with
a complete report still worth reading — for `check` that means a *changed ADR
record* carries an error-severity finding, since a governed source file changing
is reported rather than failed; `2` usage error or unreachable corpus.

Read-only. If the answer is "this needs a new ADR," say so and stop — use
`/adr-draft` deliberately rather than writing a record as a side effect.
