# Repository trust operations

Companion to
[ADR-0035](adr/0035-execute-the-gates-that-certify-a-pull-request-from-the-default-branch.md)
and issue [#137](https://github.com/mbeacom/adrkit/issues/137).

This file exists so that the difference between **a control that is active** and
**a control that is planned** is written down rather than inferred. ADR-0016's
subject is checks that report success without having looked; a settings change
that is described but never applied has the same shape, and reads identically to
one that was.

Everything below was read from the live repository on **2026-08-26** with `gh`.
Re-read rather than trusted: each claim carries the command that produced it.

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

---

## 2. Must wait until merge

### 2.1 Add `trusted-dco` and `gate-integrity` as required status checks

**This cannot be done before merge, and doing it early would be actively
harmful.** `pull_request_target` executes the workflow from the repository's
default branch, so neither job exists until this change lands on `main`. A
required context that never reports leaves every pull request — including the one
introducing it — permanently "Expected — waiting for status".

The payload below was constructed and validated against the live ruleset on
2026-08-26 and deliberately **not** sent. Re-run the first command after merge and
confirm the two new contexts appear before sending anything.

```bash
# 1. Build the payload from the ruleset as it stands, appending the two contexts.
gh api repos/mbeacom/adrkit/rulesets/19149458 --jq '
  {rules: (.rules | map(
    if .type == "required_status_checks"
    then .parameters.required_status_checks += [
      {context: "trusted-dco"},
      {context: "gate-integrity"}
    ]
    else . end))}' > /tmp/ruleset-payload.json

# 2. Read it before sending it. The existing nine contexts must still be present.
python3 -m json.tool < /tmp/ruleset-payload.json

# 3. Apply.
gh api -X PUT repos/mbeacom/adrkit/rulesets/19149458 --input /tmp/ruleset-payload.json

# 4. Verify it took, by reading back rather than by trusting the response.
gh api repos/mbeacom/adrkit/rulesets/19149458 \
  --jq '.rules[] | select(.type=="required_status_checks")
        | .parameters.required_status_checks[].context'
```

Step 4 must list eleven contexts, ending with `trusted-dco` and `gate-integrity`.
Note that step 1 appends rather than replaces: a payload that omits the existing
nine would silently drop every current gate, and the response to a successful
`PUT` looks the same either way.

Do not add `integration_id` to the two new entries. The existing `dco` and
`action-dogfood` contexts carry none, and pinning the integration is a separate
decision from adding the check.

**Sequencing.** Add the contexts *before* removing anything. `dco` in `ci.yml` is
advisory under ADR-0035 but is still a required context; leave it required until
`trusted-dco` has been observed green on a real pull request (§3.2).

**Pull requests open at the moment you do this will be stuck, and it is not
obvious why.** A required context is satisfied by a check run against the head
SHA, and `pull_request_target` only produces one when an event fires. Every pull
request already open when the contexts are added has a head that no
`trusted-gates.yml` run has ever seen, so both new contexts sit at "Expected —
waiting for status" indefinitely. Nothing retroactively creates them, and
re-running an old workflow run does not either, because the workflow did not
exist for that run.

Each open pull request needs a **new event** — push a commit, or close and
reopen it, or edit its base. Check what is open before you start, and expect to
touch each one:

```bash
gh api "repos/mbeacom/adrkit/pulls?state=open" --jq '.[] | "#\(.number)  \(.head.ref)"'

# For each, confirm the two contexts actually reported against its current head:
gh api "repos/mbeacom/adrkit/commits/<head-sha>/check-runs" \
  --jq '[.check_runs[].name] | map(select(. == "trusted-dco" or . == "gate-integrity"))'
```

That listing must show both names. An empty result is the stuck state, not a
pass.

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

### 3.2 Not yet observed — say so plainly

**The deployed workflow has never run.** It cannot, before merge: GitHub takes
`pull_request_target` workflows from the default branch, so `trusted-gates.yml`
is inert until it is on `main`. Nothing in this repository should be read as
claiming otherwise.

After merge, the first pull request that touches a gate path exercises both
halves. To observe it deliberately rather than waiting:

```bash
# On a scratch branch, touch a gate path and open a pull request.
printf '\n' >> scripts/check-gate-integrity.ts
git commit -sam 'chore: observe gate-integrity blocking' && git push -u origin HEAD
gh pr create --fill

# Expect gate-integrity RED. Then acknowledge, and expect it to turn GREEN.
gh pr edit <number> --add-label gate-change-acknowledged

# Read the conclusions back rather than reading the checks tab.
gh api "repos/mbeacom/adrkit/commits/$(git rev-parse HEAD)/check-runs" \
  --jq '.check_runs[] | select(.name|test("^(trusted-dco|gate-integrity)$"))
        | {name, status, conclusion}'
```

`trusted-dco` should be green throughout — the commit above is signed off. To
observe *it* failing, add a commit with `--no-signoff` on the same branch and
confirm `trusted-dco` goes red while the advisory `dco` job's verdict is
irrelevant to the merge.

Until both have been seen red and then green on a real pull request, ADR-0035
action item 3 stays open and the workflow counts as implemented, not as verified.

### 3.3 An instance, recorded rather than tidied away

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
