# identity-expiry fixtures

`decider-resolvable` (identity directory) and `expiry-sane` (explicit `evaluationDate`,
no clock) scenarios are constructed as in-memory immutable records + identity snapshots
in `identity-expiry.test.ts` (offline, via `test/support.ts`). A team resolves only when
it has exactly one active human; the evaluation date is always the caller-supplied
`--date`, never `Date.now()`.
