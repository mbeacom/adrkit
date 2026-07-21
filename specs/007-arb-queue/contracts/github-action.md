# Contract: GitHub Action — Managed Queue Issue

**Feature**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md) | **Date**: 2026-07-20

This contract defines the GitHub Action surface for the ARB queue: its `action.yml`
inputs, outputs, permissions, the `GitHubQueueClient` interface, the managed-issue
discovery algorithm, state-machine transitions, error matrix, and no-partial-write
semantics.

---

## Action Location

```
packages/ci/queue/action.yml
```

Users reference it as:

```yaml
- uses: mbeacom/adrkit/packages/ci/queue@v0
```

This is a separate YAML from the existing `packages/ci/action.yml` (the PR
governing-decisions action). Each action has distinct triggers, permissions, and
purposes.

---

## `action.yml` Content

```yaml
name: "ADR ARB Queue"
author: "adrkit"
description: >
  Creates or updates a single GitHub issue containing the current ADR ARB
  operations queue report. Requires issues: write permission.

inputs:
  dir:
    description: "Path to the ADR corpus directory (relative to GITHUB_WORKSPACE)"
    required: false
    default: "docs/adr"
  token:
    description: >
      GitHub token with issues: write permission. Calling workflows using
      actions/checkout must also declare contents: read.
    required: false
    default: "${{ github.token }}"
  issue-title:
    description: "Title of the managed queue issue"
    required: false
    default: "ADR ARB Queue"

outputs:
  issue-number:
    description: "The GitHub issue number of the managed queue issue"

runs:
  using: "node24"
  main: "../dist/queue-action.js"

branding:
  icon: "inbox"
  color: "blue"
```

---

## Required Permissions

The Action's own GitHub API calls require only:

```yaml
permissions:
  issues: write
```

The default `GITHUB_TOKEN` is sufficient. No PAT, no additional scopes.

**Calling workflow note**: A workflow that also runs `actions/checkout` must declare
**both** permissions in its `permissions:` block. `contents: read` is required for
checkout (particularly on private repositories). Example:

```yaml
permissions:
  contents: read
  issues: write
```

The Action itself does not use `contents: read` — only the checkout step needs it.
However, explicitly setting `issues: write` in the job `permissions:` block will
strip all other default permissions (including `contents: read`) unless they are
also listed. Callers MUST include `contents: read` whenever they also run checkout.

---

## Bundle Entry Point

| Source | Bundle output |
|--------|---------------|
| `packages/ci/src/queue-action-entrypoint.ts` | `packages/ci/dist/queue-action.js` |

Built as a separate `bun build` target from the existing `dist/index.js`.
The entrypoint:

1. Reads `dir`, `token`, `issue-title` from `@actions/core`.
2. Resolves `GITHUB_WORKSPACE` and calls `lintCorpus({ dir, cwd: workspace })`.
3. Resolves `asOf` from the current UTC date.
4. Calls `buildQueueReport({corpus, asOf})` — fingerprint computed inside kernel.
5. Calls `formatQueueReportMarkdown(report)` from `@adrkit/core` to get the report body.
6. Calls `managedQueueIssue()` with the rendered Markdown and a `GitHubQueueClient`.
7. Sets `issue-number` output via `core.setOutput`.
8. Calls `core.setFailed()` if the report has error-severity findings OR if
   any GitHub API call fails.

`@actions/core` and `@actions/github` imports are confined to this file only.

---

## GitHubQueueClient Interface

The GitHub API surface required by `managedQueueIssue()`. Defined in
`packages/ci/src/queue-issue.ts`. The side-effect-free Octokit adapter lives in
`packages/ci/src/queue-github-client.ts`; the entrypoint passes it the Octokit instance.
Both are faked structurally in tests without importing `@actions/*`.

```typescript
export interface GitHubQueueClient {
  /**
   * Returns ALL issues (open AND closed) in the repository.
   * Implementation must exhaust the GraphQL repository.issues connection
   * with 100 nodes per cursor page. Pull requests are excluded by the GraphQL type.
   */
  listAllIssues(): Promise<Array<{
    number: number;
    state: "open" | "closed";
    title: string;
    body: string | null;
  }>>;

  /**
   * Creates a new issue with the given title and body.
   * Returns the new issue's number.
   */
  createIssue(title: string, body: string): Promise<{ number: number }>;

  /**
   * Updates an existing issue's body and optionally its state.
   * - For an open managed issue: call with { body } only.
   * - For a closed managed issue: call with { body, state: 'open' } — one atomic
   *   REST call that sets both body and state together (no separate reopen step).
   * Does NOT change title.
   */
  updateIssue(issueNumber: number, update: { body: string; state?: 'open' }): Promise<void>;
}
```

**Octokit implementation** (`queue-github-client.ts`; tests use a structural fake):

```typescript
function createOctokitQueueClient(octokit: QueueOctokit, owner: string, repo: string): GitHubQueueClient {
  return {
    async listAllIssues() {
      const issues = [];
      let cursor: string | null = null;
      do {
        const data = await octokit.graphql(QUEUE_ISSUES_QUERY, {
          owner, repo, cursor,
        });
        const page = data.repository.issues;
        issues.push(...page.nodes.map(i => ({
          number: i.number,
          state: i.state.toLowerCase() as "open" | "closed",
          title: i.title,
          body: i.body ?? null,
        })));
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor !== null);
      return issues;
    },
    async createIssue(title, body) {
      const { data } = await octokit.rest.issues.create({ owner, repo, title, body });
      return { number: data.number };
    },
    async updateIssue(issueNumber, update) {
      await octokit.rest.issues.update({
        owner, repo, issue_number: issueNumber,
        body: update.body,
        ...(update.state ? { state: update.state } : {}),
      });
    },
  };
}
```

`QUEUE_ISSUES_QUERY` requests
`repository(owner:$owner,name:$repo).issues(first:100,after:$cursor,states:[OPEN,CLOSED])`
with `nodes { number state title body }` and
`pageInfo { hasNextPage endCursor }`. The GraphQL `issues` connection excludes pull
requests by construction. Exhaustive cursor traversal is required because marker
ownership and duplicate detection must not rely on eventually consistent search results.

---

## Marker Constant

```
<!-- adrkit-managed-queue-issue -->
```

This HTML comment is invisible in rendered Markdown. It is:
- Globally unique to adrkit-managed queue issues.
- Corpus-independent: it does not change with the report content.
- Stable across all reruns.
- Always the **first line** of the managed issue body.

The issue body template:

```
<!-- adrkit-managed-queue-issue -->
{rendered Markdown queue report}
```

**Discovery rule**: An issue is "managed" if and only if the exact first line of its
body equals the marker:

```typescript
const firstLine = (body ?? "").split(/\r\n|\n|\r/, 1)[0];
const isManaged = firstLine === MARKER;
```

This accepts marker-only, LF, CRLF, and CR bodies while preserving exact ownership.

Leading whitespace before the marker disqualifies the issue. Marker appearing only
in the middle or end of the body does NOT confer ownership. Specifically,
`body.includes(MARKER)` alone is insufficient — first-line check is mandatory.

This rule prevents arbitrary issue bodies that quote or mention the marker string
from being misidentified as managed issues.

---

## Paginated Issue Discovery Algorithm

```
1. issues = await client.listAllIssues()
   // listAllIssues() paginates internally; returns all open + closed issues
   // Pull requests cannot appear in the GraphQL repository.issues connection

2. managed = issues.filter(i => {
     const firstLine = (i.body ?? "").split(/\r\n|\n|\r/, 1)[0];
     return firstLine === MARKER;
   })
   // MARKER = "<!-- adrkit-managed-queue-issue -->"
   // First-line check: marker must be exactly the first line, no leading whitespace

3. switch managed.length:
   case 0: → CREATE branch (see State Machine below)
   case 1: → UPDATE or REOPEN+UPDATE branch
   case 2+: → DUPLICATE-MARKER fail (no write)
```

The discovery is always exhaustive — it does NOT stop at the first hit when
looking for duplicates.

---

## State Machine

### Branch: 0 managed issues found

```
// Title conflict check: examine ALL unowned issues (open AND closed) with the configured title
unowned = issues.filter(i => i.title === issue-title-input AND NOT isManagedByMarker(i))

IF unowned.length > 0:
  → TITLE-CONFLICT fail (no write)
     // Name ALL conflicting issues by number ascending
     conflicts = unowned.sort((a,b) => a.number - b.number).map(i => '#' + i.number)
     error message: "Found ${conflicts.length} issue(s) titled '${title}' without adrkit marker: ${conflicts.join(', ')}. Resolve conflicts before running the queue Action."
     exit: 1

ELSE:
  → CREATE new issue
     body: MARKER + "\n" + markdownReport
     title: issue-title input
     setOutput("issue-number", newIssue.number)
     exit: 0 (or 1 if report has error findings — see Error Findings below)
```

**Title conflict scope**: both open AND closed unowned issues are checked. A closed
unowned issue with the configured title is a conflict just as much as an open one.
The operator must rename every conflict, select a different configured title, or
deliberately add the ownership marker to exactly one issue before a managed issue can
be created. Closing an issue does not resolve the conflict.

### Branch: 1 managed issue found, state = open

```
→ UPDATE existing issue (one atomic REST call — body only)
     await client.updateIssue(managed[0].number, { body: MARKER + "\n" + markdownReport })
     setOutput("issue-number", managed[0].number)
     exit: 0 (or 1 if report has error findings)
```

### Branch: 1 managed issue found, state = closed

```
→ UPDATE issue atomically (one REST call — body AND state: 'open' together)
     await client.updateIssue(managed[0].number, {
       body: MARKER + "\n" + markdownReport,
       state: 'open'
     })
     setOutput("issue-number", managed[0].number)
     exit: 0 (or 1 if report has error findings)
```

**No separate reopen call**: body and state are submitted in one `issues.update` REST
request. There is no client-created intermediate state where the issue is reopened but
the body has not yet been submitted. A 401/403 permission response performs no queue
mutation; for transport failures where the server outcome is unknown, a subsequent run
reconciles the authoritative issue state.

### Branch: 2+ managed issues found

```
→ DUPLICATE-MARKER fail
   error message: "Found ${managed.length} issues with adrkit managed queue marker: #${numbers.join(', #')}. Remove the marker from all but one and re-run."
   NO write to any issue
   exit: 1
```

---

## Error Findings Behavior

When `QueueReport.corpusFindings` contains one or more `error`-severity entries:

1. **Write the managed issue** first (create, update, or reopen+update as
   determined by the state machine above). The full error report IS written.
2. **Then fail** (call `core.setFailed(errorMessage)`).

The issue is always updated with the current report state, even when the report
contains errors. This ensures the managed issue reflects the current corpus health.

Error message for `core.setFailed`: `"Queue report contains ${n} corpus error(s). See issue #${issueNumber} for details."`

This sequence is implemented by a pure `publishQueueReport` orchestration helper in
`queue-issue.ts`. It accepts injected `setOutput` and `setFailed` callbacks so tests can
assert the exact order without importing `@actions/*`. `managedQueueIssue` remains
responsible only for marker/title/state discovery and the single issue mutation; it does
not receive a `QueueReport`.

---

## Error Matrix

| Error | Source | Exit | Write? |
|-------|--------|------|--------|
| Error-severity corpus findings | Report | 1 | Yes (then fail) |
| Permission error on createIssue/updateIssue (403/401) | GitHub API | 1 | No (failed before write) |
| Duplicate marker: 2+ managed issues | Discovery | 1 | No |
| Title conflict: unmanaged issue (open or closed) with same title | Discovery | 1 | No |
| Invalid `dir` input or unavailable workspace/corpus | Action corpus-load boundary | 1 | No |
| `bun build` bundle error | Build time | — | — |

**Permission error message**: `"GitHub API returned ${status}: insufficient permissions. Ensure the workflow grants 'issues: write' to the GITHUB_TOKEN."`

---

## No-Partial-Write Rule

The Action makes **at most one GitHub write call** per run (excluding `setOutput`):
- **Create**: one `createIssue` call. If it fails, nothing was written.
- **Update (open)**: one `updateIssue({body})` call. If it fails, the issue retains
  its previous body.
- **Update (closed)**: one `updateIssue({body, state:'open'})` request that submits body
  and state together, with no separate reopen request.

No prior queue mutation occurs before the single write call. Discovery and report
generation are read-only. If `updateIssue` succeeds but `setOutput` or
`core.setFailed` fails, the issue has already been updated (write completed);
these are non-destructive post-write steps. A transport failure can make the server
outcome unknown; the next marker-first run reconciles the issue without creating a
duplicate.

---

## Bundle Smoke Tests

Follow the pattern established by `scripts/smoke-node.mjs` in the repository root.
The smoke test for the queue Action bundle:

1. **Controlled no-network invocation**: Spawn the committed bundle with a temporary
   `GITHUB_WORKSPACE` whose configured corpus directory does not exist. Set the
   minimal required `INPUT_*` environment variables expected by `@actions/core`
   (`INPUT_DIR`, `INPUT_TOKEN`, `INPUT_ISSUE-TITLE`) to fixture values, and
   provide `GITHUB_REPOSITORY=owner/repo` and `GITHUB_TOKEN=fake_token`. The entrypoint
   MUST fail at the corpus-load boundary before constructing or calling the GitHub
   client. Assert the known corpus error and non-zero exit rather than a
   module-resolution error. No real API call is permitted.

2. **Do NOT import the executable entrypoint in-process or pass `--help`** — its
   top-level behavior is the Action invocation and it has no help guard.

3. **Node 22 and Node 24 coverage**: Run the smoke test once on each. The
   `action.yml` declares `using: node24`; the runner provides that. Local CI
   only needs to confirm the bundle loads under both currently-supported LTS
   Node releases. Use the `@actions/core`-less import path if a pure static
   check is simpler.

5. **Existing action bundle**: The queue bundle smoke test is additive to the
   existing `scripts/smoke-node.mjs` check for `dist/index.js`. Both tests run
   in CI. Do not modify the existing smoke script to add queue logic; add a
   new script (e.g. `scripts/smoke-queue-node.mjs`) or extend the existing one
   in a backwards-compatible way.

---

## New Files Required

| File | Purpose |
|------|---------|
| `packages/ci/queue/action.yml` | Action manifest (this contract) |
| `packages/ci/src/queue-issue.ts` | `managedQueueIssue()` function + `GitHubQueueClient` interface |
| `packages/ci/src/queue-github-client.ts` | Side-effect-free GraphQL issue adapter; exhaustive cursor pagination |
| `packages/ci/src/queue-action-entrypoint.ts` | `@actions/core`/`@actions/github` boundary; wires the adapter and executes |

**`packages/ci/package.json` additions**:
- New `bun build` script target: `bun build src/queue-action-entrypoint.ts --outfile dist/queue-action.js --target node`.
- `@adrkit/ci` is a **private** package; this is NOT a public npm export. The
  bundle is committed to the repository and referenced by the action's `main:` path.
  No new `"exports"` subpath in `package.json` is needed for the Action distribution.

No new runtime dependencies needed in `@adrkit/ci`; `@actions/core` and
`@actions/github` are already in the package's dependencies.

---

## Test Coverage

Tests live in `packages/ci/test/queue-issue.test.ts`. The `GitHubQueueClient`
interface is injected, so tests use a hand-rolled fake — no network, no token.

Required test scenarios:

| Scenario | Expected behaviour |
|----------|--------------------|
| 0 managed, 0 conflicts | CREATE new issue |
| 0 managed, 1 open title conflict | TITLE-CONFLICT fail, no write |
| 0 managed, 1 closed title conflict | TITLE-CONFLICT fail, no write |
| 0 managed, 2 title conflicts (open + closed) | All conflict numbers in message ascending, no write |
| 1 managed open | UPDATE body, single write call |
| 1 managed closed | Single `updateIssue({body, state:'open'})` call, not two calls |
| 2 managed | DUPLICATE-MARKER fail, no write |
| Marker in middle of body | NOT detected as managed |
| Marker with leading whitespace | NOT detected as managed |
| Marker exactly alone | Detected as managed |
| PR in issues list | Filtered out before marker/title logic |
| listAllIssues returns 100+ items | All pages consumed |
| Error corpus findings | Write completes, then setFailed |
| GitHub API 403 on updateIssue | No partial write; error propagated |
