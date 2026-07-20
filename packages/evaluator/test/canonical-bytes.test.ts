import { describe, expect, test } from 'bun:test';
import { RULE_IDS, ROUTING_TRIGGERS, canonicalize, serializeArtifacts } from '../src/index.ts';
import { baseInput, corpusOf, evaluateReport, record } from './support.ts';
import { evaluatePass0 } from '../src/index.ts';

/**
 * US2 / T025 — canonical, byte-reproducible serialization. The same inputs (even with
 * reordered input collections) produce identical `report` + `patch` bytes: object keys
 * are sorted, set-like finding arrays are ordered by their comparator, fixed rubric /
 * trigger arrays preserve order, newlines are LF, and no timestamp/run-id/duration
 * appears inside the deterministic payload.
 */

function scenario(order: 'ab' | 'ba') {
  const proposal = record({ id: '0002', relatesTo: ['9999', '7777'] }, { path: 'docs/adr/0002-a.md' });
  const other = record({ id: '0002' }, { path: 'docs/adr/0002-dup.md' }); // duplicate id collision
  const records = order === 'ab' ? [proposal, other] : [other, proposal];
  return baseInput({ corpus: corpusOf(records), proposalPath: 'docs/adr/0002-a.md' });
}

describe('canonical bytes', () => {
  test('identical inputs in different collection order produce identical bytes', () => {
    const a = evaluatePass0(scenario('ab'));
    const b = evaluatePass0(scenario('ba'));
    expect(a.kind).toBe('evaluated');
    expect(b.kind).toBe('evaluated');
    if (a.kind !== 'evaluated' || b.kind !== 'evaluated') return;
    const bytesA = serializeArtifacts(a.result.report, a.result.patch);
    const bytesB = serializeArtifacts(b.result.report, b.result.patch);
    expect(bytesA.report).toBe(bytesB.report);
    expect(bytesA.patch).toBe(bytesB.patch);
  });

  test('object keys are sorted and newlines are LF', () => {
    const report = evaluateReport(scenario('ab'));
    const outcome = evaluatePass0(scenario('ab'));
    if (outcome.kind !== 'evaluated') throw new Error('expected evaluated');
    const bytes = serializeArtifacts(report, outcome.result.patch).report;
    expect(bytes.endsWith('\n')).toBe(true);
    expect(bytes.includes('\r')).toBe(false);
    // top-level keys appear in sorted order
    const order = ['outcome', 'proposalPath', 'results', 'routing', 'rubricVersion'].map((k) => bytes.indexOf(`"${k}"`));
    const sorted = [...order].sort((x, y) => x - y);
    expect(order).toEqual(sorted);
  });

  test('the deterministic payload carries no run metadata', () => {
    const report = evaluateReport(scenario('ab'));
    const outcome = evaluatePass0(scenario('ab'));
    if (outcome.kind !== 'evaluated') throw new Error('expected evaluated');
    const bytes = serializeArtifacts(report, outcome.result.patch).report;
    for (const banned of ['ranAt', 'runId', 'timestamp', 'duration', 'evaluatorVersion']) {
      expect(bytes.includes(`"${banned}"`)).toBe(false);
    }
  });

  test('fixed rubric and trigger order is preserved', () => {
    const report = evaluateReport(scenario('ab'));
    expect(report.results.map((r) => r.rule)).toEqual([...RULE_IDS]);
    expect(report.routing.evidenceStatus.map((e) => e.reason)).toEqual([...ROUTING_TRIGGERS]);
  });

  test('rubricVersion is content inside the payload', () => {
    const report = evaluateReport(scenario('ab'));
    const outcome = evaluatePass0(scenario('ab'));
    if (outcome.kind !== 'evaluated') throw new Error('expected evaluated');
    const bytes = serializeArtifacts(report, outcome.result.patch).report;
    expect(bytes.includes('"rubricVersion"')).toBe(true);
  });

  test('object keys sort by code unit, not locale (uppercase before lowercase)', () => {
    // Under a locale collator "a" often sorts before "Z"; the deterministic contract
    // requires code-unit order where "Z" (0x5A) precedes "a" (0x61).
    const canonical = canonicalize({ a: 1, Z: 2, '0': 3 }) as Record<string, number>;
    expect(Object.keys(canonical)).toEqual(['0', 'Z', 'a']);
  });
});
