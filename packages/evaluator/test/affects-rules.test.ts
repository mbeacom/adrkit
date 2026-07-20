import { describe, expect, test } from 'bun:test';
import {
  createPackageTargetResolver,
  createPathTargetResolver,
  createTargetResolutionRegistry,
  makeTargetId,
  type Pass0Input,
  type TargetResolverPort,
} from '../src/index.ts';
import { baseInput, corpusOf, evaluateReport, record, ruleResult } from './support.ts';

/**
 * US3 / T030 — affects-resolvable + affects-overlap. Path/package built-ins reuse the
 * core grammar; entity/resource/api/data resolve via caller-registered ports. ADR-0009
 * include+negation, negation-only, and repo-scoping hold against an explicit current
 * target-resolution log. Missing backing is inert; present backing with zero targets is
 * a warn; overlap is accepted-only and once per pair.
 */

/** A trivial in-memory entity resolver over the entities inventory. */
function entityResolver(): TargetResolverPort {
  return {
    type: 'entity',
    resolve(matcher, context) {
      const inventory = context.inventory.entities;
      if (inventory === undefined) return { status: 'inert', ids: [], reason: 'affects-resolvable.backing-absent' };
      const ids = inventory.filter((e) => e.id === matcher.pattern).map((e) => makeTargetId('entity', e.id));
      return { status: 'resolved', ids, reason: ids.length ? 'affects-resolvable.ok' : 'affects-resolvable.zero-targets' };
    },
  };
}

const fullRegistry = createTargetResolutionRegistry([
  createPathTargetResolver(),
  createPackageTargetResolver(),
  entityResolver(),
]);

function withTargets(overrides: Partial<Pass0Input> & { corpus: ReturnType<typeof corpusOf>; proposalPath: string }): Pass0Input {
  return baseInput({ targetRegistry: fullRegistry, ...overrides });
}

describe('affects-resolvable', () => {
  test('a path matcher resolving ≥1 tracked path passes', () => {
    const proposal = record({ id: '0001', affects: [{ type: 'path', pattern: 'src/**/*.ts', negate: false }] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(
      withTargets({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', targets: { trackedPaths: ['src/a/b.ts', 'docs/x.md'] } }),
    );
    expect(ruleResult(report, 'affects-resolvable')).toMatchObject({ status: 'pass', reason: 'affects-resolvable.ok' });
  });

  test('present backing with zero resolved targets is a warn', () => {
    const proposal = record({ id: '0001', affects: [{ type: 'path', pattern: 'nope/**', negate: false }] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(
      withTargets({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', targets: { trackedPaths: ['src/a.ts'] } }),
    );
    const result = ruleResult(report, 'affects-resolvable');
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('warn');
    expect(result.reason).toBe('affects-resolvable.zero-targets');
    expect(report.outcome).toBe('ok'); // a warn never returns
  });

  test('a missing inventory is inert (backing-absent)', () => {
    const proposal = record({ id: '0001', affects: [{ type: 'path', pattern: 'src/**', negate: false }] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(withTargets({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', targets: {} }));
    expect(ruleResult(report, 'affects-resolvable')).toMatchObject({ status: 'inert', reason: 'affects-resolvable.backing-absent' });
  });

  test('a missing resolver port is inert (resolver-absent)', () => {
    const proposal = record({ id: '0001', affects: [{ type: 'resource', pattern: 'azurerm_storage', negate: false }] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(
      withTargets({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', targets: { resources: [{ id: 'azurerm_storage' }] } }),
    );
    expect(ruleResult(report, 'affects-resolvable')).toMatchObject({ status: 'inert', reason: 'affects-resolvable.resolver-absent' });
  });

  test('include + negation subtracts, negation-only resolves empty (warn)', () => {
    const included = record(
      {
        id: '0001',
        affects: [
          { type: 'path', pattern: 'src/**', negate: false },
          { type: 'path', pattern: 'src/secret.ts', negate: true },
        ],
      },
      { path: 'docs/adr/0001.md' },
    );
    const report = evaluateReport(
      withTargets({ corpus: corpusOf([included]), proposalPath: 'docs/adr/0001.md', targets: { trackedPaths: ['src/a.ts', 'src/secret.ts'] } }),
    );
    expect(ruleResult(report, 'affects-resolvable').status).toBe('pass'); // src/a.ts remains

    const negationOnly = record({ id: '0002', affects: [{ type: 'path', pattern: 'src/**', negate: true }] }, { path: 'docs/adr/0002.md' });
    const report2 = evaluateReport(
      withTargets({ corpus: corpusOf([negationOnly]), proposalPath: 'docs/adr/0002.md', targets: { trackedPaths: ['src/a.ts'] } }),
    );
    expect(ruleResult(report2, 'affects-resolvable').reason).toBe('affects-resolvable.zero-targets');
  });

  test('a resolvable matcher does not mask another positive matcher that resolves to zero (per-matcher)', () => {
    const proposal = record(
      {
        id: '0001',
        affects: [
          { type: 'path', pattern: 'src/**', negate: false }, // resolves ['src/a.ts']
          { type: 'path', pattern: 'none/**', negate: false }, // resolves []
        ],
      },
      { path: 'docs/adr/0001.md' },
    );
    const report = evaluateReport(
      withTargets({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', targets: { trackedPaths: ['src/a.ts'] } }),
    );
    const result = ruleResult(report, 'affects-resolvable');
    expect(result.status).toBe('fail'); // the zero-target matcher warns despite the resolvable one
    expect(result.severity).toBe('warn');
    expect(result.reason).toBe('affects-resolvable.zero-targets');
    // the zero-target finding names the offending matcher
    expect(result.findings.some((f) => f.matcherKey === 'path:none/**')).toBe(true);
  });

  test('a same-repo qualifier matches locally; a different-repo qualifier does not', () => {
    const same = record({ id: '0001', affects: [{ type: 'path', pattern: 'src/**', negate: false, repo: 'here' }] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(
      withTargets({ corpus: corpusOf([same]), proposalPath: 'docs/adr/0001.md', resolutionLog: 'here', targets: { trackedPaths: ['src/a.ts'] } }),
    );
    expect(ruleResult(report, 'affects-resolvable').status).toBe('pass');

    const different = record({ id: '0002', affects: [{ type: 'path', pattern: 'src/**', negate: false, repo: 'elsewhere' }] }, { path: 'docs/adr/0002.md' });
    const report2 = evaluateReport(
      withTargets({ corpus: corpusOf([different]), proposalPath: 'docs/adr/0002.md', resolutionLog: 'here', targets: { trackedPaths: ['src/a.ts'] } }),
    );
    // different-repo qualifier contributes no local match ⇒ zero targets ⇒ warn
    expect(ruleResult(report2, 'affects-resolvable').reason).toBe('affects-resolvable.zero-targets');
  });
});

describe('affects-overlap', () => {
  test('no accepted ADRs ⇒ pass no-accepted-corpus', () => {
    const proposal = record({ id: '0001', affects: [{ type: 'path', pattern: 'src/**', negate: false }] }, { path: 'docs/adr/0001.md' });
    const report = evaluateReport(
      withTargets({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0001.md', targets: { trackedPaths: ['src/a.ts'] } }),
    );
    expect(ruleResult(report, 'affects-overlap')).toMatchObject({ status: 'pass', reason: 'affects-overlap.no-accepted-corpus' });
  });

  test('a canonical intersection with an accepted ADR is a warn (once per pair)', () => {
    const proposal = record({ id: '0002', affects: [{ type: 'path', pattern: 'src/pay/**', negate: false }] }, { path: 'docs/adr/0002.md' });
    const accepted = record(
      { id: '0001', status: 'accepted', deciders: ['@a'], affects: [{ type: 'path', pattern: 'src/pay/**', negate: false }] },
      { path: 'docs/adr/0001.md' },
    );
    const report = evaluateReport(
      withTargets({ corpus: corpusOf([proposal, accepted]), proposalPath: 'docs/adr/0002.md', targets: { trackedPaths: ['src/pay/api.ts'] } }),
    );
    const result = ruleResult(report, 'affects-overlap');
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('warn');
    expect(result.reason).toBe('affects-overlap.accepted-intersection');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.relatedAdr).toBe('0001');
  });

  test('accepted ADRs with no intersection ⇒ pass none', () => {
    const proposal = record({ id: '0002', affects: [{ type: 'path', pattern: 'src/pay/**', negate: false }] }, { path: 'docs/adr/0002.md' });
    const accepted = record(
      { id: '0001', status: 'accepted', deciders: ['@a'], affects: [{ type: 'path', pattern: 'src/ui/**', negate: false }] },
      { path: 'docs/adr/0001.md' },
    );
    const report = evaluateReport(
      withTargets({ corpus: corpusOf([proposal, accepted]), proposalPath: 'docs/adr/0002.md', targets: { trackedPaths: ['src/pay/api.ts', 'src/ui/app.ts'] } }),
    );
    expect(ruleResult(report, 'affects-overlap')).toMatchObject({ status: 'pass', reason: 'affects-overlap.none' });
  });

  test('accepted corpus but absent pair backing ⇒ inert', () => {
    const proposal = record({ id: '0002', affects: [{ type: 'path', pattern: 'src/pay/**', negate: false }] }, { path: 'docs/adr/0002.md' });
    const accepted = record(
      { id: '0001', status: 'accepted', deciders: ['@a'], affects: [{ type: 'path', pattern: 'src/pay/**', negate: false }] },
      { path: 'docs/adr/0001.md' },
    );
    const report = evaluateReport(
      withTargets({ corpus: corpusOf([proposal, accepted]), proposalPath: 'docs/adr/0002.md', targets: {} }),
    );
    expect(ruleResult(report, 'affects-overlap')).toMatchObject({ status: 'inert', reason: 'affects-overlap.backing-absent' });
  });
});
