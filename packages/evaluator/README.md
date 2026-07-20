# @adrkit/evaluator

The pure, deterministic Pass 0 evaluator for adrkit. It applies the fixed
eleven-rule rubric to caller-supplied immutable inputs, produces canonical
reports and schema-compatible patches, and routes proposals without approving
or persisting them.

```sh
bun add @adrkit/evaluator
```

```ts
import { evaluatePass0 } from '@adrkit/evaluator';

const result = evaluatePass0(input);
```

No model, network, clock, filesystem traversal, or database is used by the
library. The published ESM artifacts run on Node.js 22 or newer.

Documentation: <https://adrkit.dev>

License: Apache-2.0
