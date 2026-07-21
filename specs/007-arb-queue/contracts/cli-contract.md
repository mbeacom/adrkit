# Contract: CLI Interface — ARB Queue

**Feature**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md) | **Date**: 2026-07-20

This contract is the normative reference for the `adr queue` subcommand of the
`@adrkit/cli` package. It governs the interface visible to all callers: flags,
defaults, stdout/stderr assignment, exit codes, and invalid-input behavior.

---

## Command Syntax

```
adr queue [options]
```

Subcommand of the existing `adr` CLI binary. Emits a queue report of the local
ADR corpus to stdout.

---

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dir <path>` | string | `docs/adr` | Path to the ADR corpus directory. Resolved relative to CWD. |
| `--as-of <date>` | string | current UTC date | UTC calendar date for SLA state computation. See §As-Of Resolution. |
| `--format markdown\|json` | enum | `markdown` | Output format. `markdown` is the default; `json` emits QueueReport v1 JSON. |

---

## As-Of Date Resolution

The `--as-of` flag accepts two forms:

1. **Bare date**: `YYYY-MM-DD` — must match the regex `/^\d{4}-\d{2}-\d{2}$/` AND
   pass a safe UTC round-trip validation:
   `const parsed = new Date(input + 'T00:00:00Z')`;
   `Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === input`.
   The finite-time guard prevents `toISOString()` from throwing on invalid dates such as
   `2026-13-01`; the round-trip comparison rejects normalized impossible dates such as
   `2026-02-30`. If any check fails, exit 2.

2. **ISO datetime with explicit offset**: a string containing `T` and an explicit
   timezone designator (`Z` or a numeric offset `±HH:MM` or `±HHMM`), e.g.
   `2026-01-08T01:00:00+05:00` or `2026-01-08T00:00:00Z`. Normalized to UTC:
   `new Date(input).toISOString().slice(0,10)`. Timezone-less ISO datetimes
   (e.g. `2026-01-08T10:00:00`) are rejected (exit 2) — they are ambiguous about
   which UTC day they fall on.

   Detection: an input contains `T` but neither `Z` nor a `+`/`-` offset after the
   time component is a timezone-less datetime — reject it. Concretely: after removing
   the date and time portion, if no UTC marker is present, reject with exit 2.

**If absent**: `new Date().toISOString().slice(0,10)` at the CLI call site. The
resolved date is always included in the report output (as `QueueReport.asOf` in JSON;
as the `# ARB Queue — {date}` heading in Markdown).

**Invalid `--as-of`**: any of the following triggers exit 2:
- Does not match bare-date regex AND does not contain `T`.
- Matches bare-date regex but fails UTC round-trip.
- Contains `T` but has no explicit timezone designator (timezone-less datetime).
- Parses to NaN via `new Date(input)`.

**Exact stderr messages** (all followed by `\n`):
- Bare-date format violation or round-trip failure:
  `"Invalid --as-of value: '{value}'. Expected YYYY-MM-DD or ISO datetime with explicit timezone (e.g. 2026-01-08 or 2026-01-08T00:00:00Z).\n"`
- Timezone-less datetime:
  `"Invalid --as-of value: '{value}'. Timezone-less datetimes are ambiguous — use YYYY-MM-DD or add an explicit timezone offset (e.g. Z or +05:00).\n"`

---

## Stdout Assignment

| Scenario | Stdout |
|----------|--------|
| Success (`--format markdown`) | Markdown queue report |
| Success (`--format json`) | QueueReport v1 JSON with final `\n` |
| Error-severity finding in corpus (`exit 1`) | **Complete report** (same format as success) emitted to stdout before exit |
| Invalid flag or value (`exit 2`) | *Empty* (nothing written to stdout) |

The complete report is ALWAYS emitted to stdout before any non-zero exit, except for
exit-2 (usage errors), where no report is produced.

---

## Stderr Assignment

| Scenario | Stderr |
|----------|--------|
| Success (`exit 0`) | Empty |
| Error-severity finding (`exit 1`) | Empty |
| Invalid `--format` value (`exit 2`) | Usage message: `"Invalid --format value: '{value}'. Expected markdown or json.\n"` |
| Invalid `--as-of` value (`exit 2`) | Error message: `"Invalid --as-of value: '{value}'. Expected YYYY-MM-DD or ISO datetime with explicit timezone...\n"` (see §As-Of Resolution for exact messages) |
| Unrecognized flag (`exit 2`) | Usage message: `"Unknown flag: '{flag}'. See 'adr queue --help'.\n"` |
| Corpus directory not found (`exit 2`) | Error message: `"Corpus directory not found: '{path}'.\n"` |

---

## Exit Code Matrix

| Code | Meaning | Stdout emitted? |
|------|---------|-----------------|
| `0` | Complete report; zero `error`-severity findings | Yes (full report) |
| `1` | Complete report; one or more excluded-file `error` entries in `report.corpusFindings` | Yes (full report) |
| `2` | Usage error; invalid flag, value, or unreachable corpus directory | No |

---

## Invalid-Input Behavior: Details

### Invalid `--format` value

```bash
$ adr queue --format csv
# stdout: (empty)
# stderr: Invalid --format value: 'csv'. Expected markdown or json.
# exit: 2
```

No report is generated. The kernel is not invoked.

### Invalid `--as-of` value

```bash
$ bun run adr -- queue --as-of "not-a-date"
# stdout: (empty)
# stderr: Invalid --as-of value: 'not-a-date'. Expected YYYY-MM-DD or ISO datetime with explicit timezone (e.g. 2026-01-08 or 2026-01-08T00:00:00Z).
# exit: 2

$ bun run adr -- queue --as-of "2026-01-08T10:00:00"
# stdout: (empty)
# stderr: Invalid --as-of value: '2026-01-08T10:00:00'. Timezone-less datetimes are ambiguous — use YYYY-MM-DD or add an explicit timezone offset (e.g. Z or +05:00).
# exit: 2

$ bun run adr -- queue --as-of "2026-13-01"
# stdout: (empty)
# stderr: Invalid --as-of value: '2026-13-01'. Expected YYYY-MM-DD or ISO datetime with explicit timezone (e.g. 2026-01-08 or 2026-01-08T00:00:00Z).
# exit: 2
```

No report is generated. The kernel is not invoked.

### Corpus directory not found

```bash
$ adr queue --dir /nonexistent/path
# stdout: (empty)
# stderr: Corpus directory not found: '/nonexistent/path'.
# exit: 2
```

---

## Help Flag

```bash
$ adr queue --help
```

Emits usage information to stdout. Exit 0.

---

## Implementation Location

| Concern | File |
|---------|------|
| CLI argument parsing + flag validation | `packages/cli/src/queue.ts` (new) |
| Subcommand registration | `packages/cli/src/index.ts` (new `queue` branch in `main()`) |
| Pure kernel call | `packages/core/src/queue/kernel.ts` (new) |
| Output formatting (Markdown) | `packages/core/src/queue/format.ts` (new; `formatQueueReportMarkdown()`) |
| Output formatting (JSON) | `packages/core/src/queue/format.ts` (new; `formatQueueReportJson()`) |

Both the CLI and the Action import `formatQueueReportMarkdown` and
`formatQueueReportJson` from `@adrkit/core`. The CLI module itself does NOT contain
formatting logic. This ensures identical bytes for identical inputs across both surfaces.

The CLI module must NOT import anything from `@actions/core`, `@actions/github`,
`@adrkit/ci`, or `@adrkit/mcp`. CLI-level dependencies: `@adrkit/core` only.

---

## Determinism Guarantee

Two invocations with identical `--dir` content and identical `--as-of` values MUST
produce byte-for-byte identical stdout. No timestamps, no random identifiers, no
platform-specific paths may appear in the output. (SC-001)
