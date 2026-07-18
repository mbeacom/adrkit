# Affects resolver conformance cases

Each `cases/*.json` file is portable data for an independent implementation.
The runner creates one ADR-like record with id `0001`, path `docs/adr/0001-case.md`,
and the file's `matchers`, then calls the resolver with `changedFiles` and
optional `snapshots`.

Case shape:

```json
{
  "matchers": [{ "type": "path", "pattern": "packages/core/**" }],
  "changedFiles": ["packages/core/src/index.ts"],
  "snapshots": {
    "changedDependencies": [{ "name": "react", "version": "19.1.0" }]
  },
  "expected": {
    "matches": [
      {
        "recordId": "0001",
        "firedMatchers": [{ "type": "path", "pattern": "packages/core/**" }]
      }
    ],
    "findings": []
  }
}
```

`snapshots` is optional. `expected` is the full stable resolver result after
sorting: matches by `recordId`, fired matchers by `(type, pattern)`, and findings
by `(rule, recordId, pattern)`.
