import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  auditFromEvidence,
  auditOracleFreeze,
  canonicalHash,
  REASON_NO_ADEQUACY,
  REASON_ORDER_NOT_COMPARE_CODE_UNITS,
} from './audit-oracle-freeze.ts';

const EVIDENCE = join(process.cwd(), 'specs/010-catalog-backstage/evidence');
const NEG = join(EVIDENCE, 'negative-cases');

describe('T019 audit procedure — observed passing on the live freeze', () => {
  test('the real audit passes against the live evidence tree', async () => {
    const result = await auditFromEvidence(EVIDENCE);
    expect(result).toEqual({ ok: true, findings: [] });
  });
});

describe('T020 — observed failing: derivedPathPatterns in input order', () => {
  test('the real audit FAILS with the ordering reason against the retained input-order variant', async () => {
    const result = await auditFromEvidence(join(NEG, 'oracle-input-order'));
    expect(result.ok).toBe(false);
    // The variant recomputes its own hash, so ordering is the SOLE finding — proving the
    // audit catches the spike-009 defect independent of integrity.
    expect(result.findings.map((f) => f.check)).toEqual(['ordering']);
    expect(result.findings[0]!.reason).toBe(REASON_ORDER_NOT_COMPARE_CODE_UNITS);
  });

  test('and PASSES again once the correct compareCodeUnits-ordered artifact is used (restore)', async () => {
    const result = await auditFromEvidence(EVIDENCE);
    expect(result).toEqual({ ok: true, findings: [] });
  });
});

describe('T021 — observed failing: integrity confirmed but adequacy never reached', () => {
  test('the real audit records FAIL against SC-010, not a silent accept', async () => {
    const result = await auditFromEvidence(join(NEG, 'audit-integrity-only'));
    expect(result.ok).toBe(false);
    // Integrity is intact (hashes match), so the ONLY finding is the missing adequacy
    // determination — the exact failure mode the adequacy requirement exists to prevent.
    expect(result.findings.map((f) => f.check)).toEqual(['adequacy']);
    expect(result.findings[0]!.reason).toBe(REASON_NO_ADEQUACY);
  });

  test('a bare integrity-only audit input (no adequacy field) is rejected in isolation too', () => {
    // Minimal reproduction independent of files: correct hashes, no adequacy finding.
    const frozen: Record<string, unknown> = { derivedPathPatterns: [] };
    frozen.contentHash = canonicalHash(frozen);
    const accept: Record<string, unknown> = {};
    accept.contentHash = canonicalHash(accept);
    const result = auditOracleFreeze({
      frozenExpectationSet: frozen,
      acceptCorpusFreeze: accept,
      // adequacy deliberately omitted
    });
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.check)).toEqual(['adequacy']);
    expect(result.findings[0]!.reason).toBe(REASON_NO_ADEQUACY);
  });

  test('and PASSES again once an explicit adequacy finding is recorded (restore)', async () => {
    const result = await auditFromEvidence(EVIDENCE);
    expect(result).toEqual({ ok: true, findings: [] });
  });
});
