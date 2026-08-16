---
description: "Show the review queue — every decision still proposed, with its SLA state — so open questions are visible before they are planned around. Read-only."
argument-hint: "[--as-of YYYY-MM-DD]"
---

## Resolve the CLI first

Try, in order: `$ADRKIT_CLI`, then `./node_modules/.bin/adr`, then `adr` on
`PATH`. `@adrkit/cli` is normally a dev dependency, so a bare `adr` is **not** on
`PATH` in most projects — trying only that and concluding "no CLI is available"
is a false negative. If all three fail, say so and tell the user to install
`@adrkit/cli`. Never fall back to reading ADR frontmatter by hand: it cannot
expand glob matchers, cannot read inbound `@adr` markers, and has no exit code,
so it produces an answer that looks complete and is not.

Show the decisions still awaiting review.

```bash
adr queue $ARGUMENTS
```

`--as-of YYYY-MM-DD` computes SLA state as of a chosen UTC date (default: today).
`--format json` emits QueueReport v1 instead of markdown. Identical inputs
produce byte-for-byte identical output, so this is safe to diff across runs.

Report:

1. **What is open**, ordered by SLA urgency — overdue first. Each entry is a
   question the team has *not* answered yet.
2. **What that means for current work.** Any proposal touching what is being
   planned right now is a dependency on an unmade decision. Name it. Do not plan
   as though it will land.
3. **Corpus findings.** `corpus.file-skipped` warnings mean records discovery
   could not see — misnamed, or nested below the corpus root. Those are
   `proposed` decisions that would otherwise vanish from the queue silently, so
   surface them rather than passing over them. Being `warn`, they do not change
   the exit code.

Exit codes: `0` report with no error-severity corpus findings; `1` report
emitted complete, with one or more; `2` usage error or unreachable corpus
directory. A `1` is still a full report — read it.

Read-only.
