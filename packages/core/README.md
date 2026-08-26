# @adrkit/core

Pure, deterministic building blocks for working with adrkit architecture
decision records: parsing, schema validation, corpus invariants, MADR migration,
graph construction, queue projection, and `affects` resolution.

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
declares the decision it lives under with an `@adr <id>` marker in a comment.

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

`firedMatchers` records what the ADR matched. `declaredBy` records what the file
declared. Keeping them separate lets consumers distinguish "this record matched
the path" from "this file opted into the record."

## Marker scanning contract

`scanSourceMarkers(source, path)` is the pure half: text in, markers out, no
filesystem. It scans only the first `MARKER_HEADER_WINDOW_BYTES` (**8192**) of
the source and stops at the last complete line inside that window.

Markers must be the first content on a dedicated comment line. That keeps prose,
string literals, and trailing inline comments from becoming declarations. Lines
inside ` ``` ` or `~~~` fences are ignored. For markdown extensions
(`.md`, `.mdx`, `.markdown`), the only accepted comment introducers are `<!--`
and `{/*`.

`readSourceMarkers(path)` adds a bounded filesystem read and reports `state` as
`scanned`, `absent`, `unreadable`, or `out-of-tree`, so "found no markers" is
never confused with "could not look." A scanned result includes `scannedBytes`
and `fileBytes` for the observed scan extent.

If a file changes while it is being read, treat those byte counts as
observations rather than strict arithmetic.

## Filesystem boundaries

`readSourceMarkers` takes a repo-relative path from `cwd`.

- Absolute paths are rejected as `out-of-tree`.
- Paths that climb out of the working tree are `out-of-tree`.
- Symlinks are refused as `unreadable` without opening their targets.
- Non-regular files are also `unreadable`, so FIFOs and similar special files
  cannot block the read.

## Batch scans

`readSourceMarkersBatch(paths, cwd)` is the impure boundary used by
`checkChanges`. It normalizes, deduplicates, and sorts the input paths; scans
the first **3,000** normalized paths with at most **16** reads in flight; and
returns every skipped path.

Pass that `SourceMarkerBatchScan` through `markerScans` to get marker-aware
decisions and a deterministic `markerScan` report without adding filesystem
access to `checkChanges`.

The published ESM artifacts run on Node.js 22 or newer. Development in the
adrkit repository uses Bun.

See also [`@adrkit/mcp`](../mcp/README.md), a local read-only Model Context
Protocol server that exposes the same corpus to coding agents.

Documentation: <https://adrkit.dev>

License: Apache-2.0
