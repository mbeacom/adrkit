# scope-hierarchy fixtures

Attributable contradiction scenarios (component proposal vs applicable accepted org ADR,
base-green→proposed-red assertion transition) are constructed as in-memory immutable
records + base/proposed inputs + a registered JSONPath engine in
`scope-hierarchy.test.ts` (offline, via `test/support.ts`). The evaluator compiles and
evaluates the accepted org assertion itself; it never accepts a precomputed verdict.
Missing engine/source/base/proposed evidence is inert.
