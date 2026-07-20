/**
 * Shared, fully-offline test support for the evaluator. Builds in-memory `Adr`
 * records, synthetic `LintCorpusResult`s, and a fully-backed-or-empty `Pass0Input`
 * so rule tests exercise `evaluatePass0` deterministically with no filesystem, clock,
 * network, or model access.
 */

import {
  sortFindings,
  validateCorpusInvariants,
  type Adr,
  type AdrFrontmatter,
  type Finding,
  type LintCorpusResult,
} from '@adrkit/core';
import {
  emptyAssertionEngineRegistry,
  emptyTargetResolutionRegistry,
  evaluatePass0,
  type Pass0Evaluation,
  type Pass0Input,
  type Pass0Report,
  type RuleId,
  type RuleResult,
} from '../src/index.ts';
import { byCodeUnit } from '../src/compare.ts';

export function frontmatter(overrides: Partial<AdrFrontmatter> & { id: string }): AdrFrontmatter {
  return {
    schemaVersion: '0.1.0',
    title: `Decision ${overrides.id}`,
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
    ...overrides,
  };
}

export function record(
  fm: Partial<AdrFrontmatter> & { id: string },
  opts: { path?: string; log?: string } = {},
): Adr {
  return {
    frontmatter: frontmatter(fm),
    body: '',
    path: opts.path ?? `docs/adr/${fm.id}-x.md`,
    ...(opts.log !== undefined ? { log: opts.log } : {}),
  };
}

/** Build a LintCorpusResult from typed records, including core corpus-invariant findings. */
export function corpusOf(records: readonly Adr[], extraFindings: readonly Finding[] = []): LintCorpusResult {
  const findings = sortFindings([...validateCorpusInvariants(records), ...extraFindings]);
  return {
    checked: records.length,
    findings,
    records: [...records].sort((a, b) => byCodeUnit(a.frontmatter.id, b.frontmatter.id)),
  };
}

/** A schema-invalid corpus: the proposal is absent from `records`; its findings are on-path. */
export function malformedCorpus(proposalPath: string, schemaFindings: readonly Finding[]): LintCorpusResult {
  return { checked: 1, findings: sortFindings(schemaFindings), records: [] };
}

export function baseInput(
  overrides: Partial<Pass0Input> & { corpus: LintCorpusResult; proposalPath: string },
): Pass0Input {
  return {
    targets: {},
    targetRegistry: emptyTargetResolutionRegistry,
    assertionInputs: { sources: {}, inputs: {} },
    assertionEngines: emptyAssertionEngineRegistry,
    evaluationDate: '2026-07-19',
    ...overrides,
  };
}

export function run(input: Pass0Input): Pass0Evaluation {
  return evaluatePass0(input);
}

/** Evaluate and return the report (throws on an input-error, which most tests don't want). */
export function evaluateReport(input: Pass0Input): Pass0Report {
  const outcome = evaluatePass0(input);
  if (outcome.kind !== 'evaluated') {
    throw new Error(`expected evaluated, got input-error ${outcome.error.code}`);
  }
  return outcome.result.report;
}

export function ruleResult(report: Pass0Report, rule: RuleId): RuleResult {
  const result = report.results.find((r) => r.rule === rule);
  if (!result) throw new Error(`no result for rule ${rule}`);
  return result;
}
