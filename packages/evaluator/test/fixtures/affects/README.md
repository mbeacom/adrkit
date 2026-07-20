# affects fixtures

Target-resolution scenarios (path/package built-ins + caller-registered
entity/resource/api/data ports, ADR-0009 include/negation/repo semantics, and
accepted-only overlap) are constructed as in-memory immutable records + inventories in
`affects-rules.test.ts` (offline, via `test/support.ts`). The current
target-resolution `log` is supplied explicitly and is distinct from any record's source
log.
