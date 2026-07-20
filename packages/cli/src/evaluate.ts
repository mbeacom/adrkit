/**
 * @adrkit/cli — `adr evaluate` composition boundary.
 *
 * This is the IMPURE boundary: it reads the proposal + corpus from disk, validates
 * the snapshot bundle into immutable data, constructs the trusted target/assertion
 * registries from composition code (never from JSON), resolves `--date`, calls the
 * pure `evaluatePass0`, and renders + selects the exit code. It never writes the
 * report/patch back to any record or store — there is NO `--write` (FR-014).
 *
 * US1 wires empty registries; US3 (T042) constructs the real deterministic ports.
 */

import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { lintCorpus, normalizeDisplayPath } from '@adrkit/core';
import {
  canonicalize,
  createAssertionEngineRegistry,
  createJsonPathEngine,
  createPackageTargetResolver,
  createPathTargetResolver,
  createTargetResolutionRegistry,
  evaluatePass0,
  type Pass0Input,
} from '@adrkit/evaluator';
import { loadSnapshotBundle, SnapshotContractError, type NormalizedSnapshot } from './evaluate-snapshot.ts';

/**
 * The trusted deterministic registries, constructed ONLY from composition code —
 * never from snapshot JSON. Built-in `path`/`package` target resolvers and the approved
 * JSONPath source engine are registered; `entity`/`resource`/`api`/`data` resolvers and
 * a Rego/grep/custom engine are absent by default (the affected rules report inert).
 */
const TARGET_REGISTRY = createTargetResolutionRegistry([createPathTargetResolver(), createPackageTargetResolver()]);
const ASSERTION_ENGINES = createAssertionEngineRegistry({ jsonpath: createJsonPathEngine() });

export interface EvaluateOptions {
  readonly proposalPath: string;
  readonly snapshotPath: string;
  readonly date: string;
  readonly json: boolean;
  readonly dir?: string;
  readonly cwd?: string;
}

export interface EvaluateOutput {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict `YYYY-MM-DD` including calendar correctness (no clock is read). */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Assemble the immutable Pass0Input from the loaded corpus + normalized snapshot. */
function buildInput(
  proposalPath: string,
  corpus: Awaited<ReturnType<typeof lintCorpus>>,
  snapshot: NormalizedSnapshot,
  date: string,
): Pass0Input {
  return {
    corpus,
    proposalPath,
    ...(snapshot.federatedLogs ? { federatedLogs: snapshot.federatedLogs } : {}),
    ...(snapshot.resolutionLog !== undefined ? { resolutionLog: snapshot.resolutionLog } : {}),
    targets: snapshot.targets,
    // Trusted registries are injected here — never selected by the snapshot JSON.
    targetRegistry: TARGET_REGISTRY,
    assertionInputs: snapshot.assertionInputs,
    assertionEngines: ASSERTION_ENGINES,
    ...(snapshot.identity ? { identity: snapshot.identity } : {}),
    ...(snapshot.scopeEvidence ? { scopeEvidence: snapshot.scopeEvidence } : {}),
    ...(snapshot.routingEvidence ? { routingEvidence: snapshot.routingEvidence } : {}),
    evaluationDate: date,
  };
}

function renderHuman(report: import('@adrkit/evaluator').Pass0Report): string {
  const lines: string[] = [`Pass 0 evaluation of ${report.proposalPath} — outcome: ${report.outcome}`];
  for (const result of report.results) {
    const severity = result.status === 'fail' && result.severity ? ` (${result.severity})` : '';
    lines.push(`  ${result.rule}: ${result.status}${severity} — ${result.reason}`);
  }
  const { routing } = report;
  const target =
    routing.target.kind === 'resolved'
      ? `${routing.target.human} (via ${routing.target.via})`
      : routing.target.kind;
  lines.push(
    `  routing: ${routing.escalate ? `escalate [${routing.reasons.join(', ')}]` : 'no escalation'}, target: ${target}`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Pure-ish evaluation core: given already-parsed options, produce the exit + streams.
 * Filesystem access (proposal/corpus/snapshot reads) happens here at the boundary.
 */
export async function evaluate(options: EvaluateOptions): Promise<EvaluateOutput> {
  const cwd = options.cwd ?? process.cwd();

  if (!isValidIsoDate(options.date)) {
    return { exitCode: 2, stdout: '', stderr: `adr evaluate: --date must be a valid YYYY-MM-DD (got "${options.date}")\n` };
  }

  let snapshot: NormalizedSnapshot;
  try {
    const text = await readFile(options.snapshotPath, 'utf8');
    snapshot = loadSnapshotBundle(text);
  } catch (error) {
    if (error instanceof SnapshotContractError) {
      return { exitCode: 2, stdout: '', stderr: `adr evaluate: ${error.message}\n` };
    }
    return {
      exitCode: 2,
      stdout: '',
      stderr: `adr evaluate: could not read snapshot "${options.snapshotPath}": ${error instanceof Error ? error.message : String(error)}\n`,
    };
  }

  const dir = options.dir ?? dirname(options.proposalPath);
  const corpus = await lintCorpus({ paths: [dir, options.proposalPath], cwd });
  const proposalPath = normalizeDisplayPath(options.proposalPath, cwd);

  const outcome = evaluatePass0(buildInput(proposalPath, corpus, snapshot, options.date));

  if (outcome.kind === 'input-error') {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `adr evaluate: ${outcome.error.code} — "${proposalPath}" has status "${outcome.error.actualStatus}", not draft/proposed\n`,
    };
  }

  const { report, patch } = outcome.result;
  const exitCode: 0 | 1 = report.outcome === 'returned' ? 1 : 0;

  if (options.json) {
    // The deterministic `report` + `patch` are canonicalized (sorted keys); caller
    // `metadata` lives OUTSIDE `result`, so `result.report` / `result.patch` reproduce
    // byte-for-byte independent of the metadata (FR-005).
    const envelope = {
      result: { report: canonicalize(report), patch: canonicalize(patch) },
      metadata: { evaluatorVersion: '0.1.0' },
    };
    return { exitCode, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: '' };
  }
  return { exitCode, stdout: renderHuman(report), stderr: '' };
}
