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
literals in their common inline forms from becoming declarations.
`readSourceMarkers` wraps the scanner with a bounded read and reports `state` as
`scanned`, `absent`,
`unreadable`, or `out-of-tree`, so "found no markers" is never confused with
"could not look."

Its `path` argument is repo-relative to `cwd`. Absolute paths, paths that climb
out of the tree, and every symlink are refused without opening a target;
non-regular files are `unreadable`, so a FIFO cannot block the read.

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
