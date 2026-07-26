# @adrkit/evaluator

The pure, deterministic Pass 0 evaluator for adrkit. It applies the fixed
eleven-rule rubric to caller-supplied immutable inputs, produces canonical
reports and schema-compatible patches, and routes proposals without approving
or persisting them.

```sh
npm install @adrkit/evaluator     # or: bun add @adrkit/evaluator
```

```ts
import { evaluatePass0 } from '@adrkit/evaluator';

const result = evaluatePass0(input);
```

No model, network, clock, filesystem traversal, or database is used by the
library. The published ESM artifacts run on Node.js 22 or newer; development in
the adrkit repository uses Bun.

See also [`@adrkit/mcp`](../mcp/README.md) — a local, read-only Model Context
Protocol server that exposes the ADR corpus (including superseded/rejected
decisions) to coding agents.

Documentation: <https://adrkit.dev>

License: Apache-2.0
