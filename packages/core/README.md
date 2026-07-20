# @adrkit/core

Pure, deterministic building blocks for working with adrkit architecture
decision records: parsing, schema validation, corpus invariants, MADR migration,
graph construction, and `affects` resolution.

```sh
bun add @adrkit/core
```

```ts
import { lintCorpus } from '@adrkit/core';

const findings = lintCorpus(records);
```

The published ESM artifacts run on Node.js 22 or newer. Development in the
adrkit repository uses Bun.

Documentation: <https://adrkit.dev>

License: Apache-2.0
