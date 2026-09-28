---
schemaVersion: 0.1.0
id: "0042"
title: "Count a gate-change acknowledgment only when an admin or maintainer applied it"
status: accepted
date: 2026-09-27
deciders: ["@mbeacom"]
tags: [ci, governance, security]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0035", "0016", "0006"]
affects:
  - type: path
    pattern: ".github/workflows/trusted-gates.yml"
  - type: path
    pattern: "scripts/check-gate-integrity.ts"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    Narrows who can authorize a change to the surface ADR-0035 already treats as
    a two-way door with an org-wide blast radius; the rule it amends gates every
    pull request that touches a workflow, script, or CODEOWNERS file.
  queuedAt: 2026-09-27T00:00:00Z
  slaDays: 30
reviewBy: 2027-09-27
---

# ADR-0042: Count a gate-change acknowledgment only when an admin or maintainer applied it

> **Status: accepted.** Agent-drafted for @davesheffer; ratified by @mbeacom on
> 2026-09-27, after #233 merged, with the rename-around-dismissal route (action
> item 5) deliberately deferred.

## Context

[ADR-0035](0035-execute-the-gates-that-certify-a-pull-request-from-the-default-branch.md)
relied on GitHub's native label permission as the authorization for
`gate-change-acknowledged`: applying a label "requires triage or write access,"
so an external contributor cannot self-authorize, and the act is recorded in the
timeline against whoever performed it. That sufficiency claim does not hold once
triage access is on the table. Triage exists so a contributor can help manage
issues and pull requests — labeling among them — so granting it for that purpose
also grants the power to acknowledge one's own gate change, or another
triage-holder's. The label would still be present, still attributed, and still
insufficient.

The gap surfaced in review of PR #219: @mbeacom proposed reading the actor off
the *latest* `labeled` event via the collaborator-permission API and requiring
`admin` or `maintain` there, closing self-ack and cross-ack between contributors
alike. @davesheffer's comment on the same PR had proposed a weaker rule first —
"the PR author's own acknowledgment does not count" — which stops an author from
labeling their own change but does nothing about a second triage-holder labeling
it for them. [#232](https://github.com/mbeacom/adrkit/issues/232) tracks closing
that gap before triage is granted to any contributor; today the repository has
no triage-holders and no org custom roles, so this is a precondition rather than
a response to an incident.

## Decision

**We will count a `gate-change-acknowledged` label only when the actor who most
recently applied it holds the `admin` or `maintain` role at the time the check
runs**, superseding "triage or write access" as the sufficient condition
wherever ADR-0035 stated it. Concretely, all of the following must hold:

1. The label is currently on the pull request (the live labels API, as today).
2. The pull request's issue-event history (`GET
   repos/{repo}/issues/{n}/events`, paginated) contains at least one
   `labeled`/`unlabeled` event for that label, and the *latest* such event,
   ordered by timestamp with a numeric-id tie-break, is `labeled`. A latest
   event of `unlabeled` while the label is present is stale or inconsistent
   history and does not count. A `labeled` or `unlabeled` event that names no
   label is ordered with the acknowledgment's own events: it could be this
   label's removal, so if it is the latest, the acknowledgment does not count.
   It does not fail the job, so a clean pull request stays green.
3. That latest `labeled` event names a non-null actor with a syntactically
   valid GitHub login.
4. The run's own event must not contradict the history. If the run was
   triggered by a `labeled` event for this label, the trigger's sender must
   match the history-derived actor (case-insensitively). If it was triggered by
   an `unlabeled` event for this label and the label is present anyway, it was
   applied again after that removal. If this run's dismissal step removed the
   label and it is present anyway, it was applied again while the run was in
   progress. In each case the acknowledgment is unverified in this run: the
   history it read may not show the latest application yet, and the `labeled`
   run that application started is the one that judges it.
5. `GET repos/{repo}/collaborators/{actor}/permission` succeeds, names that same
   actor, reports `role_name` of exactly `admin` or `maintain` (no case folding;
   a custom role name or an empty string is rejected), and the corresponding
   flag is `true`: `permissions.admin` for `admin`, `permissions.maintain` for
   `maintain`.

Anything else does not count, and the check fails closed: a lookup failure, an
unattributable actor, or a role short of `admin`/`maintain` all block a gate
change the same way an absent label does. A history that cannot be ordered at
all — an event for this label with no readable `id` or `created_at` — fails the
job outright, clean pull requests included. Bots are rejected by construction —
the live probe below shows `role_name: ""` for `github-actions[bot]`.

Verified live-API shapes (probed against `davesheffer/adrkit`, 2026-09-27):

```json
{"permission":"admin","role_name":"admin","user":{"login":"davesheffer","permissions":{"admin":true,"maintain":true,"pull":true,"push":true,"triage":true}}}
{"permission":"none","role_name":"","user":{"login":"github-actions[bot]","permissions":{"admin":false,"maintain":false,"pull":false,"push":false,"triage":false}}}
```

```json
{"id":31801701021,"event":"labeled","created_at":"2026-09-25T01:03:39Z","actor":{"login":"mbeacom"},"label":{"name":"gate-change-acknowledged"},"performed_via_github_app":null}
```

Other event types on the same endpoint — `referenced`, `cross-referenced`,
`subscribed`, and the rest — carry no `label` field and are ignored. A token
without push access gets `HTTP 403 "Must have push access to view collaborator
permission"` from the permission endpoint. The workflow's own `GITHUB_TOKEN`
(`contents: read`, `pull-requests: write`) can read it, and the events
endpoint too — observed on a real `pull_request_target` run; see Trade-offs.

## What we are explicitly not doing

- **Not checking the PR author's identity separately.** An admin or maintainer
  acknowledging their own pull request still counts. Whoever can merge can
  already change gates without a label at all, per ADR-0035's own trade-offs;
  restricting self-acknowledgment specifically would add a rule that a
  merge-access holder can route around by asking any other admin or maintainer
  to label it, at the cost of a deadlock if there is only one.
- **Not using `github.event.sender` as the source of the actor.** It is only
  present, and only correct, on the event that triggered this run. Every other
  triggering event — `synchronize`, `opened`, `edited` — has a sender who is not
  the labeler, which is why rule 4 cross-checks the sender against history
  rather than substituting for it.
- **Not trusting API pagination order.** The events endpoint returns in the
  order the API happens to produce; the rule sorts a copy by parsed timestamp
  with a numeric-id tie-break before taking "latest."
- **Not accepting custom roles.** `role_name` must equal `admin` or `maintain`
  exactly. The repository is in a personal namespace with no organization and
  no custom roles today; if it moves to one, this needs an explicit amendment
  (see Trade-offs).
- **Not changing what dismisses.** `dismiss-stale-acknowledgment` removes the
  label on exactly the events it did before. It now also reports that it did,
  so rule 4 can tell a label that survived dismissal from one applied after it;
  this record only narrows who a surviving label counts as coming from.
- **Not making merge access tamper-proof.** Nothing here changes the honest
  limit ADR-0035 already recorded: whoever can merge can still label.

## Options considered

### Option A: Presence only (status quo)

**Pros:** already shipped; simplest.
**Cons:** exactly the gap this record closes — sufficient today only because
the repository has no triage-holders yet; stops being sufficient the moment one
is granted.

### Option B: Exclude the PR author only

The weaker rule from @davesheffer's comment on #219: the acknowledging actor
must not be the pull request's own author.

**Pros:** simple; closes self-ack.
**Cons:** does not close cross-ack — any two triage-holders can label each
other's changes, which defeats the purpose of restricting the authorization to
a small, trusted set.

### Option C: Latest labeler must hold `admin` or `maintain`, verified live (chosen)

**Pros:** closes self-ack and cross-ack alike, for any set of triage-holders,
present or future; ties the authorization to a role independent of who opened
the pull request; verified against the live API rather than assumed.
**Cons:** an extra API call and a fail-closed dependency on the
collaborator-permission endpoint's availability to the workflow's token
(observed on a fork dry run, see Trade-offs); more moving parts than Option B.

### Option D: Require an approving review from a CODEOWNER instead of a label

**Pros:** uses a native GitHub review, not a bespoke label protocol.
**Cons:** [`docs/repository-trust-operations.md`](../repository-trust-operations.md)
§2.2 and ADR-0035's own "What we are explicitly not doing" section already
establish why a required-review rule deadlocks here: GitHub does not let an
author approve their own pull request, and with a sole maintainer who is also
the sole code owner, every self-authored change either deadlocks or is waved
through by the admin bypass. The same failure applies to this narrower use.

### Option E: Trust `github.event.sender` as the actor

**Pros:** no extra API call; no history read.
**Cons:** wrong on every event type except the exact `labeled` event for this
label — `synchronize`, `opened`, `edited`, and even a `labeled` event for an
unrelated label all carry a sender who did not apply this acknowledgment. This
is precisely the substitution rule 4 exists to avoid.

## Trade-offs

- **Eventual consistency.** The issue-events API may lag the label state it
  describes; by how much is not measured. Two observations from 2026-09-27,
  neither a measurement: a `labeled` run's history read, within about nine
  seconds of the label being applied, already showed the application; and an
  events read issued immediately after a label was deleted omitted the
  resulting `unlabeled` event, which the timeline endpoint returned a moment
  later and the events endpoint by the next poll, roughly ten to fifteen
  seconds after the deletion. The second may be the deletion's asynchronous
  removal rather than lag. The rules narrow what a lag can do. A lag of one event cannot make a relabel count:
  if the history shows the removal but not the re-application, rule 2 sees a
  latest `unlabeled` and refuses. Rule 4 covers a run whose own event is the
  removal or the re-application, and a run that dismissed the label itself.
  What remains is any other run that reads a history lagging at least two
  events behind a removal and re-application made after that run's own event:
  a run started by a title or body edit, by another label being added or
  removed, or by the maintainer's own application of this label, whose sender
  matches the stale history so the cross-check passes. The sequence: a
  maintainer applies the label; before that run, or a run started by a later
  title edit, reads the history, someone with triage removes and re-applies
  it; the history the run reads shows neither, and credits the maintainer. The
  re-application's own `labeled` run judges it correctly, but the runs report
  on the same head commit, and which result stands is GitHub's choice among
  them. How large a lag this needs depends on how closely the relabel can be
  timed against the run's read, which the public run log exposes. The residual
  is accepted and named here rather than claimed away.
- **Label renames and deletions.** Attribution keys on the label name recorded
  in each event. Probed on `davesheffer/adrkit`, 2026-09-27: an event keeps the
  name the label had when the event happened. A label applied as
  `adrkit-probe` and then renamed to `adrkit-probe-renamed` still reported
  `adrkit-probe` on its `labeled` event, while the pull request's label list
  reported the new name; the rename itself emitted no event. Deleting the
  label removed it from the pull request and emitted an `unlabeled` event
  carrying the name at deletion and a full `label` object, not `null`, so the
  `label: null` handling stays defensive rather than observed. Renaming a
  label a maintainer applied for another reason to `gate-change-acknowledged`
  therefore inherits nothing: that application is recorded under the old
  name, the history holds no application of this label, and the
  acknowledgment is unattributed.
  Renaming the acknowledgment itself is not inert, and that route stays open.
  Dismissal removes the label by name. Someone who renames it away before a
  push therefore keeps it on the pull request through that push's
  dismissal, which finds nothing to delete. Renaming it back afterwards
  emits no event, so the history's latest event for the name is still the
  maintainer's application. A later run that does not dismiss — one started
  by a title edit or by another label — then credits that application to a
  head the maintainer never saw. This needs write access, since editing
  labels is a write permission that triage does not grant, and write is not
  a role this record lets acknowledge. It also needs an admin's or
  maintainer's earlier acknowledgment on the same pull request and the
  ability to push its head. The route is recorded here as a residual rather
  than closed; see Action items.
- **Token access.** Observed on a real `pull_request_target` run of this
  workflow as of `a68200b` on the contributor's fork `davesheffer/adrkit`, from a
  same-repository pull request
  ([run 36322666130](https://github.com/davesheffer/adrkit/actions/runs/36322666130)):
  with `contents: read` and `pull-requests: write`, the job's `GITHUB_TOKEN`
  read both `issues/{n}/events` and `collaborators/{actor}/permission`, and
  the verdict was `applied by @davesheffer (admin)`. The same pull request's
  run before labeling
  ([run 36322605737](https://github.com/davesheffer/adrkit/actions/runs/36322605737))
  blocked the gate change, and a clean-path pull request
  ([run 36322610068](https://github.com/davesheffer/adrkit/actions/runs/36322610068))
  stayed green. Not observed: a pull request from a fork into this
  repository. `pull_request_target` issues the base repository's token with
  the declared permissions either way, but that is GitHub's documented
  behavior, not something these runs show. A 403 there would fail closed:
  even the owner's acknowledgment would stop counting.
- **Custom roles.** If the repository ever moves into an organization, custom
  roles could grant label-application power without ever reporting `role_name`
  as `admin` or `maintain`. This record does not anticipate that; it needs an
  explicit amendment if the namespace changes, per ADR-0006.
- **Overlapping runs.** ADR-0035 already accepted that an older run can remove
  a newly applied acknowledgment and force it to be reapplied, as a
  false-negative in the fail-closed direction. That residual is unchanged here.

## Consequences

- **Easier:** distinguishing an acknowledgment a triage-holder gave themselves
  from one an admin or maintainer gave; auditing exactly who authorized a gate
  change and under what role, from the timeline alone — though not which head
  it covered, since a rename leaves no event (see Label renames and
  deletions).
- **Harder:** landing a gate-touching pull request when the only accounts able
  to label it are admins or maintainers. Today that is @mbeacom alone, so no
  practical acknowledger changes until triage is granted to someone else —
  this record has no observable effect until then, which is the point: it is a
  precondition, not a response to an incident.
- **How we would know this was wrong:** if a legitimate gate change repeatedly
  stalls because no admin or maintainer is available to label it, forcing a
  workaround that erodes the acknowledgment's meaning the way a reflexive label
  already would under ADR-0035.
- **Revisit if:** triage or write access is granted to a contributor and the
  friction above becomes real; or the repository moves to an organization and
  custom roles need an explicit carve-out.

## Action items

1. [x] **Ratify or reject.** Ratified by @mbeacom, 2026-09-27.
2. [x] **Prove the workflow token can read `collaborators/{actor}/permission`**
       on a real `pull_request_target` run before merge. Done on the fork,
       2026-09-27 — see Token access above.
3. [x] **Probe what `issues/{n}/events` reports for a renamed and a deleted
       label** before ratification. Done 2026-09-27: events keep the name at
       event time. Renaming another label to this one inherits nothing, but
       renaming this label away and back around a push survives dismissal —
       see Label renames and deletions above.
4. [ ] **Observe both the accept and the insufficient-role paths on a real pull
       request after merge**, per ADR-0016. Not yet: no acknowledgment has been
       evaluated under this rule here. #237's passing `gate-integrity` run
       (36365739410, 01:22 UTC) predates the 01:33 merge of #233 and ran the old
       presence-only rule. The accept path has been observed only on the fork.
5. [ ] **Decide whether to close the rename-around-dismissal route** before
       write access is granted to anyone else. Deferred by @mbeacom at
       ratification (2026-09-27): nobody else holds write access today, so the
       route is not reachable; this item is the trigger to revisit. One candidate: dismissal also
       removes every label whose latest history event under its current name
       is not an application — the test rule 2 applies to this label, which
       catches one renamed since it was applied — at the cost of
       dropping legitimately renamed labels on each push, and of removing a
       label whose application the events API has not yet reported.
