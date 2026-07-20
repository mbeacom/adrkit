import { describe, expect, test } from 'bun:test';
import { DeterministicFinding, Evaluation } from '@adrkit/core';
import { evaluatePass0 } from '../src/index.ts';
import { baseInput, corpusOf, malformedCorpus, record } from './support.ts';
import type { Finding } from '@adrkit/core';

/**
 * US5 / T051 — the returned patch validates against the CURRENT committed schema with
 * no Zod or JSON Schema edit. Every projected finding validates as a
 * `DeterministicFinding` and the whole patch validates as an `Evaluation` subset.
 */

function patchOf(input: Parameters<typeof evaluatePass0>[0]) {
  const outcome = evaluatePass0(input);
  if (outcome.kind !== 'evaluated') throw new Error('expected evaluated');
  return outcome.result.patch;
}

describe('evaluationPatch validates against the committed schema', () => {
  test('a violations-only patch validates as an Evaluation', () => {
    const proposal = record({ id: '0002', relatesTo: ['9999'], reversibility: 'one-way-door' }, { path: 'docs/adr/0002-a.md' });
    const dup = record({ id: '0002' }, { path: 'docs/adr/0002-b.md' });
    const patch = patchOf(baseInput({ corpus: corpusOf([proposal, dup]), proposalPath: 'docs/adr/0002-a.md' }));

    const parsed = Evaluation.safeParse(patch);
    expect(parsed.success).toBe(true);
    for (const finding of patch.deterministicFindings) {
      expect(DeterministicFinding.safeParse(finding).success).toBe(true);
    }
  });

  test('a schema-invalid patch validates as an Evaluation', () => {
    const proposalPath = 'docs/adr/0042-x.md';
    const findings: Finding[] = [{ rule: 'invalid-enum-value', severity: 'error', message: 'bad', path: proposalPath, field: 'status' }];
    const patch = patchOf(baseInput({ corpus: malformedCorpus(proposalPath, findings), proposalPath }));
    expect(Evaluation.safeParse(patch).success).toBe(true);
  });

  test('the escalationReasons only use existing EscalationReason enum values', () => {
    const proposal = record({ id: '0001', reversibility: 'one-way-door' }, { path: 'docs/adr/0001.md' });
    const patch = patchOf(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    // Evaluation.escalationReasons is z.array(EscalationReason); a successful parse proves membership
    expect(Evaluation.safeParse({ escalationReasons: patch.escalationReasons }).success).toBe(true);
  });
});
