import { describe, expect, test } from 'bun:test';
import {
  ROUTING_TRIGGERS,
  createAssertionEngineRegistry,
  createJsonPathEngine,
  createPathTargetResolver,
  createTargetResolutionRegistry,
  makeAssertionKey,
  type Pass0Input,
} from '../src/index.ts';
import { baseInput, corpusOf, evaluateReport, record } from './support.ts';

/**
 * US4 / T043 — routing triggers. Exactly eight ordered evidence statuses; each trigger
 * proven on its evidence; missing evidence not-proven; later-pass-only reasons absent;
 * a non-escalated run is `route.target.not-required`; and `contradicts-accepted-adr`
 * fires on overlap + accepted-assertion failure against proposed input WITHOUT the
 * org/domain/base-green requirements of scope-hierarchy.
 */

const pathRegistry = createTargetResolutionRegistry([createPathTargetResolver()]);

function routing(input: Pass0Input) {
  return evaluateReport(input).routing;
}

describe('routing evidence shape', () => {
  test('always emits exactly eight trigger statuses in fixed order', () => {
    const proposal = record({ id: '0001' }, { path: 'docs/adr/0001.md' });
    const decision = routing(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(decision.evidenceStatus.map((e) => e.reason)).toEqual([...ROUTING_TRIGGERS]);
  });

  test('no evidence ⇒ nothing proven ⇒ not-required', () => {
    const proposal = record({ id: '0001' }, { path: 'docs/adr/0001.md' });
    const decision = routing(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(decision.escalate).toBe(false);
    expect(decision.reasons).toEqual([]);
    for (const status of decision.evidenceStatus) expect(status.status).toBe('not-proven');
    expect(decision.target).toEqual({ kind: 'not-required', code: 'route.target.not-required' });
    for (const banned of ['low-confidence', 'pass-disagreement', 'novel-no-precedent']) {
      expect(decision.reasons as readonly string[]).not.toContain(banned);
    }
  });
});

describe('each trigger is proven on its evidence', () => {
  test('one-way-door from proposal reversibility', () => {
    const proposal = record({ id: '0001', reversibility: 'one-way-door' }, { path: 'docs/adr/0001.md' });
    const decision = routing(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(decision.escalate).toBe(true);
    expect(decision.reasons).toContain('one-way-door');
  });

  test('cost-threshold from normalized cost evidence', () => {
    const proposal = record({ id: '0001' }, { path: 'docs/adr/0001.md' });
    const decision = routing(
      baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', routingEvidence: { costEvidence: { normalizedCost: 10, threshold: 5 } } }),
    );
    expect(decision.reasons).toContain('cost-threshold');
  });

  test('security-surface from a resolved target in the security set', () => {
    const proposal = record({ id: '0001', affects: [{ type: 'path', pattern: 'src/**', negate: false }] }, { path: 'docs/adr/0001.md' });
    const decision = routing(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: 'docs/adr/0001.md',
        targetRegistry: pathRegistry,
        targets: { trackedPaths: ['src/a.ts'] },
        routingEvidence: { securitySurfaceTargets: new Set(['path:src/a.ts']) },
      }),
    );
    expect(decision.reasons).toContain('security-surface');
  });

  test('data-residency from positive evidence', () => {
    const proposal = record({ id: '0001' }, { path: 'docs/adr/0001.md' });
    const decision = routing(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', routingEvidence: { dataResidency: { present: true } } }));
    expect(decision.reasons).toContain('data-residency');
  });

  test('regulatory from non-empty complianceControls', () => {
    const proposal = record({ id: '0001', complianceControls: ['SOC2 CC8.1'] }, { path: 'docs/adr/0001.md' });
    const decision = routing(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md' }));
    expect(decision.reasons).toContain('regulatory');
  });

  test('agent-authored-production from provenance + a production target', () => {
    const proposal = record(
      { id: '0001', provenance: { authoredBy: 'agent' }, affects: [{ type: 'path', pattern: 'src/**', negate: false }] },
      { path: 'docs/adr/0001.md' },
    );
    const decision = routing(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: 'docs/adr/0001.md',
        targetRegistry: pathRegistry,
        targets: { trackedPaths: ['src/a.ts'] },
        routingEvidence: { productionTargets: new Set(['path:src/a.ts']) },
      }),
    );
    expect(decision.reasons).toContain('agent-authored-production');
  });

  test('human-requested from an explicit requester', () => {
    const proposal = record({ id: '0001' }, { path: 'docs/adr/0001.md' });
    const decision = routing(baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', routingEvidence: { humanRequested: { requester: '@alice' } } }));
    expect(decision.reasons).toContain('human-requested');
  });
});

describe('contradicts-accepted-adr is distinct from scope-hierarchy', () => {
  test('fires on overlap + accepted-assertion failure without org/domain/base requirements', () => {
    const proposalPath = 'docs/adr/0002.md';
    const acceptedPath = 'docs/adr/0001.md';
    const proposal = record({ id: '0002', affects: [{ type: 'path', pattern: 'src/pay/**', negate: false }] }, { path: proposalPath });
    // accepted ADR is a COMPONENT (not org), no domain, no base input — only proposed failure
    const accepted = record(
      {
        id: '0001',
        status: 'accepted',
        deciders: ['@a'],
        scope: 'component',
        affects: [{ type: 'path', pattern: 'src/pay/**', negate: false }],
        assertions: [{ id: 'guard', engine: 'jsonpath', expression: '$.ok', input: 'source', severity: 'error' }],
      },
      { path: acceptedPath },
    );
    const key = makeAssertionKey(undefined, acceptedPath, 'guard');
    const report = evaluateReport(
      baseInput({
        corpus: corpusOf([proposal, accepted]),
        proposalPath,
        targetRegistry: pathRegistry,
        targets: { trackedPaths: ['src/pay/api.ts'] },
        assertionEngines: createAssertionEngineRegistry({ jsonpath: createJsonPathEngine() }),
        assertionInputs: { sources: {}, inputs: { [key]: { document: { other: 1 } } } }, // $.ok ⇒ empty ⇒ fail
      }),
    );
    expect(report.routing.reasons).toContain('contradicts-accepted-adr');
    // scope-hierarchy does NOT fire (accepted is not org, no base-green transition)
    expect(report.results.find((r) => r.rule === 'scope-hierarchy')?.status).toBe('pass');
  });
});
