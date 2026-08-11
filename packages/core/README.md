# @adrkit/core

Pure, deterministic building blocks for working with adrkit architecture
decision records: parsing, schema validation, corpus invariants, MADR migration,
graph construction, and `affects` resolution.

```sh
npm install @adrkit/core      # or: bun add @adrkit/core
```

```ts
import { lintCorpus } from '@adrkit/core';

const findings = lintCorpus(records);
```

## Resolving decisions in both directions

`resolveAffects` is the outbound edge: a record declares patterns, and paths are
matched against them. `resolveSourceMarkers` is the inbound edge: a source file
declares the decision it lives under with an `@adr <id>` marker in a comment
([ADR-0021](https://github.com/mbeacom/adrkit/blob/main/docs/adr/0021-resolve-inbound-source-annotations-without-changing-the-schema.md)).

```ts
import {
  mergeSourceDeclarations,
  readSourceMarkers,
  readSourceMarkersBatch,
  resolveAffects,
  resolveSourceMarkers,
  scanSourceMarkers,
  toGoverningDecisions,
} from '@adrkit/core';

const scan = await readSourceMarkers('src/services/sync/retry.ts');
const byMarker = resolveSourceMarkers({ records, markers: scan.markers });
const byPattern = resolveAffects({ records, changedFiles: ['src/services/sync/retry.ts'] });

const governedBy = mergeSourceDeclarations(
  toGoverningDecisions(records, byPattern.matches),
  records,
  byMarker.matches,
);
```

Each decision keeps the two apart: `firedMatchers` is what the record matched,
`declaredBy` is what the file declared. `declaredBy` is omitted entirely when
nothing declared the record, so consumers written against the pre-marker shape
are unaffected.

`scanSourceMarkers(source, path)` is the pure half — text in, markers out, no
filesystem — bounded to the first `MARKER_HEADER_WINDOW_BYTES` (8192) of the
source and reporting `truncated` when it stopped short. Markers must be the first
content on a dedicated comment line, which keeps documentation prose and string
literals in their common inline forms from becoming declarations. A line inside a
` ``` ` or `~~~` fence is an example rather than a declaration, and `path`
selects the introducer set: a markdown extension (`.md`, `.mdx`, `.markdown`)
accepts only `<!--` and `{/*`, because `#` and `*` are markdown's own heading and
list syntax. Two files with identical bytes and different extensions can
therefore scan differently.
`readSourceMarkers` wraps the scanner with a bounded read and reports `state` as
`scanned`, `absent`,
`unreadable`, or `out-of-tree`, so "found no markers" is never confused with
"could not look." A `scanned` result also carries `scannedBytes` and `fileBytes`.
`scannedBytes` is the prefix handed to the scanner — not the number of bytes pulled
from the handle, which also includes a truncation probe byte and any partial trailing
line the cut then discards — and it is the cut actually taken rather than
`min(fileBytes, 8192)`, because the window is cut back to its last complete line.
`fileBytes - scannedBytes` is how much of a truncated file went unscanned, which
`truncated` alone does not say. Both are omitted for a state that never opened the
file, so a `0` extent means a window with no line terminator, never "not measured."

The two are separate observations, not one: `fileBytes` comes from an `fstat` taken
before the read loop, so a file written concurrently can report `scannedBytes >
fileBytes` (appended) or look partial when it was read whole (truncated). They are
left unreconciled deliberately — agreeing them would hide a file that changed
underneath the scan — so a consumer differencing them should clamp at `0` rather than
assume the remainder is non-negative.

Its `path` argument is repo-relative to `cwd`. Absolute paths and paths that climb
out of the tree are `out-of-tree`. Every symlink is refused as `unreadable`
without opening its target; non-regular files are also `unreadable`, so a FIFO
cannot block the read.

`readSourceMarkersBatch(paths, cwd)` is the impure boundary for `checkChanges`.
It normalizes, deduplicates, and sorts paths; scans the first 3,000 with at most
16 reads in flight; resolves the working-tree root once; and returns every
skipped path. Pass that `SourceMarkerBatchScan` through `markerScans` to receive
marker-aware decisions and a deterministic `markerScan` report without adding
filesystem access to `checkChanges`.

The published ESM artifacts run on Node.js 22 or newer. Development in the
adrkit repository uses Bun.

See also [`@adrkit/mcp`](../mcp/README.md) — a local, read-only Model Context
Protocol server that exposes this corpus (including superseded/rejected
decisions) to coding agents.

Documentation: <https://adrkit.dev>

License: Apache-2.0
