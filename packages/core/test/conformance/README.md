# Affects resolver conformance cases

Each `cases/*.json` file is portable data for an independent implementation.
The runner creates one ADR-like record per `records[]` entry, using the entry's
`id`, a deterministic path of `docs/adr/<id>-case.md`, and `AdrFrontmatter.parse`
to fill the rest of the frontmatter. It then calls the resolver with all records,
`changedFiles`, and optional `snapshots`.

Case shape:

```json
{
  "records": [
    {
      "id": "0001",
      "affects": [{ "type": "path", "pattern": "packages/core/**" }]
    },
    {
      "id": "0002",
      "affects": [{ "type": "path", "pattern": "packages/core/src/**" }]
    }
  ],
  "changedFiles": ["packages/core/src/index.ts"],
  "snapshots": {
    "changedDependencies": [{ "name": "react", "version": "19.1.0" }]
  },
  "expected": {
    "matches": [
      {
        "recordId": "0001",
        "firedMatchers": [{ "type": "path", "pattern": "packages/core/**" }]
      },
      {
        "recordId": "0002",
        "firedMatchers": [{ "type": "path", "pattern": "packages/core/src/**" }]
      }
    ],
    "findings": []
  }
}
```

`snapshots` is optional. `expected` is the full stable resolver result after
sorting: matches by `recordId`, fired matchers by `(type, pattern)`, and findings
by `(rule, recordId, pattern)`. Multi-record cases are required so the suite
expresses cross-record union and ADR-scoped negation: one record's negated matcher
can suppress only that record, never another record's positive match.
