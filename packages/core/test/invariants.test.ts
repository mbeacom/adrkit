import { describe, expect, test } from 'bun:test';
import { validateAdrFrontmatter } from '../src/validate/contract.ts';

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '0.1.0',
    id: '0001',
    title: 'Use a valid test record',
    status: 'draft',
    date: '2026-07-18',
    deciders: [],
    tags: [],
    scope: 'component',
    reversibility: 'unknown',
    blastRadius: 'component',
    affects: [],
    provenance: { authoredBy: 'human' },
    ...overrides,
  };
}

function rulesFor(data: Record<string, unknown>): string[] {
  return validateAdrFrontmatter(data, 'record.md').findings.map((finding) => finding.rule);
}

describe('intra-record contract invariants', () => {
  test('status superseded requires supersededBy', () => {
    expect(rulesFor(base({ status: 'superseded', supersededBy: '0002' }))).toEqual([]);
    expect(rulesFor(base({ status: 'superseded' }))).toContain('superseded-requires-supersededBy');
  });

  test('supersededBy requires status superseded', () => {
    expect(rulesFor(base({ status: 'superseded', supersededBy: '0002' }))).toEqual([]);
    expect(rulesFor(base({ supersededBy: '0002' }))).toContain(
      'supersededBy-requires-superseded-status',
    );
  });

  test('accepted records need a decider unless imported', () => {
    expect(rulesFor(base({ status: 'accepted', deciders: ['@mbeacom'] }))).toEqual([]);
    expect(
      rulesFor(
        base({
          status: 'accepted',
          provenance: {
            authoredBy: 'human',
            importedFrom: { sourceKind: 'madr', sourceRef: 'legacy.md', fingerprint: 'sha256:abc' },
          },
        }),
      ),
    ).toEqual([]);
    expect(rulesFor(base({ status: 'accepted' }))).toContain(
      'accepted-requires-decider-unless-imported',
    );
  });

  test('agent-authored accepted records need a human ratifier', () => {
    expect(
      rulesFor(
        base({
          status: 'accepted',
          deciders: ['@mbeacom'],
          provenance: { authoredBy: 'agent', ratifiedBy: '@mbeacom' },
        }),
      ),
    ).toEqual([]);
    expect(
      rulesFor(
        base({
          status: 'accepted',
          deciders: ['@mbeacom'],
          provenance: { authoredBy: 'agent' },
        }),
      ),
    ).toContain('agent-accepted-requires-ratifier');
  });

  test('one-way-door decisions may not take the auto tier', () => {
    expect(
      rulesFor(base({ reversibility: 'one-way-door', review: { tier: 'arb' } })),
    ).toEqual([]);
    expect(
      rulesFor(base({ reversibility: 'one-way-door', review: { tier: 'auto' } })),
    ).toContain('one-way-door-disallows-auto');
  });

  test('unknown keys are rejected by the strict contract', () => {
    expect(rulesFor(base())).toEqual([]);
    expect(rulesFor(base({ unexpectedField: true }))).toContain('strict-unknown-key');
  });
});
