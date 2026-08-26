---
name: decision-memory
description: "Use when planning, designing, reviewing, or changing code in a repository that keeps ADRs (usually docs/adr) — to load the decisions that already govern the work, check a plan or diff against them, or record a new decision. Also use when a choice feels already-settled and you cannot find where it was settled."
license: Apache-2.0
compatibility: "Requires the `adr` CLI (@adrkit/cli), resolved from $ADRKIT_CLI, then ./node_modules/.bin/adr, then PATH. The adrkit MCP server is optional and is NOT bundled with this plugin — when a project has connected it separately, its tools provide the same retrieval; otherwise the CLI is the only path, and the only one that can write."
metadata:
  author: Mark Beacom
  version: "0.2.0"
  homepage: https://adrkit.dev
---

# Decision memory

A repository's architecture decisions are usually written down once and then
never read again, so every new plan re-litigates settled questions and every
review discovers the conflict late. This skill closes that loop: read the
decision record *before* planning, check the produced plan against it, and write
a new record when the plan actually decides something.

The corpus is markdown with typed frontmatter under `docs/adr` (override with
`ADRKIT_DIR`). Records carry a status, `affects` matchers binding them to code
paths, and supersession edges.

## The load-bearing idea

**A decision you cannot find is a decision you will make again.** Three failure
modes follow, and each step below exists to prevent one:

1. Planning against decisions nobody loaded → re-litigation.
2. Treating a `proposed` decision as settled → planning on an open question.
3. Ignoring `rejected` and `superseded` records → re-proposing something the
   team already tried and abandoned.

## Retrieval: prefer the MCP tools, fall back to the CLI

If the `adrkit` MCP server is connected, use its tools — they are read-only and
already scoped to this repository:

| Tool | Use it for |
| --- | --- |
| `search_decisions` | Filtered search across the corpus, including `status: ["rejected"]` |
| `get_decision` | One record by id |
| `get_decision_context(files[])` | The decisions governing a set of files |
| `list_superseded` | Records with `status: superseded` — **only** those |

`list_superseded` is narrower than the word "graveyard" suggests: it returns
records whose status is `superseded` and **never** returns a `rejected` one. Use
`search_decisions` with `status: ["rejected"]` for the "did we already rule this
out?" check. Reaching for `list_superseded` there gets you a well-formed, empty
answer and a re-proposed decision the team already rejected.

If the server is not connected, every retrieval below has a CLI equivalent. Do
not silently skip the step because the tools are absent.

### Resolving the `adr` CLI

Try, in order: `$ADRKIT_CLI`, then `./node_modules/.bin/adr`, then `adr` on
`PATH`.

The middle one matters. `@adrkit/cli` is normally installed as a dev dependency,
so a bare `adr` is **not** on `PATH` in most projects. Concluding "no CLI is
available" after trying only the bare name is a false negative, and the failure
it causes is quiet: you fall back to reading ADR frontmatter by hand, which
cannot expand glob matchers, cannot read inbound `@adr` markers, and gives you
no exit code. That produces an answer that looks complete and is not.

If all three genuinely fail, say so and label the result unverified — do not
present hand-read frontmatter as a check.

## Before you plan

Resolve what already governs the work, using the paths you actually intend to
change. Passing real paths gives a far sharper answer than passing none.

```bash
adr explain src/payments/api.ts        # which decisions govern this file?
adr check src/payments/api.ts ...      # governing decisions + corpus findings, as a gate
adr check --json src/... | ...         # the same, machine-readable
adr queue                              # every proposed decision awaiting review, with SLA state
```

Read three things out of the result, and carry all three forward:

- **`governedBy` / `governing`** — binding here. Follow them, or state plainly in
  the plan that you are departing from one, and why. A silent departure is the
  thing this skill exists to prevent.
- **`activeProposals`** — in flight, *not* binding. Name any the plan touches.
  Never assume a proposal will land.
- **`history`** — superseded and rejected. This is where "we already tried that"
  lives. Check it before proposing anything that feels obvious.

If no corpus exists, say so rather than reporting "nothing governs this." Those
are different answers and only one of them is true.

## After you plan, before you implement

Run the same check over the plan's target paths and reconcile every governing
decision explicitly. For each one, the plan must land in exactly one of:

- **Complies** — say which decision and how.
- **Departs** — say which decision, why the departure is justified, and whether
  it warrants a new record superseding the old one.
- **Supersedes** — the plan replaces a decision. That is a new ADR, not a
  footnote.

An unreconciled governing decision is an unfinished plan.

## Recording a new decision

Write a record when the work decides something a future reader would otherwise
have to reverse-engineer: a technology choice, a boundary, a constraint accepted
on purpose, or a rejected alternative worth remembering.

```bash
adr new "Adopt PostgreSQL for the primary datastore"
```

Then fill in the frontmatter the scaffold leaves for you — at minimum `status`,
`deciders`, and the `affects` matchers that bind the decision to the code it
governs. **A record with no `affects` matcher governs nothing**: it will never
surface in `explain`, `check`, or CI, so it is documentation rather than
decision memory.

```yaml
affects:
  - type: path
    pattern: "src/db/**"
```

Record honestly:

- New records are `proposed`, not `accepted`. You are drafting, not ratifying.
  Ratification is a human act.
- Set `provenance.authoredBy: agent-drafted` when you drafted it. `adr new`
  scaffolds `authoredBy: human` and offers no flag to change it, so leaving it
  alone ships a false authorship claim. It also disarms the
  `agent-accepted-requires-ratifier` invariant, which only requires a named
  human ratifier when `authoredBy` is `agent` or `agent-drafted`.
- Record the alternatives that were actually considered and rejected. The
  rejected option is usually the more valuable half of the record.
- Set `supersedes` on the **new** record when it replaces an earlier one, and
  leave the record it replaces alone. Do not flip the predecessor to
  `status: superseded` while drafting: your record is `proposed` and governs
  nothing yet, so that edit leaves the affected paths governed by **neither** —
  the old decision becomes historical and the new one is not binding. It is also
  schema-invalid, because `superseded` requires `supersededBy`; `adr lint` fails
  with `superseded-requires-supersededBy`, and the invalid record then drops out
  of the corpus, dangling your `supersedes` reference too. The predecessor keeps
  governing until a human ratifies the replacement — which is correct, because
  until then the question is still open. Never delete history.

Validate before you finish:

```bash
adr lint          # 0 = clean, 1 = findings, 2 = usage error
```

## Exit codes are a contract, not noise

`adr` distinguishes three outcomes and collapsing them loses the distinction the
caller needs:

- `0` — clean.
- `1` — findings. The report is **complete and still worth reading**; this is
  not a crash. For `check`, it means a *changed ADR record* carries an
  error-severity finding — a governed source file changing is reported, not
  failed.
- `2` — usage error: bad invocation, or an unreachable corpus directory.

Treating `1` as failure and discarding the output throws away the answer.

## Inbound `@adr` markers

A source file can declare the decision it lives under with a marker on a
dedicated comment line inside its first 8192 bytes:

```ts
// @adr 0012
```

`adr explain` and `adr check` read it. Two rules keep a marker from lying, and
both are worth knowing before you write one:

- The comment introducer must begin the physical line, with `@adr` as the
  comment's first content. A trailing `} // @adr 0012`, a string literal, and
  prose discussing a decision are all rejected.
- Inside a ``` or `~~~` fence it is an example, not a declaration. In markdown
  the only introducers are `<!--` and `{/*`, because `#` and `*` are a heading
  and a bullet.

Markers add governance context. They never gain exit-code authority.

## Things not to do

- Do not invent decision ids, statuses, or records. If retrieval returns
  nothing, report nothing found.
- Do not mark a record `accepted` on your own authority.
- Do not edit an existing accepted record to match a new plan. Supersede it.
- Do not treat an absent corpus as an empty one.
