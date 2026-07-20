import { describe, expect, test } from 'bun:test';
import {
  createAssertionEngineRegistry,
  createJsonPathEngine,
  createPathTargetResolver,
  createTargetResolutionRegistry,
  makeAssertionKey,
  type IdentityDirectorySnapshot,
  type Pass0Input,
} from '../src/index.ts';
import { baseInput, corpusOf, evaluateReport, record, ruleResult } from './support.ts';

/**
 * US3 / T034 — the complete offline pass/fail/inert matrix, mixed fail+inert aggregate
 * precedence, exact reason codes, and current/proposed assertion-input separation.
 */

const identity: IdentityDirectorySnapshot = {
  principals: [{ id: '@alice', active: true, kind: 'human' }],
  teams: [],
};

describe('a fully-backed clean proposal passes every rule', () => {
  test('all eleven rules pass/none with full backing', () => {
    const path = 'docs/adr/0002.md';
    const proposal = record(
      {
        id: '0002',
        deciders: ['@alice'],
        reviewBy: '2027-01-01',
        affects: [{ type: 'path', pattern: 'src/**', negate: false }],
      },
      { path },
    );
    const report = evaluateReport(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: path,
        identity,
        targetRegistry: createTargetResolutionRegistry([createPathTargetResolver()]),
        targets: { trackedPaths: ['src/a.ts'] },
        evaluationDate: '2026-07-19',
      }),
    );
    const expected: Record<string, string> = {
      'schema-valid': 'pass',
      'id-unique': 'pass',
      'supersession-consistent': 'pass',
      'no-orphan-refs': 'pass',
      'affects-resolvable': 'pass',
      'affects-overlap': 'pass',
      'scope-hierarchy': 'pass',
      'assertions-compile': 'pass',
      'assertions-pass': 'pass',
      'decider-resolvable': 'pass',
      'expiry-sane': 'pass',
    };
    for (const result of report.results) {
      expect(result.status).toBe(expected[result.rule] as never);
    }
    expect(report.outcome).toBe('ok');
    expect(report.results.filter((r) => r.status === 'pass')).toHaveLength(11);
  });
});

describe('reason codes across the degraded matrix', () => {
  test('empty backing yields the expected inert/pass reasons', () => {
    const path = 'docs/adr/0002.md';
    const proposal = record({ id: '0002', deciders: ['@alice'], affects: [{ type: 'path', pattern: 'src/**', negate: false }] }, { path });
    // no target registry, no identity, no engines
    const report = evaluateReport(baseInput({ corpus: corpusOf([proposal]), proposalPath: path }));
    expect(ruleResult(report, 'affects-resolvable').reason).toBe('affects-resolvable.resolver-absent');
    expect(ruleResult(report, 'affects-overlap').reason).toBe('affects-overlap.no-accepted-corpus');
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({
      status: 'inert',
      reason: 'scope-hierarchy.evidence-absent',
    });
    expect(ruleResult(report, 'assertions-compile').reason).toBe('assertions-compile.none');
    expect(ruleResult(report, 'decider-resolvable').reason).toBe('decider-resolvable.directory-absent');
    expect(report.outcome).toBe('ok');
  });
});

describe('mixed fail + inert aggregate precedence', () => {
  test('a dangling local ref (fail) plus a federated-absent ref (inert) aggregates to fail, retaining both findings', () => {
    const path = 'docs/adr/0002.md';
    const proposal = record(
      { id: '0002', relatesTo: ['9999', 'payments:0001'] },
      { path },
    );
    const report = evaluateReport(baseInput({ corpus: corpusOf([proposal]), proposalPath: path }));
    const result = ruleResult(report, 'no-orphan-refs');
    expect(result.status).toBe('fail'); // fail > inert
    expect(result.reason).toBe('no-orphan-refs.dangling-relates-to');
    const reasons = result.findings.map((f) => f.reason).sort();
    expect(reasons).toContain('no-orphan-refs.dangling-relates-to');
    expect(reasons).toContain('no-orphan-refs.federated-log-absent');
  });
});

describe('current vs proposed assertion input separation', () => {
  test('assertions-pass reads current input; scope-hierarchy reads a distinct base input', () => {
    const path = 'docs/adr/0002.md';
    const proposal = record(
      { id: '0002', assertions: [{ id: 'a', engine: 'jsonpath', expression: '$.ok', input: 'source', severity: 'error' }] },
      { path },
    );
    const key = makeAssertionKey(undefined, path, 'a');
    const input: Pass0Input = baseInput({
      corpus: corpusOf([proposal]),
      proposalPath: path,
      assertionEngines: createAssertionEngineRegistry({ jsonpath: createJsonPathEngine() }),
      assertionInputs: { sources: {}, inputs: { [key]: { document: { ok: true } } } }, // current/proposed
      scopeEvidence: { baseInputs: { [key]: { document: {} } } }, // base — used only by scope-hierarchy
    });
    const report = evaluateReport(input);
    // assertions-pass uses the CURRENT input (ok:true ⇒ non-empty nodelist ⇒ pass)
    expect(ruleResult(report, 'assertions-pass').status).toBe('pass');
    // scope-hierarchy is not applicable here (no accepted org overlap), unaffected by base input
    expect(ruleResult(report, 'scope-hierarchy').status).toBe('pass');
  });
});
