# supersession-consistent fixtures

Corpus-relation scenarios (reciprocity + acyclicity) are constructed as in-memory
immutable records in `supersession-consistent.test.ts` (offline, via `test/support.ts`).
`buildAdrGraph` supplies edges only; reciprocity and cycle detection are new checks
(research §R3). `dangling-supersededBy` is owned by this rule and is not re-reported by
`no-orphan-refs`.
