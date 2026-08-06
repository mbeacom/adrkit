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
source and reporting `truncated` when it stopped short. `readSourceMarkers`
wraps it with a single bounded read and reports `state` as `scanned`, `absent`,
or `unreadable`, so "found no markers" is never confused with "could not look."

The published ESM artifacts run on Node.js 22 or newer. Development in the
adrkit repository uses Bun.

See also [`@adrkit/mcp`](../mcp/README.md) — a local, read-only Model Context
Protocol server that exposes this corpus (including superseded/rejected
decisions) to coding agents.

Documentation: <https://adrkit.dev>

License: Apache-2.0
