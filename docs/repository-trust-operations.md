# Repository trust operations

Companion to
[ADR-0035](adr/0035-execute-the-gates-that-certify-a-pull-request-from-the-default-branch.md)
and issue [#137](https://github.com/mbeacom/adrkit/issues/137).

This file exists so that the difference between **a control that is active** and
**a control that is planned** is written down rather than inferred. ADR-0016's
subject is checks that report success without having looked; a settings change
that is described but never applied has the same shape, and reads identically to
one that was.

The initial configuration was read from the live repository on **2026-08-26**
with `gh`. The deployed state and evidence were re-read on **2026-08-27**.
Re-read rather than trusted: each claim carries either the command that produced
it or a link to the exact run.

---

## 1. Active now

### 1.1 Required SHA pinning for actions

Changed as part of this work.

```console
$ gh api repos/mbeacom/adrkit/actions/permissions
{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}   # before

$ gh api -X PUT repos/mbeacom/adrkit/actions/permissions \
    -F enabled=true -f allowed_actions=all -F sha_pinning_required=true

$ gh api repos/mbeacom/adrkit/actions/permissions
{"enabled":true,"allowed_actions":"all","sha_pinning_required":true}    # after
```

Every action in this repository was already pinned by full SHA, so this changed
no workflow. What it removes is the ability to introduce a mutable tag later —
including inside a change that has been acknowledged under §1.3.

Note the flag types: `gh api` sends `-f` values as strings, and the endpoint
rejects `"true"` for a boolean field. Booleans need `-F`. The first attempt here
failed with `For 'properties/enabled', "true" is not a boolean`.

**Rollback:** the same `PUT` with `-F sha_pinning_required=false`.

### 1.2 The `gate-change-acknowledged` label

```console
$ gh label create gate-change-acknowledged --repo mbeacom/adrkit --color B60205 \
    --description "A maintainer has seen and accepted this PR's change to the CI gate surface (ADR-0035)"

$ gh label list --repo mbeacom/adrkit --search gate
gate-change-acknowledged  A maintainer has seen and accepted this PR's change to the CI gate surface (ADR-0035)  #B60205
```

Applying a label requires triage or write access, which is what makes it usable
as an authorization token for §1.3. It is **not** an approval and not a claim of
correctness — it asserts only that the change was seen.

**Rollback:** `gh label delete gate-change-acknowledged --repo mbeacom/adrkit`.
Deleting it while `gate-integrity` is required would make every gate-touching
pull request unmergeable, so delete the required context first (§2.1).

### 1.3 `CODEOWNERS` coverage of the gate-defining paths

In the tree, effective on merge. Read the caveats in the file: with a single
owner and no `pull_request` rule on the `main` ruleset, these lines *request* a
review rather than requiring one.

The file names all three locations GitHub searches explicitly:
`/.github/CODEOWNERS`, `/CODEOWNERS`, and `/docs/CODEOWNERS`. The `.github` and
`docs` candidate files do not currently exist. Their entries are still
intentional:
the root `*` already owns every path today, while explicit entries survive a
future narrowing of that default and keep a newly introduced higher-precedence
file from becoming an unowned gate surface.

---

## 2. Deployed state and remaining decisions

### 2.1 `trusted-dco` and `gate-integrity` are required status checks

The trusted workflow landed on `main` in
[PR #179](https://github.com/mbeacom/adrkit/pull/179), merge commit
[`4d70b8add63070f4ca1722e76634aabdb473555c`](https://github.com/mbeacom/adrkit/commit/4d70b8add63070f4ca1722e76634aabdb473555c).
Only after that merge were `trusted-dco` and `gate-integrity` added to the
required contexts. This ordering matters: `pull_request_target` executes the
workflow from the repository's default branch, so adding either context before
the workflow reached `main` would have left every pull request waiting for a
status that could not report.

After `trusted-dco` reported green on real pull requests (§3.2), the old
pull-request-controlled `dco` context was removed from the required set. Its job
remains in `ci.yml` as a faster advisory report; it is not an authority for
merge. The
[live ruleset API response](https://api.github.com/repos/mbeacom/adrkit/rulesets/19149458)
was re-read after that change:

```console
$ gh api repos/mbeacom/adrkit/rulesets/19149458 \
    --jq '.rules[] | select(.type=="required_status_checks")
          | .parameters.required_status_checks[].context'
clean-clone-builds
node-smoke-built-artifacts (22.x)
node-smoke-built-artifacts (24.x)
audit
self-dogfood
Analyze (actions)
Analyze (javascript-typescript)
action-dogfood
trusted-dco
gate-integrity
```

That is **10** contexts. The response reports
`updated_at: 2026-08-26T21:07:04.618-04:00`; it contains both trusted contexts
and no `dco` entry. The two trusted entries intentionally carry no
`integration_id`, matching `action-dogfood`; pinning an integration is a
separate decision from requiring the check.

Read the contexts back rather than trusting a successful settings mutation:

```bash
gh api repos/mbeacom/adrkit/rulesets/19149458 \
  --jq '.rules[] | select(.type=="required_status_checks")
        | .parameters.required_status_checks[].context'
```

**Rollback:** add `dco` back before removing `trusted-dco`, then re-read the
complete list. A payload that names only the context being changed silently
drops every omitted gate.

### 2.2 Fork pull request approval policy — a maintainer decision, not a default

Currently:

```console
$ gh api repos/mbeacom/adrkit/actions/permissions/fork-pr-contributor-approval
{"approval_policy":"first_time_contributors"}
```

Tightening it means no external fork's workflows run without an explicit
maintainer action:

```bash
gh api -X PUT repos/mbeacom/adrkit/actions/permissions/fork-pr-contributor-approval \
  -f approval_policy=all_external_contributors
```

Deliberately **not** applied. It trades real friction for repeat external
contributors against a repository that currently has few, and that trade is a
maintainer's call rather than an agent's. ADR-0035 action item 4 tracks it.

### 2.3 Required review — recorded as declined, with the reason

Not applied, and ADR-0035 explains why at length: GitHub does not permit an
author to approve their own pull request, so with a sole maintainer who is also
the sole code owner, `required_approving_review_count >= 1` deadlocks every
self-authored change, and the escape is the admin bypass that ruleset `19149458`
already grants `always`. The command is recorded so that the decision is
reversible by someone who disagrees, not because it is recommended:

```bash
# NOT recommended — see ADR-0035, "What we are explicitly not doing, and why".
gh api -X PUT repos/mbeacom/adrkit/rulesets/19149458 --input - <<'JSON'
{"rules": [{"type": "pull_request",
            "parameters": {"required_approving_review_count": 0,
                           "dismiss_stale_reviews_on_push": false,
                           "require_code_owner_review": false,
                           "require_last_push_approval": false,
                           "required_review_thread_resolution": true}}]}
JSON
```

That variant — count `0`, thread resolution `true` — is the only non-deadlocking
form. It would force every change through a pull request and require review
threads (including Copilot's) to be resolved before merge. It is a real
improvement to *attention* and no improvement at all to the mechanism #137 is
about, which is why it is filed here rather than in the decision.

---

## 3. Evidence, per ADR-0016

### 3.1 Observed failing — the `gate-integrity` kernel

A guard nobody has watched reject anything is an untested function that happens
to live in a test file. Observed on this change's **own real changed-path list**,
not on a fixture, through the same CLI the workflow invokes:

```console
$ bun run scripts/check-gate-integrity.ts --files pr-files.json --labels pr-labels.json \
    --expected-files 2
check-gate-integrity: examined 2 changed path(s)
  gate    scripts/check-gate-integrity.test.ts  — scripts/: the checks themselves
  gate    scripts/check-gate-integrity.ts  — scripts/: the checks themselves
check-gate-integrity: 2 of 2 changed path(s) alter the surface that defines this
repository's CI gates:
  ...
exit=1
```

and passing once the acknowledgment is present, with the change still *named*
rather than swallowed:

```console
$ bun run scripts/check-gate-integrity.ts --files pr-files.json --labels ack.json
check-gate-integrity: examined 2 changed path(s)
  gate    scripts/check-gate-integrity.test.ts  — scripts/: the checks themselves
  gate    scripts/check-gate-integrity.ts  — scripts/: the checks themselves
check-gate-integrity: ok — 2 gate path(s) changed, acknowledged by the
"gate-change-acknowledged" label
exit=0
```

The three fail-quiet guards were each observed firing, because this check's pass
condition is an absence and an absence is where blindness hides:

| Input | Output | Exit |
|---|---|---|
| `[[]]` — empty list | `the pull request listed no changed files, which cannot happen` | 1 |
| 2 files read, `--expected-files 9` | `reports 9 changed file(s) but 2 were read; the listing is truncated or stale` | 1 |
| `{"message":"Not Found"}` | `expected a JSON array, got object` | 1 |

The permanent negative cases live in `scripts/check-gate-integrity.test.ts`,
including a coverage assertion that fails if an entry is added to
`GATE_SURFACES` without a case observing it block.

One defect was found this way rather than by review: `formatBlock` listed the
offending paths without the reason each was protected, which the test asserting
the block text caught. The code was changed, not the test.

A second, and the more serious of the two, was found by reading what GitHub's
files endpoint actually returns rather than assuming it. A **rename** reports
`filename` as the *new* path only, with the old one in `previous_filename`. So a
pull request that moved `.github/workflows/trusted-gates.yml` to
`.github/wf/trusted-gates.yml` presented this check with a path matching nothing,
passed clean, and would have deleted the trusted gate on merge. A *deletion* is
not affected — `filename` is the deleted path — which is exactly what made the
gap easy to miss. Both paths are now read; observed end-to-end through the CLI:

```console
$ bun run scripts/check-gate-integrity.ts --files rename.json --labels none.json \
    --expected-files 2
check-gate-integrity: examined 3 changed path(s)
  gate    .github/workflows/trusted-gates.yml  — .github/workflows/: defines which
          checks run, what they invoke, and what they are named
check-gate-integrity: 1 of 3 changed path(s) alter the surface ...
exit=1
```

Note the two counts in that output. `--expected-files` is compared against the
*entry* count, which is 2; the path count is 3, because a rename contributes both
ends. Comparing the wrong one would have made every renaming pull request fail as
"truncated" — a false block, which is the merge-stopping direction.

Two further bypasses were found by independent security review against a
fork-author threat model, and both are closed with permanent negative cases:

- **A stale acknowledgment authorized later pushes.** Acknowledge a small
  `scripts/` change, then push a workflow edit; the `synchronize` run saw the
  same label and reported success. Closed by `dismiss-stale-acknowledgment`,
  which removes the label on every push, and by reading labels from the API
  rather than from the pre-dismissal event payload.
- **`.github/CODEOWNERS` was unprotected** while the root file was, and GitHub
  resolves `.github/` first. All three locations are covered now.

And one hardening gap: attacker-chosen paths were printed unescaped into a
privileged job's log. Observed end-to-end after the fix, on a path carrying a
forged annotation:

```console
$ bun run scripts/check-gate-integrity.ts --files forged.json --labels none.json \
    --expected-files 2
exit: 1
lines the runner would parse as commands: NONE
```

`JSON.stringify` was the first attempt and was insufficient — it escapes control
characters but leaves U+200B ZERO WIDTH SPACE untouched, so an invisible
character would still have printed invisibly. The test caught it.

A second adversarial review then found the most serious defect in the change, and
one in the documentation:

- **Retargeting the base was invisible.** Changing a pull request's base fires
  `edited` with `changes.base`, not `synchronize`. The workflow did not listen
  for `edited`, and because the head SHA does not move on a retarget, the check
  runs computed against the *old* base stayed the latest results for that SHA and
  kept the required contexts green over a range nothing had examined — with the
  acknowledgment carrying over to a diff nobody acknowledged.
- **The completeness claim was false.** "Every route to neutering an advisory
  gate runs through `.github/workflows/` or `scripts/`" is contradicted by eleven
  `bun run <name>` invocations across three required contexts, all redirectable
  from the root `package.json`.

Both are closed, and the workflow's own properties are now asserted by
`scripts/trusted-gates-workflow.test.ts` rather than by comments. Each new
assertion was observed failing on the exact regression it defends against, by
mutating the file and re-running:

| Mutation | Assertion that fired |
|---|---|
| `edited` removed from `types` | `includes edited, without which a retarget is invisible` (+1 more) |
| `changes.base` no longer wired to the step | `an edit that left the base alone does not dismiss` |
| label listing un-paginated | `the label listing is paginated before it is trusted` |
| `package.json` added to `GATE_SURFACES` | 5 failures incl. `every documented route really is unprotected` |

The last one is deliberate: the documented gap is pinned, so protecting one of
those routes without moving the documentation fails the suite. And on the CLI,
`--expected-files ""` now reports `the count is missing, not zero` instead of
silently becoming `0` — `Number('')` is `0` and `Number.isInteger(0)` is `true`,
so an unset `changed_files` would otherwise have arrived as a confident claim
that the pull request changed nothing.

A third review round then found two more ways for an acknowledgment to reach a
head it was never granted for, both closed:

| Route | Why it worked | Fix |
|---|---|---|
| Close → push → reopen | GitHub delivers no event for a push to a *closed* pull request, and `reopened` was not in the dismissal condition | dismissal is now an **exclusion** list |
| Push, then edit the title while another run occupies the group | GitHub replaces an existing pending run when another run enters the concurrency group even with `cancel-in-progress: false`; the `edited` run replaced the pending `synchronize` dismissal and then took the title-only early exit | remove workflow-level concurrency entirely |

Both observed failing by mutation, along with a case-folding inconsistency
between the two halves of one control:

| Mutation | Assertion that fired |
|---|---|
| dismissal condition back to an enumeration | 4, incl. `reopened dismisses, closing the close-push-reopen route` |
| the old workflow-level concurrency block restored | `the workflow has no concurrency group that can replace a safety run` |
| `ascii_downcase` removed from the verification | `the verification folds case, like the gate script it backs` |

The first row is worth a note of its own. An earlier version of the `reopened`
assertion checked that the condition *did not mention* `reopened` — which is true
of the correct exclusion list **and** of the enumeration that omitted it, so it
passed against the bug it existed to catch. It now evaluates the condition rather
than pattern-matching it, and the mutation above is what exposed the difference.

The concurrency case is modeled rather than reduced to a setting assertion. The
test starts with an occupied group, queues the `synchronize` dismissal, then
queues a title-only `edited` run. It observes the dismissal move to the cancelled
set while the original run remains active under `cancel-in-progress: false`.
Against the prior workflow, the separate source assertion failed because the
top-level concurrency block was present.

Removing the group means runs can overlap. That does not let an old run certify a
new head: GitHub binds each check run to the event head SHA, and required checks
are evaluated for the current head. The steps that deliberately read mutable
state do so from the live API. A failed read aborts; a stale label that survives
deletion is found by the paginated verification and blocks; and a mismatch
between the event's changed-file count and the live file listing blocks. An older
run can delete a newer acknowledgment and cause a conservative re-acknowledgment,
but it cannot turn an unseen current head green.

### 3.2 Deployed `gate-integrity` evidence on real pull requests

The deployed `pull_request_target` workflow ran from `main` on three ordinary
pull requests that changed gate-defining paths. In each case `gate-integrity`
failed before the acknowledgment existed, `@mbeacom` applied
`gate-change-acknowledged`, and a new run for the same head passed. `trusted-dco`
reported green on the pre-label run in every case:

| Pull request | Red before acknowledgment | Label applied | Green after acknowledgment | `trusted-dco` |
|---|---|---|---|---|
| [#175](https://github.com/mbeacom/adrkit/pull/175) | [run `33028271780`](https://github.com/mbeacom/adrkit/actions/runs/33028271780), [`gate-integrity` job](https://github.com/mbeacom/adrkit/actions/runs/33028271780/job/98374610838) | 2026-08-27 00:52:57Z | [run `33028295112`](https://github.com/mbeacom/adrkit/actions/runs/33028295112), [`gate-integrity` job](https://github.com/mbeacom/adrkit/actions/runs/33028295112/job/98374685670) | [green job](https://github.com/mbeacom/adrkit/actions/runs/33028271780/job/98374611131) |
| [#177](https://github.com/mbeacom/adrkit/pull/177) | [run `33028638073`](https://github.com/mbeacom/adrkit/actions/runs/33028638073), [`gate-integrity` job](https://github.com/mbeacom/adrkit/actions/runs/33028638073/job/98375753726) | 2026-08-27 00:59:54Z | [run `33028662626`](https://github.com/mbeacom/adrkit/actions/runs/33028662626), [`gate-integrity` job](https://github.com/mbeacom/adrkit/actions/runs/33028662626/job/98375832157) | [green job](https://github.com/mbeacom/adrkit/actions/runs/33028638073/job/98375753950) |
| [#178](https://github.com/mbeacom/adrkit/pull/178) | [run `33028809634`](https://github.com/mbeacom/adrkit/actions/runs/33028809634), [`gate-integrity` job](https://github.com/mbeacom/adrkit/actions/runs/33028809634/job/98376291916) | 2026-08-27 01:02:51Z | [run `33028831801`](https://github.com/mbeacom/adrkit/actions/runs/33028831801), [`gate-integrity` job](https://github.com/mbeacom/adrkit/actions/runs/33028831801/job/98376362040) | [green job](https://github.com/mbeacom/adrkit/actions/runs/33028809634/job/98376291846) |

The run creation times bracket each label event: the red runs began at
00:52:32Z, 00:59:26Z, and 01:02:29Z; the green runs began at 00:52:59Z,
00:59:56Z, and 01:02:53Z. This is deployed evidence of both directions, not a
fixture or a local invocation.

`trusted-dco` has now been observed green in the deployed workflow. Its
deliberate red-to-green exercise remains open, so ADR-0035 action item 3 is not
yet complete.

### 3.3 Deployed `trusted-dco` observed failing

The negative half was exercised deliberately on
[PR #180](https://github.com/mbeacom/adrkit/pull/180). Its initial sole
documentation commit,
[`91a1184376b00bf394712377933e1c07a0558f00`](https://github.com/mbeacom/adrkit/commit/91a1184376b00bf394712377933e1c07a0558f00),
retained the required `Co-authored-by` trailer but intentionally omitted
`Signed-off-by`.

The deployed workflow's
[run `33030349682`](https://github.com/mbeacom/adrkit/actions/runs/33030349682)
failed in the
[`trusted-dco` job](https://github.com/mbeacom/adrkit/actions/runs/33030349682/job/98381187821).
The job reported that it examined exactly one commit in
`e9169e7e6d6a8519ebafff06f5217a98a632c21f..91a1184376b00bf394712377933e1c07a0558f00`
and rejected that one commit because `the sign-off is missing`. This is the
deployed negative observation required by ADR-0016, not a local simulation.

The sole commit was then amended to add `Signed-off-by` and this observation,
and force-pushed only with an explicit lease against the recorded remote tip
`91a1184376b00bf394712377933e1c07a0558f00`.

### 3.4 An instance, recorded rather than tidied away

While building this, its author read an absence as a fact — the exact failure
ADR-0016 exists to name — and committed the wrong conclusion before catching it.

Two pushes appeared to produce no workflow runs. Checking further seemed to
confirm it: for the same head SHA, other apps' check suites existed and
`github-actions`' did not, which is what a rejected workflow file looks like. The
cause was then attributed to a hyphenated job id in a `needs.<id>.result`
dereference, and that attribution was written into a commit message as though it
had been established.

All of it was wrong. The runs were **queued, not refused**. The commit reports
three runs once they arrived, roughly five minutes after the check; the other
commit has none only because the next push superseded it. Nothing was ever
blocked, and the expression was never the problem.

What produced the error is worth naming precisely, because it is not
carelessness: every individual observation was accurate. The check suites really
were missing *at the moment they were read*. The defect was treating a read of a
system with latency as a final state — "I could not see any runs" rendered as "no
runs were created", which is ADR-0016's sentence almost verbatim, committed by an
author who had spent the session reading that record.

The refactor it motivated was kept, because it is simpler on its own merits. The
commit message was amended to say plainly that it fixed nothing. That amendment
is the point: a false diagnosis left in a commit message is permanent here, since
the repository's squash-merge body carries commit messages into `main`.

---

## 4. What none of this closes

Whoever can merge can change a gate and acknowledge the change. Merge access is
the boundary it always was, and no wording in this repository should suggest
these controls are tamper-proof.

What is closed is narrower, and is the thing #137 was actually about: the check
that certifies a pull request is no longer authored by that pull request.
