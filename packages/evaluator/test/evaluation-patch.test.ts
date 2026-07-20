import { describe, expect, test } from 'bun:test';
import { ROUTING_TRIGGERS, type EvaluationPatch } from '../src/index.ts';
import { evaluatePass0 } from '../src/index.ts';
import { baseInput, corpusOf, malformedCorpus, record } from './support.ts';
import type { Finding } from '@adrkit/core';

/**
 * US5 / T050 — evaluationPatch projection. Violations only; each finding is EXACTLY
 * `{ rule, severity, message?, adr? }` with `adr` strictly an AdrRef; rubric-id mapping
 * with no duplicate lower-level findings; all report-only evidence is stripped; a path
 * is never projected into `adr`; and escalation reasons are copied in fixed trigger order.
 */

const ALLOWED_KEYS = new Set(['rule', 'severity', 'message', 'adr']);

function patchOf(input: Parameters<typeof evaluatePass0>[0]): EvaluationPatch {
  const outcome = evaluatePass0(input);
  if (outcome.kind !== 'evaluated') throw new Error('expected evaluated');
  return outcome.result.patch;
}

describe('evaluationPatch', () => {
  test('includes only violations, each with exactly the four committed keys', () => {
    const proposal = record(
      { id: '0002', relatesTo: ['9999'], reviewBy: '2026-01-01', reversibility: 'one-way-door' },
      { path: 'docs/adr/0002-a.md' },
    );
    const dup = record({ id: '0002' }, { path: 'docs/adr/0002-b.md' });
    const patch = patchOf(baseInput({ corpus: corpusOf([proposal, dup]), proposalPath: 'docs/adr/0002-a.md', evaluationDate: '2026-07-19' }));

    const rules = patch.deterministicFindings.map((f) => f.rule).sort();
    expect(rules).toEqual(['expiry-sane', 'id-unique', 'no-orphan-refs']);
    for (const finding of patch.deterministicFindings) {
      for (const key of Object.keys(finding)) expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
    // one finding per violating rule — no duplicates
    expect(new Set(rules).size).toBe(rules.length);
  });

  test('adr is projected only as a valid AdrRef (id-unique carries the candidate id)', () => {
    const proposal = record({ id: '0042' }, { path: 'docs/adr/0042-a.md' });
    const dup = record({ id: '0042' }, { path: 'docs/adr/0042-b.md' });
    const patch = patchOf(baseInput({ corpus: corpusOf([proposal, dup]), proposalPath: 'docs/adr/0042-a.md' }));
    const idUnique = patch.deterministicFindings.find((f) => f.rule === 'id-unique');
    expect(idUnique?.adr).toBe('0042');
    expect(idUnique?.adr).not.toContain('/');
  });

  test('a schema-valid violation projects no adr (a path is never reinterpreted as an ADR ref)', () => {
    const proposalPath = 'docs/adr/0042-x.md';
    const findings: Finding[] = [{ rule: 'frontmatter-parse', severity: 'error', message: 'bad', path: proposalPath }];
    const patch = patchOf(baseInput({ corpus: malformedCorpus(proposalPath, findings), proposalPath }));
    expect(patch.deterministicFindings).toEqual([{ rule: 'schema-valid', severity: 'error', message: 'bad' }]);
    expect(patch.deterministicFindings[0]).not.toHaveProperty('adr');
  });

  test('escalation reasons are copied in fixed trigger order', () => {
    // Two triggers: one-way-door (reversibility) + regulatory (complianceControls)
    const proposal = record(
      { id: '0001', reversibility: 'one-way-door', complianceControls: ['SOC2'] },
      { path: 'docs/adr/0001.md' },
    );
    const patch = patchOf(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(patch.escalate).toBe(true);
    // fixed order: one-way-door precedes regulatory in ROUTING_TRIGGERS
    const order = patch.escalationReasons.map((r) => ROUTING_TRIGGERS.indexOf(r as never));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(patch.escalationReasons).toEqual(['one-way-door', 'regulatory']);
  });

  test('a clean proposal yields an empty, non-escalated patch', () => {
    const proposal = record({ id: '0001' }, { path: 'docs/adr/0001.md' });
    const patch = patchOf(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(patch).toEqual({ deterministicFindings: [], escalate: false, escalationReasons: [] });
  });
});
