import { describe, expect, test } from 'bun:test';
import {
  createAssertionEngineRegistry,
  createJsonPathEngine,
  createPathTargetResolver,
  createTargetResolutionRegistry,
  makeAssertionKey,
  type Assertion,
  type JsonValue,
  type Pass0Input,
} from '../src/index.ts';
import { baseInput, corpusOf, evaluateReport, record, ruleResult } from './support.ts';

/**
 * US3 / T031 — scope-hierarchy (error). A component proposal overlapping an applicable
 * accepted org ADR whose assertion goes green→red across the supplied base/proposed
 * inputs is a contradiction. Domain applicability is explicit; missing evidence is inert;
 * precomputed verdicts are not accepted (only a real green→red transition fires).
 */

const engines = createAssertionEngineRegistry({ jsonpath: createJsonPathEngine() });
const targetRegistry = createTargetResolutionRegistry([createPathTargetResolver()]);
const ORG_ASSERTION = { id: 'tls', engine: 'jsonpath' as const, expression: '$.tls', input: 'source' as const, severity: 'error' as const };

function orgKey(orgPath: string): string {
  return makeAssertionKey(undefined, orgPath, 'tls');
}

function scenario(opts: {
  proposalScope?: 'component' | 'domain' | 'org';
  proposalDomain?: string;
  orgDomain?: string;
  base?: JsonValue;
  proposed?: JsonValue;
  withEngine?: boolean;
  withTargets?: boolean;
  overlap?: boolean;
  orgAssertion?: Assertion;
  sourceContent?: string;
}): Pass0Input {
  const proposalPath = 'docs/adr/0002.md';
  const orgPath = 'docs/adr/0001.md';
  const proposal = record(
    {
      id: '0002',
      scope: opts.proposalScope ?? 'component',
      ...(opts.proposalDomain ? { domain: opts.proposalDomain } : {}),
      affects: [{ type: 'path', pattern: 'src/pay/**', negate: false }],
    },
    { path: proposalPath },
  );
  const org = record(
    {
      id: '0001',
      status: 'accepted',
      deciders: ['@a'],
      scope: 'org',
      ...(opts.orgDomain ? { domain: opts.orgDomain } : {}),
      affects: [{ type: 'path', pattern: opts.overlap === false ? 'src/other/**' : 'src/pay/**', negate: false }],
      assertions: [opts.orgAssertion ?? ORG_ASSERTION],
    },
    { path: orgPath },
  );
  const key = orgKey(orgPath);
  return baseInput({
    corpus: corpusOf([proposal, org]),
    proposalPath,
    targetRegistry,
    targets: opts.withTargets === false ? {} : { trackedPaths: ['src/pay/api.ts', 'src/other/x.ts'] },
    ...(opts.withEngine === false ? {} : { assertionEngines: engines }),
    assertionInputs: {
      sources: opts.sourceContent !== undefined ? { [key]: { fileContent: opts.sourceContent } } : {},
      inputs: opts.proposed !== undefined ? { [key]: { document: opts.proposed } } : {},
    },
    ...(opts.base !== undefined ? { scopeEvidence: { baseInputs: { [key]: { document: opts.base } } } } : {}),
  });
}

describe('scope-hierarchy', () => {
  test('base-green → proposed-red on an overlapping accepted org assertion is a contradiction', () => {
    const report = evaluateReport(scenario({ base: { tls: true }, proposed: { other: 1 } }));
    const result = ruleResult(report, 'scope-hierarchy');
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('error');
    expect(result.reason).toBe('scope-hierarchy.contradicts-org-assertion');
    expect(result.evidence?.assertionTransitions).toEqual(['0001:tls']);
    expect(report.outcome).toBe('returned');
  });

  test('a non-component proposal is not applicable', () => {
    const report = evaluateReport(scenario({ proposalScope: 'domain', base: { tls: true }, proposed: {} }));
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({ status: 'pass', reason: 'scope-hierarchy.not-applicable-scope' });
  });

  test('an org ADR with no domain is global (applies to any proposal domain)', () => {
    const report = evaluateReport(scenario({ proposalDomain: 'anything', base: { tls: true }, proposed: {} }));
    expect(ruleResult(report, 'scope-hierarchy').reason).toBe('scope-hierarchy.contradicts-org-assertion');
  });

  test('a domain-scoped org ADR applies only on exact domain equality', () => {
    const report = evaluateReport(scenario({ proposalDomain: 'ui', orgDomain: 'payments', base: { tls: true }, proposed: {} }));
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({ status: 'pass', reason: 'scope-hierarchy.ok' });
  });

  test('base-green → proposed-green is not a contradiction (transition, not verdict)', () => {
    const report = evaluateReport(scenario({ base: { tls: true }, proposed: { tls: true } }));
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({ status: 'pass', reason: 'scope-hierarchy.ok' });
  });

  test('base-red → proposed-red is not a contradiction (base was not green)', () => {
    const report = evaluateReport(scenario({ base: {}, proposed: {} }));
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({ status: 'pass', reason: 'scope-hierarchy.ok' });
  });

  test('a missing engine is inert (engine-absent)', () => {
    const report = evaluateReport(scenario({ withEngine: false, base: { tls: true }, proposed: {} }));
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({ status: 'inert', reason: 'scope-hierarchy.engine-absent' });
  });

  test('a missing base input is inert (base-input-absent)', () => {
    const report = evaluateReport(scenario({ proposed: {} }));
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({ status: 'inert', reason: 'scope-hierarchy.base-input-absent' });
  });

  test('a missing proposed input is inert (proposed-input-absent)', () => {
    const report = evaluateReport(scenario({ base: { tls: true } }));
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({ status: 'inert', reason: 'scope-hierarchy.proposed-input-absent' });
  });

  test('missing target backing is inert instead of proving no applicable org overlap', () => {
    const report = evaluateReport(scenario({ withTargets: false, base: { tls: true }, proposed: {} }));
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({
      status: 'inert',
      reason: 'scope-hierarchy.evidence-absent',
    });
  });

  test('an accepted assertion declaring both sources cannot fabricate contradiction or escalation', () => {
    const report = evaluateReport(
      scenario({
        base: { tls: true },
        proposed: {},
        sourceContent: '$.tls',
        orgAssertion: { ...ORG_ASSERTION, expressionFile: 'tls.jsonpath' },
      }),
    );
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({
      status: 'inert',
      reason: 'scope-hierarchy.source-absent',
    });
    expect(report.routing.reasons).not.toContain('contradicts-accepted-adr');
  });

  test('an accepted assertion declaring neither source ignores arbitrary snapshot content', () => {
    const { expression: _expression, ...withoutExpression } = ORG_ASSERTION;
    const report = evaluateReport(
      scenario({
        base: { tls: true },
        proposed: {},
        sourceContent: '$.tls',
        orgAssertion: withoutExpression,
      }),
    );
    expect(ruleResult(report, 'scope-hierarchy')).toMatchObject({
      status: 'inert',
      reason: 'scope-hierarchy.source-absent',
    });
    expect(report.routing.reasons).not.toContain('contradicts-accepted-adr');
  });
});
