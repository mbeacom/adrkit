---
schemaVersion: 0.2.0
id: "0058"
title: "Project the decision corpus into a GitHub Project as a one-way derived view"
status: proposed
date: 2026-10-10
deciders:
  - "@mbeacom"
tags:
  - ci
  - distribution
  - governance
  - projection
  - github-projects
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo:
  - "0004"
  - "0014"
  - "0016"
  - "0025"
  - "0026"
  - "0035"
  - "0036"
  - "0037"
  - "0042"
  - "0044"
  - "0050"
  - "0051"
  - "0052"
  - "0054"
affects:
  - type: path
    pattern: "packages/ci/project/**"
  - type: path
    pattern: "packages/ci/src/project-*.ts"
    note: "The pure projection plan, the Projects client port, and the Action entrypoint."
provenance:
  authoredBy: agent-drafted
---

# ADR-0058: Project the decision corpus into a GitHub Project as a one-way derived view

> **Status: proposed.** Agent-drafted and not ratified. This record amends no
> record and supersedes none. It adds a projection that
> [ADR-0004](./0004-git-is-source-of-truth-database-is-an-index.md) already
> allows: git holds the decisions, and anything else is derived from them with
> no way to write back. It applies
> [ADR-0037](./0037-treat-generated-knowledge-systems-as-downstream-read-models-not-decision-authorities.md)'s
> rules for a downstream read model to a GitHub Project. The managed-issue
> queue Action has no governing record of its own. It shipped under
> `specs/007-arb-queue/`, whose plan cites ADR-0004 for the queue projection.
> This record leaves that Action unchanged.

## Context

Teams that run architecture review in GitHub Projects want their ADRs on the
same board. Today adrkit can put the review queue in exactly one GitHub place:
the queue Action.

- **The queue Action writes one issue and sets no labels.**
  `packages/ci/queue/action.yml` takes `dir`, `token` (default
  `${{ github.token }}`), and `issue-title`, and needs only `issues: write`.
  `packages/ci/src/queue-issue.ts` finds its issue by a hidden marker that
  must be the body's exact first line (`<!-- adrkit-managed-queue-issue -->`).
  It creates the issue, updates it, or reopens and updates it. It fails
  without writing when two issues carry the marker, or when an unmarked issue
  already has the title. `publishQueueReport` writes first and then fails the
  run if the report has error-severity corpus findings. ADR-0026's CI comment
  uses a stricter variant: first-line matching plus a bot-author check in its
  `app-installation` mode, and the marker anywhere in `login` mode.
- **The queue kernel works without a network.** `lintCorpus` returns
  `{ checked, findings, records }`, with every valid record and its `status`.
  `buildQueueReport` turns that into QueueReport v1, whose items carry `tier`,
  `slaState`, `deadlineDate`, `approvalCount`, `quorum`,
  `unresolvedObjectionCount`, `resolvedObjectionCount`, and `routingTargets`
  for `proposed` records (`packages/core/src/queue/types.ts`). `@adrkit/ci`
  already depends on `@adrkit/core` for both.
- **What the Projects API offers** (from GitHub's documentation, researched
  for this record and not measured here). The GraphQL API has
  `addProjectV2ItemById` (idempotent), `addProjectV2DraftIssue`,
  `deleteProjectV2Item`, and `updateProjectV2ItemFieldValue`, which sets text,
  number, date, single-select (by option id), and iteration values. No single
  call adds an item and sets its fields. Field updates can be aliased in one
  request. The API cannot set labels, assignees, or milestones on an item.
  REST endpoints for project items, fields, and drafts now exist (API version
  2026-03-10) for organization and user projects. Limits: 5,000 points an
  hour (up to 12,500 for apps), each mutation request costs 5 secondary points
  of 2,000 a minute, and content creation is capped at 80 a minute and 500 an
  hour. The docs ask for at least one second between mutations and no
  concurrency.
- **`GITHUB_TOKEN` cannot reach a project.** GitHub documents it as "scoped to
  the repository level and cannot access projects". An organization-owned
  project takes a GitHub App with the Organization Projects read and write
  permission (recommended, with `actions/create-github-app-token`) or a
  fine-grained PAT with that organization permission. A user-owned project
  takes a classic PAT with the `project` scope: fine-grained PATs list user
  projects as a known gap, and we found no user Projects permission for Apps.
  We are fairly but not fully certain of that last point. Runs from forked
  pull requests get no secrets.
- **Built-in project automation cannot see paths.** Auto-add filters accept
  only `is:`, `label:`, `reason:`, `assignee:`, and `no:`, act only on items
  created or updated after the workflow is enabled, and are limited per
  project (Free 1, Pro and Team 5, Enterprise 20). The other built-ins move an
  added item to Todo and a closed or merged one to Done, and archive
  automatically. A zero-code setup therefore needs a label, such as one
  `actions/labeler` applies to `docs/adr/**` changes, and it tracks pull
  requests, not decisions.
- **Review lives in git.** Ratifying (ADR-0044) and recording review state
  (ADR-0051) are human CLI edits that land through a pull request. The board's
  write path (ADR-0052) asks the host to confirm every write. No agent surface
  runs any of these commands. The board (ADR-0050) and the portal (ADR-0054)
  show approvals, quorum, objections, SLA state, deadline, and routing as raw
  facts, with no readiness verdict and no ratifying command.
- **`packages/ci/**` is a gate path.** ADR-0035 requires the
  `gate-change-acknowledged` label on any pull request that changes it,
  counted only when an admin or maintainer applied it (ADR-0042).

## Decision

We will ship a separate, one-way projection Action that keeps a GitHub Project
in step with the corpus, and document a zero-code recipe beside it.

1. **A new nested Action, `packages/ci/project/action.yml`.** It runs
   `../dist/project-action.js` on `node24`, as the queue Action does, and stays
   nested for the same reason (ADR-0036: GitHub lists only root metadata). The
   queue Action is unchanged.

2. **Inputs.** `project-url` (required); `token` (required, with **no**
   `github.token` default, unlike the queue Action, because that token cannot
   reach a project); `dir` (default `docs/adr`); `portal-url` (optional, see
   clause 8); and `create-fields` (default `false`, see clause 6).

3. **One read of the corpus, through core.** The entrypoint calls `lintCorpus`
   once. Every valid record's status comes from its `records`, and the review
   facts for `proposed` records come from `buildQueueReport` over the same
   result. It reuses the queue kernel and the queue Action's pattern of a pure
   module with an injected client port. The client is new: the queue's
   `GitHubQueueClient` handles issues only. A corpus that cannot be loaded
   fails the run before any GitHub client is built, as in the queue
   entrypoint.

4. **One draft item per record, keyed by an adrkit-owned text field.** Each
   record becomes a draft item whose `ADR ID` text field holds its id. The
   Action creates no repository issue and needs no issues permission. An item
   with an empty `ADR ID` was added by hand and is ignored. The item title is
   `ADR-<id>: <title>`; the title is repository text shown as data.

5. **Owned fields are overwritten on every run, and nothing else is touched.**
   The owned fields, their Project types, and their sources are exact, so
   `create-fields` can create them and validation can check an existing
   project deterministically:

   | Field | Type | Options or format | Source |
   |---|---|---|---|
   | `ADR ID` | text | the record id | record `id` |
   | `ADR status` | single select | `draft`, `proposed`, `accepted`, `rejected`, `superseded`, `deprecated` | record `status` |
   | `Tier` | single select | `auto`, `async`, `arb` | QueueReport v1 `tier`; empty when null |
   | `SLA state` | single select | `decided`, `escalated`, `overdue`, `due`, `within-sla`, `missing-sla`, `not-queued` | QueueReport v1 `slaState` |
   | `Deadline` | date | `YYYY-MM-DD` | QueueReport v1 `deadlineDate`; empty when null |
   | `Approvals` | number | distinct identities | QueueReport v1 `approvalCount` |
   | `Quorum` | number | | QueueReport v1 `quorum`; empty when null |
   | `Open objections` | number | unresolved only | QueueReport v1 `unresolvedObjectionCount` |
   | `Resolved objections` | number | | QueueReport v1 `resolvedObjectionCount` |
   | `Routing` | text | comma-separated, in source order | QueueReport v1 `routingTargets` |

   A single-select option missing from an existing field is a validation
   failure, never a silent skip. Each run writes every owned value from the
   corpus. A record that is not `proposed` has its queue fields emptied. The
   item **title and body are owned too**: both are rewritten on every run,
   not only when the item is created, so a renamed record, a changed
   `portal-url`, or a new synced commit never leaves a stale card. The Action
   **never writes the built-in `Status` field**, which belongs to the board's
   own workflows: mapping adrkit status onto it would conflate two
   states, in the spirit of what ADR-0037 clause 3 forbids for documentation
   formats. It never touches a field it does not own. It reads the
   Project only to resolve field and option ids and to find items by
   `ADR ID`. Field updates are aliased per request, and mutations run one at
   a time at least one second apart. Draft creations stay under 80 a minute
   and 500 an hour; a corpus that needs more stops at the budget, reports how
   many records remain, and continues on the next run.

6. **Missing fields fail clearly.** A missing owned field, or a missing option
   on a single-select field, fails the run with a fixed message naming it.
   With `create-fields: true`, the Action creates what is missing and then
   continues. That is meant for the first run only, and the docs say so.

7. **A record that leaves the corpus is archived, not deleted.** Its item is
   archived, so the card's history stays. A record that comes back is
   restored or recreated under the same `ADR ID`.

8. **Item bodies link to the record and carry no command.** A body is built
   from fixed strings, the id, and one link. With `portal-url`, the link is
   the record's portal route (`<portal-url>#/adr/<id>`, ADR-0054 clause 8).
   Without it, the link is the record's source path in the repository at the
   synced commit. The body never repeats the record's prose, never contains a
   review or ratifying command, and never says a record is ready, eligible,
   or ratifiable. That is stricter than the terminal queue (ADR-0044), as the
   board and the portal already are. Typed relationships are not shown on the
   card; the link is where ADR-0037 clause 4 asks a lossy projection to send
   the reader.

9. **Failure modes are fixed and named.**
   - Two items with one `ADR ID`: fail without writing, naming both, as the
     queue Action fails on two markers.
   - A person edits an owned field: the next run overwrites it. The docs say
     so plainly.
   - The token cannot see the project: a fixed error naming the two token
     paths of clause 13, and a non-zero exit. API error text and stack traces
     are not echoed.
   - Error-severity corpus findings: the run syncs every valid record first,
     then fails, matching `publishQueueReport`.

10. **The board records nothing.** Moving a card or editing `Approvals` changes
    no decision. Review stays in git through the human CLI and a pull request
    (ADR-0044, ADR-0051, ADR-0052), and the next sync reverts the edit. The
    Action never writes `docs/adr/**` (ADR-0037 clause 6), and no agent
    surface runs a review command because of anything on the board.

11. **Triggers and tokens.** The documented workflow runs on push to the
    default branch (filtered to the corpus directory), on a schedule, and on
    `workflow_dispatch`, never on `pull_request`, because forked pull requests
    get no secrets. The schedule matters: `slaState` depends on the date, so a
    card goes stale between pushes without it (the reason ADR-0025 refused to
    badge SLA state). The workflow takes a concurrency group so two runs never
    create the same item. Token paths are clause 13.

12. **A zero-code recipe ships as documentation regardless.** `actions/labeler`
    labels pull requests that touch `docs/adr/**`, and the project's auto-add
    workflow picks them up by that label. The recipe says plainly that it
    tracks pull requests, not records, and carries no SLA, quorum, or deadline.
    It is a recipe in ADR-0025's sense, not code.

13. **Both owners are supported, and a user-owned project is the default.**
    The maintainer settled this: user-owned projects are the primary case
    today, and organization-owned projects are supported too.
    - **User-owned (the documented default).** A classic PAT with the
      `project` scope, stored as a secret. The docs say plainly that this
      scope is owner-wide: it reaches every project the token's owner can,
      not only this one. They also say why nothing narrower is offered.
      Fine-grained PATs list user projects as a known gap, and we found no
      user Projects permission for GitHub Apps. We are fairly but not fully
      certain of that last point, and the docs keep that caveat. If GitHub
      offers a narrower token for user projects, the docs switch to it.
    - **Organization-owned.** A GitHub App with Organization Projects read
      and write, minted per run with `actions/create-github-app-token`
      (recommended), or a fine-grained PAT with that organization permission.

## Options considered

- **Option A: a documented recipe only (labeler plus auto-add).** No code and
  no secret. It tracks pull requests rather than records, cannot show SLA
  state, quorum, or deadlines, and auto-add has no path filter. It ships
  anyway as clause 12, but it does not answer "what is under review and how
  close is it to its deadline".
- **Option B: a separate one-way projection Action (chosen).** It shows every
  record and the review facts the queue already computes, and keeps the
  owner-wide secret and the Projects API's failure modes out of every other
  Action. It costs another nested bundle (the fourth, after the portal's) and a Projects client to maintain.
- **Option C: a `project` input on the queue Action.** Rejected. The queue
  Action needs only `issues: write` and `github.token`. Adding an owner-wide
  secret and a second API to it would let a Projects outage turn the queue run
  red, and a queue adopter would carry a credential path they never use.
- **Option D: a two-way sync that reads card moves back into frontmatter.**
  Rejected by ADR-0004 (no write path back) and ADR-0037 clause 1: a card move
  would become an unreviewed decision change.

## Trade-offs

- **Owned fields lose human edits.** A person who types into `Approvals` sees
  the value reverted on the next run. That is the price of a projection that
  can always be rebuilt. An advisory drift warning would need the Action to
  read owned values back, which clause 5 does not allow in this version; it is
  left for later and would have no exit-code authority.
- **The default token is broad.** The default path is a user-owned project,
  and its classic PAT with `project` scope reaches every project its owner
  can. Clause 13 states that instead of hiding it.
- **The card is as fresh as the last run.** Between scheduled runs, SLA state
  and deadlines can be a day behind.
- **Another nested bundle** (the fourth, after ADR-0054's portal Action) joins the lockstep release and the moving `v0`
  tag. `packages/ci/package.json` gains a `bun build` line and `project` in
  `files` (today `action.yml`, `queue`, `dist`). `action-tag-recovery.yml`
  checks exactly `dist/index.js` and `dist/queue-action.js`, ADR-0054 item 6
  already adds the portal bundle, and this adds `dist/project-action.js`.
  `docs/RELEASING.md` gains a row. As with every nested Action, the docs give
  `mbeacom/adrkit/packages/ci/project@<tag>` and never `mbeacom/adrkit@v0`.
- **Large corpora sync over several runs** on the first pass, because of the
  content-creation limit.

## Consequences

- Easier: a review team sees every decision, its status, and the queue's
  review facts on the board it already uses, kept current by a schedule.
- Easier: the projection can be deleted and rebuilt at any time; the project
  holds nothing the corpus does not.
- Harder: every pull request that builds this changes `packages/ci/**` and
  needs `gate-change-acknowledged` from an admin or maintainer (ADR-0035,
  ADR-0042).
- Harder: a second GitHub API client in `@adrkit/ci`, with tests for pacing,
  aliasing, duplicate keys, missing fields, and fixed error text, each
  observed failing first (ADR-0016).
- **Risks.** A leaked project token can rewrite or archive any card the token
  reaches, not only adrkit's. Record titles are untrusted text on the card;
  GitHub renders them, and the body holds no command for a reader to copy.
- **How we would know this was wrong:** the Action writes the built-in
  `Status` field, a field it does not own, or anything under `docs/adr/**`; a
  card edit changes a record; an item body contains a review or ratifying
  command or a readiness word; the queue Action gains a Projects dependency;
  the Action runs with `github.token` by default; two items share an `ADR ID`
  and the run succeeds; a Projects failure changes any other Action's result.
- **Revisit if:** GitHub gives `GITHUB_TOKEN` project access, adds a user
  Projects permission for Apps, or adds path filters to auto-add; or adopters
  ask for the projection in a form other than draft items.

## Evidence rung

**None yet; rung 1 at best when built** under ADR-0014. Rung 1 would be unit
and contract tests of the projection plan and the client port against a fake,
each observed failing first. Rung 2 would be a run in
[`adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood)
against a user-owned project, the default path of clause 13, which exercises
the classic-PAT path only. The organization path (App or fine-grained PAT)
stays unmeasured until an organization project is used. No external
party has run it.

## Action items

1. [ ] Confirm against GitHub's API how an item is archived and restored, and
   how a field value is emptied, before relying on clauses 5 and 7; correct
   this record if either differs.
2. [ ] Add `packages/ci/src/project-*.ts`: a pure projection plan from
   `lintCorpus` and `buildQueueReport`, an injected Projects client port, and
   the entrypoint, with tests for duplicate keys, missing fields,
   `create-fields`, pacing, the creation budget, archiving, the
   no-`Status`-write rule, and the no-command body.
3. [ ] Add `packages/ci/project/action.yml`, the `dist/project-action.js`
   build, and `project` in `files`.
4. [ ] Teach `action-tag-recovery.yml` and `docs/RELEASING.md` the new nested
   bundle.
5. [ ] Document the workflow (triggers, concurrency, both token paths) and the
   zero-code labeler recipe.
6. [ ] Run it in `adrkit-t018-dogfood` against a user-owned project as the
   rung-2 evidence.
7. [ ] Decide later, in its own change, whether to link a record's open pull
   request as a second, unkeyed item, which would need a pull-request read
   permission this version does not ask for.
8. [ ] Ratify or reject this record.
