import { describe, expect, test } from 'bun:test';
import {
  createTargetResolutionRegistry,
  createPathTargetResolver,
  makeTargetId,
  type IdentityDirectorySnapshot,
  type Pass0Input,
  type TargetResolverPort,
} from '../src/index.ts';
import { baseInput, corpusOf, evaluateReport, record } from './support.ts';

/**
 * US4 / T044 — named-human routing target. Source order deciders → CODEOWNERS(resolved
 * paths) → catalog(resolved entities); declaration/canonical ordering; last-matching
 * CODEOWNERS rule per path; stable first-occurrence dedupe; inactive-human skipping;
 * a team resolves to exactly one active human; the first ambiguous/zero team is an
 * immediate `unresolved` barrier; exhausted candidates are `unresolved`.
 */

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

const registry = createTargetResolutionRegistry([createPathTargetResolver(), entityResolver()]);

const principals = [
  { id: '@alice', active: true, kind: 'human' as const },
  { id: '@bob', active: false, kind: 'human' as const },
  { id: '@carol', active: true, kind: 'human' as const },
  { id: '@dave', active: true, kind: 'human' as const },
  { id: '@erin', active: true, kind: 'human' as const },
  { id: 'team:solo', active: true, kind: 'team' as const },
  { id: 'team:many', active: true, kind: 'team' as const },
];
const teams = [
  { id: 'team:solo', members: ['@alice', '@bob'] },
  { id: 'team:many', members: ['@alice', '@carol'] },
];

function scenario(opts: {
  deciders?: string[];
  affects?: { type: 'path' | 'entity'; pattern: string; negate: boolean }[];
  identity: IdentityDirectorySnapshot;
  trackedPaths?: string[];
  entities?: { id: string }[];
}): Pass0Input {
  const proposal = record(
    { id: '0002', reversibility: 'one-way-door', deciders: opts.deciders ?? [], affects: opts.affects ?? [] },
    { path: 'docs/adr/0002.md' },
  );
  return baseInput({
    corpus: corpusOf([proposal]),
    proposalPath: 'docs/adr/0002.md',
    identity: opts.identity,
    targetRegistry: registry,
    targets: { ...(opts.trackedPaths ? { trackedPaths: opts.trackedPaths } : {}), ...(opts.entities ? { entities: opts.entities } : {}) },
  });
}

describe('routing target resolution (escalation forced by one-way-door)', () => {
  test('a decider resolves first, in declaration order', () => {
    const report = evaluateReport(scenario({ deciders: ['@alice'], identity: { principals, teams } }));
    expect(report.routing.escalate).toBe(true);
    expect(report.routing.target).toEqual({ kind: 'resolved', human: '@alice', via: 'deciders', code: 'route.target.deciders' });
  });

  test('an inactive direct human is skipped, falling to CODEOWNERS for resolved paths', () => {
    const identity: IdentityDirectorySnapshot = { principals, teams, codeowners: [{ pattern: 'src/**', owners: ['@carol'] }] };
    const report = evaluateReport(
      scenario({ deciders: ['@bob'], affects: [{ type: 'path', pattern: 'src/**', negate: false }], identity, trackedPaths: ['src/a.ts'] }),
    );
    expect(report.routing.target).toMatchObject({ kind: 'resolved', human: '@carol', via: 'codeowners' });
  });

  test('the last matching CODEOWNERS rule wins and owner declaration order is preserved', () => {
    const identity: IdentityDirectorySnapshot = {
      principals,
      teams,
      // @carol inactive here so we observe the second (last-matching) rule + owner order
      codeowners: [
        { pattern: 'src/**', owners: ['@erin'] },
        { pattern: 'src/a.ts', owners: ['@bob', '@dave'] }, // @bob inactive → skip → @dave
      ],
    };
    const report = evaluateReport(
      scenario({ affects: [{ type: 'path', pattern: 'src/**', negate: false }], identity, trackedPaths: ['src/a.ts'] }),
    );
    // last matching rule is 'src/a.ts'; its owners are [@bob(skip), @dave]
    expect(report.routing.target).toMatchObject({ kind: 'resolved', human: '@dave', via: 'codeowners' });
  });

  test('catalog owners resolve for resolved entities', () => {
    const identity: IdentityDirectorySnapshot = { principals, teams, catalogOwners: { 'svc:pay': ['@erin'] } };
    const report = evaluateReport(
      scenario({ affects: [{ type: 'entity', pattern: 'svc:pay', negate: false }], identity, entities: [{ id: 'svc:pay' }] }),
    );
    expect(report.routing.target).toMatchObject({ kind: 'resolved', human: '@erin', via: 'catalog' });
  });

  test('prototype-colliding entity ids without catalog owners resolve as unresolved', () => {
    const report = evaluateReport(
      scenario({
        affects: [{ type: 'entity', pattern: 'hasOwnProperty', negate: false }],
        identity: { principals, teams },
        entities: [{ id: 'hasOwnProperty' }],
      }),
    );
    expect(report.routing.target).toEqual({ kind: 'unresolved', code: 'route.target.unresolved' });
  });

  test('a team resolves only to exactly one active human', () => {
    const report = evaluateReport(scenario({ deciders: ['team:solo'], identity: { principals, teams } }));
    expect(report.routing.target).toMatchObject({ kind: 'resolved', human: '@alice', via: 'deciders' });
  });

  test('the first ambiguous team is an immediate unresolved barrier (no later fallback)', () => {
    // team:many has two active humans; even though @alice would resolve later, the barrier wins
    const report = evaluateReport(scenario({ deciders: ['team:many', '@alice'], identity: { principals, teams } }));
    expect(report.routing.target).toEqual({ kind: 'unresolved', code: 'route.target.unresolved' });
  });

  test('exhausting all candidates yields unresolved', () => {
    const report = evaluateReport(scenario({ deciders: ['@bob'], identity: { principals, teams } }));
    expect(report.routing.target).toEqual({ kind: 'unresolved', code: 'route.target.unresolved' });
  });

  test('escalation + unresolved routing does not change the (clean) exit outcome', () => {
    const report = evaluateReport(scenario({ deciders: ['@bob'], identity: { principals, teams } }));
    expect(report.routing.escalate).toBe(true);
    expect(report.outcome).toBe('ok'); // warn/info/inert-only ⇒ ok even when escalated/unresolved
  });
});
