import { describe, expect, test } from 'bun:test';
import { lintCorpus, type Finding } from '@adrkit/core';
import { evaluatePass0, ROUTING_TRIGGERS } from '../src/index.ts';
import { baseInput, evaluateReport, malformedCorpus, ruleResult } from './support.ts';

/**
 * US1 / T012 — schema-valid short-circuit. A parse/contract/file-read finding on the
 * proposal path fails `schema-valid` (error) and yields exactly ten `not-evaluated`
 * results with routing that is eight ordered `not-proven` statuses, `escalate=false`,
 * `target=not-required`, and a schema-violation-only patch. No typed rule runs.
 */

const NOT_EVALUATED_RULES = [
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
] as const;

function expectSchemaInvalidShape(proposalPath: string, corpus: ReturnType<typeof malformedCorpus>): void {
  const report = evaluateReport(baseInput({ corpus, proposalPath }));
  expect(report.results).toHaveLength(11);
  const schemaValid = report.results[0];
  expect(schemaValid?.rule).toBe('schema-valid');
  expect(schemaValid?.status).toBe('fail');
  expect(schemaValid?.severity).toBe('error');
  // the next ten are not-evaluated.schema-invalid in fixed rubric order
  const rest = report.results.slice(1);
  expect(rest.map((r) => r.rule)).toEqual([...NOT_EVALUATED_RULES]);
  for (const result of rest) {
    expect(result.status).toBe('not-evaluated');
    expect(result.reason).toBe('not-evaluated.schema-invalid');
    expect(result.findings).toHaveLength(0);
  }
  // routing: eight ordered not-proven, escalate false, target not-required
  expect(report.routing.escalate).toBe(false);
  expect(report.routing.reasons).toEqual([]);
  expect(report.routing.evidenceStatus.map((e) => e.reason)).toEqual([...ROUTING_TRIGGERS]);
  for (const status of report.routing.evidenceStatus) expect(status.status).toBe('not-proven');
  expect(report.routing.target).toEqual({ kind: 'not-required', code: 'route.target.not-required' });
  expect(report.outcome).toBe('returned');
}

describe('schema-valid maps synthetic parse/contract/file-read findings', () => {
  test('parse-error finding', () => {
    const proposalPath = 'docs/adr/0042-x.md';
    const findings: Finding[] = [
      { rule: 'frontmatter-parse', severity: 'error', message: 'bad yaml', path: proposalPath, field: 'frontmatter' },
    ];
    const report = evaluateReport(baseInput({ corpus: malformedCorpus(proposalPath, findings), proposalPath }));
    const schemaValid = ruleResult(report, 'schema-valid');
    expect(schemaValid.reason).toBe('schema-valid.parse-error');
    expect(schemaValid.findings[0]?.lowerLevel?.rule).toBe('frontmatter-parse');
    // a path is report-only evidence, never projected into `adr`
    expect(schemaValid.findings[0]?.recordPath).toBe(proposalPath);
    expect(schemaValid.findings[0]?.adr).toBeUndefined();
    expectSchemaInvalidShape(proposalPath, malformedCorpus(proposalPath, findings));
  });

  test('contract-error finding', () => {
    const proposalPath = 'docs/adr/0043-x.md';
    const findings: Finding[] = [
      { rule: 'invalid-enum-value', severity: 'error', message: 'bad status', path: proposalPath, field: 'status' },
    ];
    const report = evaluateReport(baseInput({ corpus: malformedCorpus(proposalPath, findings), proposalPath }));
    expect(ruleResult(report, 'schema-valid').reason).toBe('schema-valid.contract-error');
  });

  test('file-read finding', () => {
    const proposalPath = 'docs/adr/0099-x.md';
    const findings: Finding[] = [
      { rule: 'file-read', severity: 'error', message: 'ENOENT', path: proposalPath },
    ];
    const report = evaluateReport(baseInput({ corpus: malformedCorpus(proposalPath, findings), proposalPath }));
    expect(ruleResult(report, 'schema-valid').reason).toBe('schema-valid.file-read');
  });

  test('the patch carries only the schema violation, non-escalated', () => {
    const proposalPath = 'docs/adr/0042-x.md';
    const findings: Finding[] = [
      { rule: 'frontmatter-parse', severity: 'error', message: 'bad yaml', path: proposalPath },
    ];
    const outcome = evaluatePass0(baseInput({ corpus: malformedCorpus(proposalPath, findings), proposalPath }));
    expect(outcome.kind).toBe('evaluated');
    if (outcome.kind === 'evaluated') {
      expect(outcome.result.patch.deterministicFindings).toEqual([
        { rule: 'schema-valid', severity: 'error', message: 'bad yaml' },
      ]);
      expect(outcome.result.patch.escalate).toBe(false);
      expect(outcome.result.patch.escalationReasons).toEqual([]);
    }
  });
});

describe('schema-valid over the real parser (offline lintCorpus at the CLI boundary)', () => {
  const dir = 'packages/evaluator/test/fixtures/schema-valid';

  test('malformed YAML fixture short-circuits to fail + ten not-evaluated', async () => {
    const proposalPath = `${dir}/parse/0042-bad-yaml.md`;
    const corpus = await lintCorpus({ paths: [proposalPath] });
    const report = evaluateReport(baseInput({ corpus, proposalPath }));
    expect(ruleResult(report, 'schema-valid').status).toBe('fail');
    expect(report.results.filter((r) => r.status === 'not-evaluated')).toHaveLength(10);
    expect(report.outcome).toBe('returned');
  });

  test('contract-violation fixture fails schema-valid with contract-error', async () => {
    const proposalPath = `${dir}/contract/0043-bad-status.md`;
    const corpus = await lintCorpus({ paths: [proposalPath] });
    const report = evaluateReport(baseInput({ corpus, proposalPath }));
    expect(ruleResult(report, 'schema-valid').reason).toBe('schema-valid.contract-error');
  });

  test('a valid proposal passes schema-valid', async () => {
    const proposalPath = `${dir}/pass/0044-valid.md`;
    const corpus = await lintCorpus({ paths: [proposalPath] });
    const report = evaluateReport(baseInput({ corpus, proposalPath }));
    expect(ruleResult(report, 'schema-valid')).toMatchObject({ status: 'pass', reason: 'schema-valid.ok' });
  });
});
