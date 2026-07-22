# Quickstart Validation Guide: ARB Operations Queue — Phase 6

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-07-20

This guide provides runnable validation scenarios that prove the queue feature
works end-to-end. It is a validation/run guide, NOT an implementation guide —
details of the kernel, CLI flags, and Action configuration live in the
[`contracts/`](./contracts/) directory.

---

## Prerequisites

```bash
# From repository root
bun install --frozen-lockfile  # must succeed offline after first install
bun run build                  # builds all packages including queue
bun run typecheck              # no type errors
```

---

## Fixture Corpus Setup

The validation scenarios use the committed comprehensive fixture corpus. The following
script copies it to an isolated directory under `/tmp` with records spanning all seven
SLA states plus invalid-file cases.

A full fixture corpus definition (with frontmatter content for each state)
is maintained at `packages/core/test/fixtures/queue/`. The test suite loads
from there. For manual quickstart scenarios, create the fixture directory
and point `--dir` at it.

```bash
CORPUS=/tmp/adrkit-queue-test
rm -rf "$CORPUS"
mkdir -p "$CORPUS"
cp packages/core/test/fixtures/queue/comprehensive-corpus/*.md "$CORPUS"/
```

---

## CLI Validation Scenarios

### QS-CLI-01: Basic JSON output — happy path

**Scenario**: A corpus with one `proposed` record, `queuedAt` in the past,
`slaDays: 14`, no `decidedAt`. `asOf` is computed to be 7 days after
`queuedAt`. Expect one `within-sla` item.

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/within-sla-corpus \
  --as-of 2026-01-08 \
  --format json
```

**Expected behavior**:
- Exit code: `0`
- Stdout: valid JSON matching `QueueReport` v1 schema (see
  [contracts/queue-report.md](./contracts/queue-report.md))
- `version: "1"`, `asOf: "2026-01-08"`
- `items` array has exactly 1 entry
- `items[0].slaState: "within-sla"`
- `items[0].deadlineDate`: `queuedAt_date + 14 days`
- `totalCorpusFindings: 0`
- Final newline check:

  ```bash
  bun run adr -- queue \
    --dir packages/core/test/fixtures/queue/within-sla-corpus \
    --as-of 2026-01-08 \
    --format json > /tmp/run1.json
  # Verify final newline: last byte is 0x0a
  tail -c1 /tmp/run1.json | od -An -tx1 | grep -q '0a' && echo "OK: final newline present"
  ```

### QS-CLI-02: Markdown output — default format

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/within-sla-corpus \
  --as-of 2026-01-08
```

**Expected behavior**:
- Exit code: `0`
- Stdout: Markdown beginning with `# ARB Queue — 2026-01-08`
- `## Queue Items` section present with table
- `## Corpus Findings` section absent (no corpus findings)
- Final newline

### QS-CLI-03: Overdue item

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/overdue-corpus \
  --as-of 2026-03-01 \
  --format json
```

**Expected behavior**:
- Exit code: `0` (no error-severity findings)
- `items[0].slaState: "overdue"`
- `items[0].deadlineDate` is before `2026-03-01`

### QS-CLI-04: Due item (deadline equals asOf)

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/due-corpus \
  --as-of 2026-02-15 \
  --format json
```

**Expected behavior**:
- Exit code: `0`
- `items[0].slaState: "due"`
- `items[0].deadlineDate: "2026-02-15"`

### QS-CLI-05: Missing SLA (queuedAt present, no deadline computable)

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/missing-sla-corpus \
  --as-of 2026-01-08 \
  --format json
```

**Expected behavior**:
- Exit code: `0`
- `items[0].slaState: "missing-sla"`
- `items[0].deadlineDate: null`
- `items[0].queuedAt`: non-null (must be present for missing-sla state)

### QS-CLI-06: Decided item

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/decided-corpus \
  --as-of 2026-01-08 \
  --format json
```

**Expected behavior**:
- Exit code: `0`
- `items[0].slaState: "decided"`
- `items[0].decidedAt`: non-null

### QS-CLI-07: Escalated item (escalatedAt, no decidedAt)

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/escalated-corpus \
  --as-of 2026-01-08 \
  --format json
```

**Expected behavior**:
- Exit code: `0`
- `items[0].slaState: "escalated"`
- `items[0].escalatedAt`: non-null
- `items[0].decidedAt: null`

### QS-CLI-08: Not-queued item (no review block)

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/not-queued-corpus \
  --as-of 2026-01-08 \
  --format json
```

**Expected behavior**:
- Exit code: `0`
- `items[0].slaState: "not-queued"`
- `items[0].queuedAt: null`

### QS-CLI-09: Schema-invalid file → corpus finding + exit 1

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/schema-invalid-corpus \
  --as-of 2026-01-08 \
  --format json
```

**Expected behavior**:
- Exit code: `1`
- Stdout: complete JSON report (report IS emitted even on error exit)
- `corpusFindings` non-empty; at least one entry with `code: "corpus.schema-invalid"` and `severity: "error"`
- `items` may be empty or contain other valid proposed records

### QS-CLI-10: One-way-door + auto tier cross-invariant → corpus finding + exit 1

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/one-way-door-auto-corpus \
  --as-of 2026-01-08 \
  --format json
```

**Expected behavior**:
- Exit code: `1`
- `corpusFindings[0].code: "corpus.one-way-door-auto-tier"`
- `corpusFindings[0].severity: "error"`
- Message contains both `one-way-door` and `auto`

### QS-CLI-11: Determinism — two runs produce identical bytes

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/within-sla-corpus \
  --as-of 2026-01-08 \
  --format json > /tmp/run1.json

bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/within-sla-corpus \
  --as-of 2026-01-08 \
  --format json > /tmp/run2.json

diff /tmp/run1.json /tmp/run2.json
echo "diff exit: $?"  # must be 0 (identical)
```

**Expected behavior**: `diff` exits `0`; no output.

### QS-CLI-12: Timezone normalization

```bash
# +05:00 datetime that is 2026-01-07 in UTC
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/within-sla-corpus \
  --as-of "2026-01-08T01:00:00+05:00" \
  --format json | bun -e "
    const chunks = [];
    for await (const c of Bun.stdin.stream()) chunks.push(c);
    const d = JSON.parse(Buffer.concat(chunks).toString());
    console.log(d.asOf);
  "
```

**Expected output**: `2026-01-07` (UTC normalization: `2026-01-08T01:00:00+05:00`
= `2026-01-07T20:00:00Z`)

### QS-CLI-13: Invalid `--format` value → exit 2, no report

```bash
bun run adr -- queue --format csv > /tmp/out.txt 2>/tmp/err.txt; echo "exit: $?"
```

**Expected behavior**:
- `exit: 2`
- `/tmp/out.txt` is empty
- `/tmp/err.txt` contains usage message mentioning `--format`

### QS-CLI-14: Invalid `--as-of` value → exit 2, no report

```bash
bun run adr -- queue --as-of "not-a-date" > /tmp/out.txt 2>/tmp/err.txt; echo "exit: $?"
```

**Expected behavior**:
- `exit: 2`
- `/tmp/out.txt` is empty
- `/tmp/err.txt` contains error message

### QS-CLI-15: Warning-only finding → exit 0

```bash
bun run adr -- queue \
  --dir packages/core/test/fixtures/queue/warn-review-by-before-queued-corpus \
  --as-of 2026-01-08 \
  --format json
echo "exit: $?"
```

**Expected behavior**:
- `exit: 0` (warn findings do not trigger exit 1)
- `items[0].itemFindings[0].code: "item.review-by-before-queued"`
- `items[0].itemFindings[0].severity: "warn"`

---

## Action Validation Scenarios

The Action scenarios require a real GitHub repository with a valid
`GITHUB_TOKEN` granting `issues: write`. These scenarios are manual
validation steps — they can be run during implementation to verify
Action behaviour. QS-ACT-01 through QS-ACT-06 passing in a real
repository is the prerequisite evidence for the rung-6 dogfood claim
(SC-004), but SC-004 gates the *rung-6 landed claim*, not the
implementation itself.

**Setup**:
```yaml
# .github/workflows/queue-validate.yml
name: Validate ARB Queue

on:
  workflow_dispatch:   # manual trigger for validation
  push:
    paths:
      - 'docs/adr/**'

jobs:
  queue:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: mbeacom/adrkit/packages/ci/queue@v0
        with:
          dir: docs/adr
```

### QS-ACT-01: First run — creates managed issue

**Pre-condition**: No existing GitHub issues in the repository with the
adrkit marker (`<!-- adrkit-managed-queue-issue -->`).

**Run**: trigger `queue-validate.yml` manually.

**Expected behavior**:
- Action exits `0` (assuming no error-severity findings)
- One new GitHub issue created in the repository
- Issue title: `"ADR ARB Queue"` (or the `issue-title` input if overridden)
- Issue body: Markdown queue report with marker comment in first line
- Action log shows: `Created issue #<N>`
- Step output `issue-number: <N>`

### QS-ACT-02: Second run — updates same issue (idempotent)

**Pre-condition**: QS-ACT-01 has run; issue `#N` is open.

**Run**: trigger `queue-validate.yml` a second time (no ADR changes needed).

**Expected behavior**:
- Action exits `0`
- Issue `#N` body is updated (potentially identical content if corpus unchanged)
- No new issues created
- `issue-number: <N>` (same issue number as QS-ACT-01)

### QS-ACT-03: Closed managed issue — reopened and updated

**Pre-condition**: Manually close the managed issue `#N` after QS-ACT-01.

**Run**: trigger `queue-validate.yml`.

**Expected behavior**:
- Action exits `0`
- Issue `#N` is reopened (state: `open`) and body is updated
- No new issue created
- `issue-number: <N>`

### QS-ACT-04: Error findings → issue updated, action fails

**Pre-condition**: Temporarily add a schema-invalid ADR file to `docs/adr/`
(e.g., missing required `id` field) and commit it.

**Run**: trigger `queue-validate.yml`.

**Expected behavior**:
- Action exits `1` (non-zero; job fails)
- Managed issue IS updated with the full error report (not skipped)
- `corpusFindings` visible in the issue body
- Issue body includes the schema-invalid finding

**Cleanup**: Remove the invalid ADR file after validation.

### QS-ACT-05: Duplicate marker → action fails, no write

**Pre-condition**: Manually create two additional GitHub issues (open or closed)
with the marker `<!-- adrkit-managed-queue-issue -->` in their bodies.

**Run**: trigger `queue-validate.yml`.

**Expected behavior**:
- Action exits `1`
- Action log names all conflicting issue numbers
- Neither existing issue body is modified (no write performed)

**Cleanup**: Delete or edit the two extra issues to remove their markers.

### QS-ACT-06: Default token, issues:write only — no PAT required

**Verify**: The workflow uses only `GITHUB_TOKEN` (the default token
automatically injected by GitHub Actions). No repository secret is needed
beyond the built-in token.

**Test**: remove the `token` input from `action.yml` usage (rely on default).
The Action must still succeed (QS-ACT-01 or QS-ACT-02 scenario).

---

## Rung-2 Reference-Validation Criteria (SC-004 — ADR-0014 rung 2)

SC-004 is the **ADR-0014 rung-2 gate that lands Phase 6** — met by a maintainer-owned
isolated reference repository, not by an external team, and not a gate before
implementation.

To land Phase 6, a **maintainer-owned isolated reference repository** (separate from
this monorepo) completed the following dogfood exercise — reproducibly (pinned adrkit
commit), self-verifyingly (the reference repo asserts its own outcomes in CI), and
reviewed:

- [x] Repository contains at least 3 `proposed` ADRs spanning `auto`, `async`, and `arb` tiers
- [x] At least one ADR is overdue or at the due boundary as of the run date
- [x] At least one ADR has `approvals` and `objections` in its `review` block
- [x] `adr queue --format json` produces a valid `QueueReport` v1 JSON
- [x] The GitHub Action creates a managed issue on first run
- [x] The same managed issue is updated (not replaced) on a second run
- [x] Default `GITHUB_TOKEN` with `issues: write` is the only credential used
- [x] No installation, runtime, or permission blockers encountered

Evidence is documented and linked in
[checklists/reference-validation-evidence.md](./checklists/reference-validation-evidence.md)
([`adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood), Action pinned
at `efef89b`). This is reference validation (ADR-0014 rung 2), **not** external/community
validation (rung 3, open).
