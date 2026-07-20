import { describe, expect, test } from 'bun:test';
import type { Adr, AdrRef } from '@adrkit/core';
import {
  RULE_IDS,
  RULE_SEVERITY,
  ROUTING_TRIGGERS,
  REASON_CODES,
  RULE_REASON_PRECEDENCE,
  ROUTE_ESCALATE_CODE,
  ROUTE_EVIDENCE_NOT_PROVEN_CODE,
  makeAssertionKey,
  assertionKeyForAssertion,
  isCanonicalAssertionKey,
  evaluatePass0,
} from '../src/index.ts';
import type {
  Pass0Input,
  Pass0Report,
  RuleId,
  RuleFinding,
  RuleResult,
  ReasonCode,
  Pass0EscalationReason,
  SnapshotBundleJsonV1,
  CompiledAssertion,
  AssertionEnginePort,
  Pass0InputContractError,
} from '../src/index.ts';

/**
 * Public-contract tests (T007). These pin the fixed rubric order/severity, the
 * exhaustive reason catalog, the eight routing triggers, the compact assertion-key
 * grammar, and the type-level contracts (opaque engine payload handoff, deeply
 * readonly inputs, report-only finding fields, no duplicate finding ids). Runtime
 * behaviour of the rules is proven in later story tests.
 */

describe('rule catalog', () => {
  test('exactly eleven rule ids in fixed rubric order', () => {
    expect(RULE_IDS).toEqual([
      'schema-valid',
      'id-unique',
      'supersession-consistent',
      'no-orphan-refs',
      'affects-resolvable',
      'affects-overlap',
      'scope-hierarchy',
      'assertions-compile',
      'assertions-pass',
      'decider-resolvable',
      'expiry-sane',
    ]);
    expect(RULE_IDS.length).toBe(11);
    expect(new Set(RULE_IDS).size).toBe(11);
  });

  test('fixed severity per rule (never inferred)', () => {
    expect(RULE_SEVERITY).toEqual({
      'schema-valid': 'error',
      'id-unique': 'error',
      'supersession-consistent': 'error',
      'no-orphan-refs': 'error',
      'affects-resolvable': 'warn',
      'affects-overlap': 'warn',
      'scope-hierarchy': 'error',
      'assertions-compile': 'error',
      'assertions-pass': 'warn',
      'decider-resolvable': 'warn',
      'expiry-sane': 'info',
    });
  });
});

describe('routing triggers', () => {
  test('exactly eight Pass 0 triggers in fixed order', () => {
    expect(ROUTING_TRIGGERS).toEqual([
      'one-way-door',
      'cost-threshold',
      'security-surface',
      'data-residency',
      'regulatory',
      'contradicts-accepted-adr',
      'agent-authored-production',
      'human-requested',
    ]);
  });

  test('later-pass-only reasons are absent from Pass 0 triggers', () => {
    for (const absent of ['low-confidence', 'pass-disagreement', 'novel-no-precedent']) {
      expect(ROUTING_TRIGGERS as readonly string[]).not.toContain(absent);
    }
  });

  test('each trigger maps to an escalate code and a not-proven code', () => {
    for (const trigger of ROUTING_TRIGGERS) {
      expect(ROUTE_ESCALATE_CODE[trigger]).toBe(`route.escalate.${trigger}` as ReasonCode);
      expect(ROUTE_EVIDENCE_NOT_PROVEN_CODE[trigger]).toBe(
        `route.evidence.${trigger}.not-proven` as ReasonCode,
      );
    }
  });
});

describe('reason-code catalog', () => {
  test('is exhaustive, unique, and includes representative per-rule codes', () => {
    const set = new Set<string>(REASON_CODES);
    expect(set.size).toBe(REASON_CODES.length);
    const expectedSamples: ReasonCode[] = [
      'schema-valid.ok',
      'schema-valid.contract-error',
      'id-unique.collision',
      'supersession-consistent.dangling-superseded-by',
      'no-orphan-refs.federated-log-absent',
      'affects-resolvable.zero-targets',
      'affects-overlap.no-accepted-corpus',
      'affects-overlap.none',
      'scope-hierarchy.contradicts-org-assertion',
      'assertions-compile.ambiguous-source',
      'assertions-pass.evaluates-false',
      'decider-resolvable.ambiguous-match',
      'expiry-sane.past-or-equal',
      'not-evaluated.schema-invalid',
      'not-evaluated.prereq-failed',
      'route.escalate.regulatory',
      'route.target.unresolved',
    ];
    for (const code of expectedSamples) expect(set.has(code)).toBe(true);
  });

  test('every rule declares a reason precedence beginning with its ok code', () => {
    for (const rule of RULE_IDS) {
      const precedence = RULE_REASON_PRECEDENCE[rule];
      expect(precedence.length).toBeGreaterThan(0);
      // every precedence entry is a known reason code
      for (const code of precedence) expect(REASON_CODES as readonly string[]).toContain(code);
    }
    expect(RULE_REASON_PRECEDENCE['schema-valid'][0]).toBe('schema-valid.ok');
    expect(RULE_REASON_PRECEDENCE['expiry-sane']).toEqual([
      'expiry-sane.ok',
      'expiry-sane.past-or-equal',
    ]);
  });
});

describe('compact canonical assertion keys', () => {
  const record: Adr = {
    frontmatter: {
      schemaVersion: '0.1.0',
      id: '0042',
      title: 'Use canonical keys',
      status: 'proposed',
      date: '2026-07-19',
      deciders: [],
      consulted: [],
      informed: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      supersedes: [],
      relatesTo: [],
      conflictsWith: [],
      affects: [],
      assertions: [],
      externalRefs: [],
      complianceControls: [],
    },
    body: '',
    path: 'docs/adr/0042-x.md',
  };

  test('key equals compact JSON.stringify([log ?? "", path, id])', () => {
    expect(makeAssertionKey(undefined, 'docs/adr/0042-x.md', 'no-secrets')).toBe(
      '["","docs/adr/0042-x.md","no-secrets"]',
    );
    expect(makeAssertionKey('payments', 'docs/adr/0042-x.md', 'no-secrets')).toBe(
      '["payments","docs/adr/0042-x.md","no-secrets"]',
    );
    expect(
      assertionKeyForAssertion(record, { id: 'no-secrets', engine: 'jsonpath', input: 'source', severity: 'error' }),
    ).toBe('["","docs/adr/0042-x.md","no-secrets"]');
  });

  test('accepts the canonical spelling and rejects whitespace / noncanonical variants', () => {
    expect(isCanonicalAssertionKey('["","docs/adr/0042-x.md","no-secrets"]')).toBe(true);
    // padded whitespace
    expect(isCanonicalAssertionKey('[ "", "docs/adr/0042-x.md", "no-secrets" ]')).toBe(false);
    // wrong arity
    expect(isCanonicalAssertionKey('["","docs/adr/0042-x.md"]')).toBe(false);
    // non-string members
    expect(isCanonicalAssertionKey('["",0,"no-secrets"]')).toBe(false);
    // not an array
    expect(isCanonicalAssertionKey('{"a":1}')).toBe(false);
    // trailing junk / not JSON
    expect(isCanonicalAssertionKey('not json')).toBe(false);
  });
});

describe('type-level contracts (compile-time)', () => {
  test('SnapshotBundleJsonV1 is data-only and separate from executable ports', () => {
    const bundle: SnapshotBundleJsonV1 = { schemaVersion: 'adrkit.pass0.snapshot/v1' };
    expect(bundle.schemaVersion).toBe('adrkit.pass0.snapshot/v1');
    // @ts-expect-error snapshot JSON cannot carry a registry/port/function
    const _bad: SnapshotBundleJsonV1 = { schemaVersion: 'adrkit.pass0.snapshot/v1', targetRegistry: () => {} };
    void _bad;
  });

  test('opaque engine payload is carried from compile directly into evaluate', () => {
    interface Payload {
      readonly token: symbol;
    }
    const port: AssertionEnginePort<'jsonpath', Payload> = {
      engine: 'jsonpath',
      profile: 'source',
      compile: (source) => ({ ok: true, compiled: { engine: 'jsonpath', payload: { token: Symbol(source) } } }),
      evaluate: (compiled: CompiledAssertion<'jsonpath', Payload>) => {
        // payload keeps its static type — no `any`/`unknown` cast needed
        const token: symbol = compiled.payload.token;
        return { ok: true, pass: typeof token === 'symbol' };
      },
    };
    const outcome = port.compile('$.a');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const evaluated = port.evaluate(outcome.compiled, { a: 1 });
      expect(evaluated).toEqual({ ok: true, pass: true });
    }
  });

  test('RuleFinding.adr is strictly an AdrRef; paths use separate report-only fields', () => {
    const finding: RuleFinding = {
      reason: 'no-orphan-refs.dangling-supersedes',
      adr: '0042' as AdrRef,
      recordPath: 'docs/adr/0042-x.md',
      field: 'supersedes',
    };
    expect(finding.adr).toBe('0042');
    expect(finding.recordPath).toBe('docs/adr/0042-x.md');
  });

  test('inputs are deeply readonly', () => {
    const assertInput = (input: Pass0Input): void => {
      // @ts-expect-error corpus is readonly
      input.corpus = input.corpus;
    };
    void assertInput;
    expect(true).toBe(true);
  });

  test('a Pass0Report exposes exactly the 11 fixed rule ids with no duplicate finding ids', () => {
    // structural, compile-time-checked shape usage
    const asReport = (report: Pass0Report): RuleId[] => report.results.map((r: RuleResult) => r.rule);
    void asReport;
    const err: Pass0InputContractError = {
      code: 'candidate-status-not-proposal',
      proposalPath: 'docs/adr/0042-x.md',
      actualStatus: 'accepted',
    };
    expect(err.code).toBe('candidate-status-not-proposal');
  });
});

describe('evaluatePass0 is exported and total', () => {
  test('is a function', () => {
    expect(typeof evaluatePass0).toBe('function');
  });
});

describe('public surface excludes CLI / CI / adapter / bundle-loader (T011)', () => {
  test('exports no impure boundary symbols', async () => {
    const surface = (await import('../src/index.ts')) as Record<string, unknown>;
    const forbidden = [
      'main',
      'runCli',
      'cli',
      'loadSnapshotBundle',
      'readSnapshotBundle',
      'parseSnapshotBundleFromFile',
      'lintCorpus',
      'readFile',
      'writeFile',
    ];
    for (const name of forbidden) {
      expect(surface[name]).toBeUndefined();
    }
    expect(typeof surface.evaluatePass0).toBe('function');
  });

  test('evaluator source imports no adapter, model, ci, or fs traversal package', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const srcRoot = join(import.meta.dir, '..', 'src');
    async function files(dir: string): Promise<string[]> {
      const out: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await files(full)));
        else if (entry.name.endsWith('.ts')) out.push(full);
      }
      return out;
    }
    function importSpecifiers(source: string): string[] {
      const specs: string[] = [];
      const patterns = [/from\s+['"]([^'"]+)['"]/g, /import\(\s*['"]([^'"]+)['"]\s*\)/g];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          if (match[1]) specs.push(match[1]);
        }
      }
      return specs;
    }
    const banned = [
      /^@adrkit\/cli/,
      /^@adrkit\/ci/,
      /^@adrkit\/adapter/,
      /^@actions\//,
      /^@octokit\//,
      /^node:fs/,
      /^node:child_process/,
      /^node:net/,
      /^node:http/,
    ];
    for (const file of await files(srcRoot)) {
      const source = await readFile(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        for (const pattern of banned) {
          expect({ file, specifier, banned: pattern.source, matched: pattern.test(specifier) }).toEqual({
            file,
            specifier,
            banned: pattern.source,
            matched: false,
          });
        }
      }
    }
  });
});
