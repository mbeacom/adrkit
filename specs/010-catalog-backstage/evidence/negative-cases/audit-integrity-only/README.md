# Negative case: integrity-only audit (T021)

**Retained permanent negative case for the ADR-0016 observation of SC-010.**

The two frozen artifacts here are correct (hashes match), but the
`adequacy-audit.json` **confirms integrity and stops** — it records no adequacy
finding. Per ADR-0020 clause 5(a) / SC-010, an integrity confirmation alone does
not satisfy the gate and MUST be recorded as FAIL, never silently accepted. This
is the exact failure mode the T019 adequacy requirement exists to prevent.

Observed reason string (verbatim), from
`bun scripts/audit-oracle-freeze.ts <this dir>`:

```
FAIL [adequacy]: audit confirmed integrity but recorded no adequacy finding — SC-010 requires an explicit adequacy determination, an integrity confirmation alone does not satisfy clause 5(a)
exit=1
```

Restoring an explicit adequacy finding (the live evidence tree, whose
`adequacy-audit.json` records finding = ADEQUATE) returns the audit to PASS
(exit 0). Do not add an adequacy finding to this variant — it is retained broken
on purpose.
