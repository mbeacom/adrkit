# Negative case: oracle in input order (T020)

**Retained permanent negative case for the ADR-0016 observation of FR-053.**

This is a deliberately-broken copy of the frozen oracle whose
`derivedPathPatterns` is in **input order** (first-appearance across entities,
in file order) rather than `compareCodeUnits` order — the exact defect carried
forward from spike 009. Its `contentHash` is recomputed to be internally valid,
so the integrity check passes and **ordering is the sole failure**, proving the
audit catches the defect independent of hash integrity.

Observed reason string (verbatim), from
`bun scripts/audit-oracle-freeze.ts <this dir>`:

```
FAIL [ordering]: derivedPathPatterns is not in compareCodeUnits order (input order or any other order is inadmissible)
exit=1
```

Restoring the correct compareCodeUnits-ordered artifact (the live evidence tree)
returns the audit to PASS (exit 0). Do not "fix" this variant — it is retained
broken on purpose.
