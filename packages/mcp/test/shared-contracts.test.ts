import { describe, expect, test } from 'bun:test';
import {
  ANNOTATIONS,
  LIMITS,
  cap512,
  plural,
  renderResponseText,
  searchDecisionsInputSchema,
  getDecisionInputSchema,
  getDecisionContextInputSchema,
  listSupersededInputSchema,
  searchDecisionsOutputSchema,
  getDecisionOutputSchema,
  getDecisionContextOutputSchema,
  listSupersededOutputSchema,
} from '../src/tools/shared.ts';

describe('fixed annotations (contracts/tools.md §2)', () => {
  test('every tool declares the same read-only, closed-world annotations', () => {
    expect(ANNOTATIONS).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});

describe('deterministic text renderer (contracts/tools.md §2.1)', () => {
  test('results: singular vs plural for items and findings', () => {
    expect(renderResponseText({ kind: 'results', itemsLength: 2, findings: 1 })).toBe(
      'Returned 2 decision results; 1 finding on this page.',
    );
    expect(renderResponseText({ kind: 'results', itemsLength: 1, findings: 0 })).toBe(
      'Returned 1 decision result; 0 findings on this page.',
    );
  });

  test('found interpolates the decision id', () => {
    expect(renderResponseText({ kind: 'found', id: '0001', findings: 1 })).toBe(
      'Found decision "0001"; 1 finding on this page.',
    );
  });

  test('not-found interpolates the requested ref', () => {
    expect(renderResponseText({ kind: 'not-found', requestedRef: '9999', findings: 0 })).toBe(
      'No local decision matches "9999"; 0 findings on this page.',
    );
  });

  test('ambiguous-local-id', () => {
    expect(renderResponseText({ kind: 'ambiguous-local-id', candidatesLength: 2, requestedRef: '0010', findings: 3 })).toBe(
      'Returned 2 candidates for ambiguous local ref "0010"; 3 findings on this page.',
    );
    expect(renderResponseText({ kind: 'ambiguous-local-id', candidatesLength: 1, requestedRef: '0010', findings: 1 })).toBe(
      'Returned 1 candidate for ambiguous local ref "0010"; 1 finding on this page.',
    );
  });

  test('federated-log-unavailable', () => {
    expect(renderResponseText({ kind: 'federated-log-unavailable', requestedRef: 'payments:0012', findings: 0 })).toBe(
      'Named-log federation is unavailable for "payments:0012"; 0 findings on this page.',
    );
  });

  test('matches with pageMatchCount = governing + activeProposals + history', () => {
    expect(renderResponseText({ kind: 'matches', governing: 1, activeProposals: 2, history: 3, findings: 0 })).toBe(
      'Returned 6 context matches: 1 governing, 2 active proposals, 3 historical; 0 findings on this page.',
    );
    expect(renderResponseText({ kind: 'matches', governing: 1, activeProposals: 1, history: 0, findings: 1 })).toBe(
      'Returned 2 context matches: 1 governing, 1 active proposal, 0 historical; 1 finding on this page.',
    );
  });

  test('entries singular/plural', () => {
    expect(renderResponseText({ kind: 'entries', itemsLength: 1, findings: 0 })).toBe(
      'Returned 1 superseded decision entry; 0 findings on this page.',
    );
    expect(renderResponseText({ kind: 'entries', itemsLength: 3, findings: 2 })).toBe(
      'Returned 3 superseded decision entries; 2 findings on this page.',
    );
  });

  test('fixed invalid-cursor and corpus-unavailable messages', () => {
    expect(renderResponseText({ kind: 'invalid-cursor', reason: 'offset-out-of-range' })).toBe(
      'Cursor offset is outside the current result set.',
    );
    expect(renderResponseText({ kind: 'corpus-unavailable', reason: 'root-not-git' })).toBe(
      'Configured repository root is not a Git worktree.',
    );
  });

  test('every rendered string is capped at 512 UTF-16 code units', () => {
    const longRef = 'x'.repeat(1000);
    expect(renderResponseText({ kind: 'not-found', requestedRef: longRef, findings: 0 }).length).toBeLessThanOrEqual(512);
    expect(cap512('y'.repeat(1000)).length).toBe(512);
    expect(cap512('short')).toBe('short');
  });

  test('plural helper', () => {
    expect(plural(1, 'a', 'b')).toBe('a');
    expect(plural(0, 'a', 'b')).toBe('b');
    expect(plural(2, 'a', 'b')).toBe('b');
  });
});

describe('strict, bounded input schemas (contracts/tools.md §8)', () => {
  test('search_decisions: query bounds, trim-non-empty, filters, strict', () => {
    const schema = searchDecisionsInputSchema();
    expect(schema.safeParse({ query: 'postgres' }).success).toBe(true);
    expect(schema.safeParse({ query: '' }).success).toBe(false);
    expect(schema.safeParse({ query: '   ' }).success).toBe(false);
    expect(schema.safeParse({ query: 'x'.repeat(257) }).success).toBe(false);
    expect(schema.safeParse({ query: 'x', bogus: 1 }).success).toBe(false);
    expect(schema.safeParse({ query: 'x', status: [] }).success).toBe(false);
    expect(schema.safeParse({ query: 'x', status: ['accepted', 'draft'] }).success).toBe(true);
    expect(schema.safeParse({ query: 'x', status: ['bogus'] }).success).toBe(false);
    expect(schema.safeParse({ query: 'x', tags: Array.from({ length: 33 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(schema.safeParse({ query: 'x', tags: ['a'.repeat(65)] }).success).toBe(false);
    expect(schema.safeParse({ query: 'x', limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ query: 'x', limit: 101 }).success).toBe(false);
  });

  test('get_decision: ref bounds and strict', () => {
    const schema = getDecisionInputSchema();
    expect(schema.safeParse({ ref: '0001' }).success).toBe(true);
    expect(schema.safeParse({ ref: 'payments:0012' }).success).toBe(true);
    expect(schema.safeParse({ ref: '' }).success).toBe(false);
    expect(schema.safeParse({ ref: 'x'.repeat(129) }).success).toBe(false);
    expect(schema.safeParse({ ref: 'not a ref!' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ ref: '0001', bogus: 1 }).success).toBe(false);
  });

  test('get_decision_context: files path rules (POSIX only), counts, strict', () => {
    const schema = getDecisionContextInputSchema();
    expect(schema.safeParse({ files: ['docs/adr/0001.md'] }).success).toBe(true);
    expect(schema.safeParse({ files: [] }).success).toBe(false);
    expect(schema.safeParse({ files: ['/abs/x.md'] }).success).toBe(false);
    expect(schema.safeParse({ files: ['../escape.md'] }).success).toBe(false);
    expect(schema.safeParse({ files: ['a/../b.md'] }).success).toBe(false);
    expect(schema.safeParse({ files: ['C:\\win.md'] }).success).toBe(false);
    expect(schema.safeParse({ files: ['docs\\adr\\0001.md'] }).success).toBe(false);
    expect(schema.safeParse({ files: [''] }).success).toBe(false);
    expect(schema.safeParse({ files: ['x'.repeat(1025)] }).success).toBe(false);
    expect(schema.safeParse({ files: Array.from({ length: 257 }, (_, i) => `f${i}.md`) }).success).toBe(false);
  });

  test('list_superseded: pagination only, strict', () => {
    const schema = listSupersededInputSchema();
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ limit: 20, findingsLimit: 20 }).success).toBe(true);
    expect(schema.safeParse({ status: ['accepted'] }).success).toBe(false);
    expect(schema.safeParse({ cursor: 'x'.repeat(LIMITS.cursorBytes + 1) }).success).toBe(false);
  });
});

describe('root-object output schemas with a nested discriminated union', () => {
  for (const [name, builder] of [
    ['search_decisions', searchDecisionsOutputSchema],
    ['get_decision', getDecisionOutputSchema],
    ['get_decision_context', getDecisionContextOutputSchema],
    ['list_superseded', listSupersededOutputSchema],
  ] as const) {
    test(`${name} output raw shape has corpusHealth + result (union nested under result)`, () => {
      const shape = builder();
      expect(Object.keys(shape).sort()).toEqual(['corpusHealth', 'result']);
    });
  }
});
