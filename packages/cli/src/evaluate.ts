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

import { readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { lintCorpus, normalizeDisplayPath } from '@adrkit/core';
import {
  canonicalBytes,
  createAssertionEngineRegistry,
  createJsonPathEngine,
  createPackageTargetResolver,
  createPathTargetResolver,
  createTargetResolutionRegistry,
  evaluatePass0,
  type Pass0Input,
} from '@adrkit/evaluator';
import {
  corpusDirectoryErrorKind,
  type CorpusDirectoryErrorKind,
} from './errors.ts';
import { loadSnapshotBundle, SnapshotContractError, type NormalizedSnapshot } from './evaluate-snapshot.ts';
import { getPresentation } from './presentation.ts';

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
  readonly corpusDirectoryError?: {
    readonly dir: string;
    readonly kind: CorpusDirectoryErrorKind;
  };
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

function resolveFromCwd(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function corpusDirectoryOutput(dir: string, kind: CorpusDirectoryErrorKind): EvaluateOutput {
  return { exitCode: 2, stdout: '', stderr: '', corpusDirectoryError: { dir, kind } };
}

function handleCorpusDirectoryError(error: unknown, dir: string, cwd: string): EvaluateOutput | undefined {
  const kind = corpusDirectoryErrorKind(error, dir, cwd);
  return kind ? corpusDirectoryOutput(dir, kind) : undefined;
}

async function ensureCorpusDirectoryReadable(dir: string, cwd: string): Promise<EvaluateOutput | undefined> {
  try {
    await readdir(resolveFromCwd(dir, cwd));
    return undefined;
  } catch (error) {
    const output = handleCorpusDirectoryError(error, dir, cwd);
    if (output) return output;
    throw error;
  }
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
  const style = getPresentation().stdout;
  const lines: string[] = [`${style.heading('Pass 0 evaluation of')} ${style.path(report.proposalPath)} — outcome: ${style.status(report.outcome)}`];
  for (const result of report.results) {
    const severity = result.status === 'fail' && result.severity ? ` (${style.severity(result.severity)})` : '';
    lines.push(`  ${style.label(result.rule)}: ${style.status(result.status)}${severity} — ${result.reason}`);
  }
  const { routing } = report;
  const target =
    routing.target.kind === 'resolved'
      ? `${routing.target.human} (via ${routing.target.via})`
      : routing.target.kind;
  lines.push(
    `  ${style.label('routing')}: ${routing.escalate ? `${style.status('escalate')} [${routing.reasons.join(', ')}]` : style.note('no escalation')}, target: ${target}`,
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
    const style = getPresentation().stderr;
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${style.red('adr evaluate:')} --date must be a valid YYYY-MM-DD (got "${options.date}")\n`,
    };
  }

  const dir = options.dir ?? dirname(options.proposalPath);
  if (options.dir !== undefined) {
    const dirOutput = await ensureCorpusDirectoryReadable(options.dir, cwd);
    if (dirOutput) return dirOutput;
  }

  let snapshot: NormalizedSnapshot;
  try {
    const text = await readFile(options.snapshotPath, 'utf8');
    snapshot = loadSnapshotBundle(text);
  } catch (error) {
    const style = getPresentation().stderr;
    if (error instanceof SnapshotContractError) {
      return { exitCode: 2, stdout: '', stderr: `${style.red('adr evaluate:')} ${error.message}\n` };
    }
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${style.red('adr evaluate:')} could not read snapshot "${options.snapshotPath}": ${error instanceof Error ? error.message : String(error)}\n`,
    };
  }

  let corpus: Awaited<ReturnType<typeof lintCorpus>>;
  try {
    corpus = await lintCorpus({ paths: [dir, options.proposalPath], cwd });
  } catch (error) {
    const output = handleCorpusDirectoryError(error, dir, cwd);
    if (output) return output;
    throw error;
  }
  const proposalPath = normalizeDisplayPath(options.proposalPath, cwd);

  const outcome = evaluatePass0(buildInput(proposalPath, corpus, snapshot, options.date));

  if (outcome.kind === 'input-error') {
    const style = getPresentation().stderr;
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${style.red('adr evaluate:')} ${outcome.error.code} — "${proposalPath}" has status "${outcome.error.actualStatus}", not draft/proposed\n`,
    };
  }

  const { report, patch } = outcome.result;
  const exitCode: 0 | 1 = report.outcome === 'returned' ? 1 : 0;

  if (options.json) {
    // Canonicalize the complete envelope. Caller metadata remains outside `result`,
    // so report/patch content is still independent of metadata (FR-005).
    const envelope = {
      result: { report, patch },
      metadata: { evaluatorVersion: '0.1.0' },
    };
    return { exitCode, stdout: canonicalBytes(envelope), stderr: '' };
  }
  return { exitCode, stdout: renderHuman(report), stderr: '' };
}
