#!/usr/bin/env bun
// CI gate: fail the build on high- or critical-severity dependency advisories
// reported by `bun audit --json` for this checkout's resolved workspace tree.
//
// ADR-0016 ("require every check to be observed failing before it counts as
// coverage") governs this file directly. A naive gate would run `bun audit`,
// check its exit code, and pass — but `bun audit` exits non-zero for *any*
// advisory and its `--json` output ignores `--audit-level`, so exit code alone
// cannot express "high-severity only". Worse, the failure mode ADR-0016 names
// is a check that reports an *absence*: if the audit process produces no output
// (network failure, tool change), the difference between "looked and found
// nothing" and "could not look" collapses to the same empty string.
//
// So `evaluateAudit` is pure and separately tested against a committed fixture
// captured from the real pre-fix tree (scripts/__fixtures__/audit/prefix-high.json),
// which is the permanent negative case. Empty/unparseable input is reported as a
// blind failure, not a pass.

export type AdvisorySeverity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

const SEVERITIES: readonly AdvisorySeverity[] = ['critical', 'high', 'moderate', 'low', 'info'];
const KNOWN_SEVERITY: ReadonlySet<string> = new Set(SEVERITIES);

export interface Advisory {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly severity: AdvisorySeverity;
}

/** Package name -> advisories, matching `bun audit --json`'s object shape. */
type BunAuditJson = Record<string, Advisory[]>;

export interface BlockingAdvisory extends Advisory {
  readonly package: string;
}

export interface AuditScope {
  readonly id: 'workspace-resolved-dependency-tree';
  readonly examined: string;
  readonly notExamined: string;
}

export interface KnownConsumerAdvisory {
  readonly advisoryId: string;
  readonly url: string;
  readonly title: string;
  readonly severity: AdvisorySeverity;
  readonly package: string;
  readonly observedVersion: string;
  readonly vulnerableVersions: string;
  readonly affectedPublishedPackage: string;
  readonly affectedPublishedVersion: string;
  readonly dependencyPath: readonly string[];
  readonly acceptedUntil: string;
  readonly expired: boolean;
  readonly whyNotFixed: string;
  readonly consequence: string;
  readonly resolvesWhen: string;
}

export interface AuditEvaluation {
  /** True only when the audit was read AND contained no high/critical advisory. */
  readonly ok: boolean;
  /**
   * Why the gate could not pass. `undefined` means it was read successfully.
   * 'no-output' / 'unparseable' / 'unexpected-shape' are blind states: the audit
   * could not be read, which ADR-0016 requires we surface rather than render as a
   * clean pass. Expired consumer acceptances also fail closed: the record was
   * understood, but the accepted risk window has ended.
   */
  readonly reason?:
    | 'blocking-advisories'
    | 'no-output'
    | 'unparseable'
    | 'unexpected-shape'
    | 'invalid-as-of'
    | 'consumer-advisory-acceptance-expired';
  /** High- and critical-severity advisories that block the gate. */
  readonly blocking: BlockingAdvisory[];
  /** What dependency tree was actually audited. */
  readonly scope: AuditScope;
  /** Known consumer-install exposures outside `bun audit`'s workspace scope. */
  readonly knownConsumerAdvisories: KnownConsumerAdvisory[];
  /** UTC date used to decide whether known consumer advisory acceptances expired. */
  readonly asOf: string;
  /** What was examined: advisory count per severity across every package. */
  readonly examinedBySeverity: Record<AdvisorySeverity, number>;
  /** Number of distinct packages carrying at least one advisory. */
  readonly examinedPackages: number;
  /** Set only when `reason` is 'unexpected-shape' or 'invalid-as-of'. */
  readonly shapeError?: string;
}

const BLOCKING: ReadonlySet<AdvisorySeverity> = new Set(['critical', 'high']);

const WORKSPACE_AUDIT_SCOPE: AuditScope = {
  id: 'workspace-resolved-dependency-tree',
  examined:
    'the current checkout after root package.json overrides are applied by `bun install --frozen-lockfile`',
  notExamined:
    'consumer installs of published @adrkit/* packages, whose manifests do not publish the root overrides',
};

const KNOWN_CONSUMER_ADVISORY_ACCEPTANCES: readonly Omit<KnownConsumerAdvisory, 'expired'>[] = [
  {
    advisoryId: 'GHSA-frvp-7c67-39w9',
    url: 'https://github.com/advisories/GHSA-frvp-7c67-39w9',
    title:
      'Node.js Adapter for Hono: Path traversal in `serve-static` on Windows via encoded backslash (`%5C`)',
    severity: 'moderate',
    package: '@hono/node-server',
    observedVersion: '1.19.17',
    vulnerableVersions: '<2.0.5',
    affectedPublishedPackage: '@adrkit/mcp',
    affectedPublishedVersion: '0.2.1',
    dependencyPath: ['@adrkit/mcp', '@modelcontextprotocol/sdk@1.29.0', '@hono/node-server'],
    acceptedUntil: '2026-10-31',
    whyNotFixed:
      '@modelcontextprotocol/sdk@1.29.0 is the latest release and still ranges @hono/node-server as ^1.19.9; adrkit root overrides do not constrain consumer installs.',
    consequence:
      'adrkit is a local stdio MCP server; the stdio MCP server does not use Hono serve-static or expose HTTP static files, so this Windows serve-static path traversal is low-consequence here.',
    resolvesWhen:
      'an @modelcontextprotocol/sdk release updates its @hono/node-server range so consumers resolve @hono/node-server >=2.0.5, or adrkit removes that transitive path.',
  },
];

function emptySeverityTally(): Record<AdvisorySeverity, number> {
  return { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
}

function blind(
  reason: 'no-output' | 'unparseable' | 'unexpected-shape' | 'invalid-as-of',
  asOf: string,
  knownConsumerAdvisories: KnownConsumerAdvisory[],
  shapeError?: string,
): AuditEvaluation {
  return {
    ok: false,
    reason,
    blocking: [],
    scope: WORKSPACE_AUDIT_SCOPE,
    knownConsumerAdvisories,
    asOf,
    examinedBySeverity: emptySeverityTally(),
    examinedPackages: 0,
    ...(shapeError === undefined ? {} : { shapeError }),
  };
}

/**
 * Validate that `value` is the shape `bun audit --json` documents, returning a
 * description of the first mismatch or `undefined` when it conforms.
 *
 * Deliberately strict, and deliberately fail-closed. An unrecognized report is
 * not a clean tree — it means the gate no longer understands what it is reading,
 * which is indistinguishable from not looking (ADR-0016). If a future bun release
 * legitimately changes this shape, the build fails loudly and this function and
 * its fixtures get updated together, rather than the gate silently greening.
 */
function findShapeError(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return `expected a JSON object of package -> advisories, got ${
      value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value
    }`;
  }

  for (const [pkg, advisories] of Object.entries(value)) {
    if (!Array.isArray(advisories)) {
      return `expected "${pkg}" to hold an array of advisories, got ${
        advisories === null ? 'null' : typeof advisories
      }`;
    }
    for (const [index, advisory] of advisories.entries()) {
      const at = `"${pkg}"[${index}]`;
      if (advisory === null || typeof advisory !== 'object' || Array.isArray(advisory)) {
        return `expected ${at} to be an advisory object`;
      }
      const record = advisory as Record<string, unknown>;
      if (typeof record.severity !== 'string' || !KNOWN_SEVERITY.has(record.severity)) {
        return `unknown severity ${JSON.stringify(record.severity)} at ${at}; expected one of ${SEVERITIES.join(', ')}`;
      }
      if (typeof record.url !== 'string') return `expected ${at}.url to be a string`;
      if (typeof record.title !== 'string') return `expected ${at}.title to be a string`;
      if (typeof record.id !== 'number') return `expected ${at}.id to be a number`;
    }
  }

  return undefined;
}

export interface AuditEvaluationOptions {
  readonly asOf?: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeAsOf(value: string | undefined): { asOf: string; error?: string } {
  const asOf = value ?? todayUtc();
  if (!DATE_ONLY.test(asOf)) {
    return { asOf, error: `expected asOf to be a UTC YYYY-MM-DD date, got ${JSON.stringify(asOf)}` };
  }

  const parsed = new Date(`${asOf}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== asOf) {
    return { asOf, error: `expected asOf to be a real UTC calendar date, got ${JSON.stringify(asOf)}` };
  }

  return { asOf };
}

function buildKnownConsumerAdvisories(asOf: string): KnownConsumerAdvisory[] {
  return KNOWN_CONSUMER_ADVISORY_ACCEPTANCES.map((advisory) => ({
    ...advisory,
    expired: asOf > advisory.acceptedUntil,
  }));
}

function chooseReason(
  blocking: readonly BlockingAdvisory[],
  knownConsumerAdvisories: readonly KnownConsumerAdvisory[],
): AuditEvaluation['reason'] {
  if (blocking.length > 0) return 'blocking-advisories';
  if (knownConsumerAdvisories.some((advisory) => advisory.expired)) {
    return 'consumer-advisory-acceptance-expired';
  }
  return undefined;
}

/**
 * Evaluate raw `bun audit --json` stdout. Pure: no process, no I/O. Distinguishes
 * "read the audit and it was clean" from "could not read the audit at all".
 */
export function evaluateAudit(raw: string, options: AuditEvaluationOptions = {}): AuditEvaluation {
  const normalizedAsOf = normalizeAsOf(options.asOf);
  if (normalizedAsOf.error !== undefined) {
    return blind('invalid-as-of', normalizedAsOf.asOf, [], normalizedAsOf.error);
  }
  const { asOf } = normalizedAsOf;
  const knownConsumerAdvisories = buildKnownConsumerAdvisories(asOf);

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    // ADR-0016: an absent report is "could not look", not "looked, found nothing".
    return blind('no-output', asOf, knownConsumerAdvisories);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return blind('unparseable', asOf, knownConsumerAdvisories);
  }

  // Valid JSON is not enough: a report we do not recognize must fail closed,
  // otherwise an envelope change renders as "examined 0 packages — PASSED".
  const shapeError = findShapeError(parsed);
  if (shapeError !== undefined) return blind('unexpected-shape', asOf, knownConsumerAdvisories, shapeError);

  const examinedBySeverity = emptySeverityTally();
  const blocking: BlockingAdvisory[] = [];
  let examinedPackages = 0;

  for (const [pkg, advisories] of Object.entries(parsed as BunAuditJson)) {
    if (advisories.length === 0) continue;
    examinedPackages += 1;
    for (const advisory of advisories) {
      examinedBySeverity[advisory.severity] += 1;
      if (BLOCKING.has(advisory.severity)) {
        blocking.push({ ...advisory, package: pkg });
      }
    }
  }

  const reason = chooseReason(blocking, knownConsumerAdvisories);
  return {
    ok: reason === undefined,
    reason,
    blocking,
    scope: WORKSPACE_AUDIT_SCOPE,
    knownConsumerAdvisories,
    asOf,
    examinedBySeverity,
    examinedPackages,
  };
}

function formatScope(scope: AuditScope): string {
  return `audit-gate: scope: ${scope.id} — examines ${scope.examined}; does not audit ${scope.notExamined}.`;
}

function formatKnownConsumerAdvisories(advisories: readonly KnownConsumerAdvisory[], asOf: string): string {
  if (advisories.length === 0) return '';

  const lines = advisories.map((advisory) => {
    const dependencyPath = advisory.dependencyPath.join(' › ');
    const state = advisory.expired
      ? `EXPIRED on ${advisory.acceptedUntil} (as-of ${asOf})`
      : `accepted until ${advisory.acceptedUntil}`;
    return [
      `  - ${advisory.severity.toUpperCase()} ${advisory.affectedPublishedPackage}@${advisory.affectedPublishedVersion} consumer install: ${dependencyPath} resolves ${advisory.package}@${advisory.observedVersion} (${advisory.advisoryId}, ${advisory.url}; vulnerable ${advisory.vulnerableVersions}; ${state}).`,
      `    why not fixed: ${advisory.whyNotFixed}`,
      `    consequence: ${advisory.consequence}`,
      `    resolves when: ${advisory.resolvesWhen}`,
    ].join('\n');
  });

  return (
    'audit-gate: known published-consumer exposure(s) outside this audit scope (recorded, not suppressed):\n' +
    lines.join('\n')
  );
}

/** Human-readable summary of what the gate examined and why it passed or failed. */
export function formatEvaluation(evaluation: AuditEvaluation): string {
  const scope = formatScope(evaluation.scope);
  const known = formatKnownConsumerAdvisories(evaluation.knownConsumerAdvisories, evaluation.asOf);
  const suffix = known.length === 0 ? '' : `\n${known}`;

  if (evaluation.reason === 'invalid-as-of') {
    return `${scope}\naudit-gate: FAILED — invalid audit-gate as-of date; refusing to evaluate acceptance expiry: ${evaluation.shapeError}.${suffix}`;
  }
  if (evaluation.reason === 'no-output') {
    return `${scope}\naudit-gate: FAILED — \`bun audit --json\` produced no output; the audit could not be read (blind), not a clean tree.${suffix}`;
  }
  if (evaluation.reason === 'unparseable') {
    return `${scope}\naudit-gate: FAILED — \`bun audit --json\` output was not valid JSON; the audit could not be read (blind).${suffix}`;
  }
  if (evaluation.reason === 'unexpected-shape') {
    return (
      `${scope}\n` +
      'audit-gate: FAILED — `bun audit --json` output parsed but did not match the expected schema, ' +
      `so the audit could not be read (blind): ${evaluation.shapeError}. ` +
      `If bun legitimately changed its output, update scripts/audit-gate.ts and its fixtures together.${suffix}`
    );
  }

  const s = evaluation.examinedBySeverity;
  const examined =
    `audit-gate: examined ${evaluation.examinedPackages} package(s) with advisories ` +
    `(critical=${s.critical}, high=${s.high}, moderate=${s.moderate}, low=${s.low}, info=${s.info}).`;

  if (evaluation.ok) {
    return `${scope}\n${examined}\naudit-gate: PASSED — no high- or critical-severity advisories.${suffix}`;
  }

  const lines = evaluation.blocking.map((a) => `  - ${a.severity.toUpperCase()} ${a.package}: ${a.title} (${a.url})`);
  const blockingMessage =
    evaluation.blocking.length > 0
      ? `audit-gate: FAILED — ${evaluation.blocking.length} high/critical advisory(ies) must be resolved:\n${lines.join('\n')}`
      : 'audit-gate: FAILED — consumer advisory acceptance expired; refresh the published-consumer audit evidence, remove the exposure, or renew the narrow acceptance before this gate can pass.';
  return (
    `${scope}\n` +
    `${examined}\n` +
    blockingMessage +
    suffix
  );
}

async function runBunAuditJson(): Promise<{ stdout: string; exitCode: number }> {
  // `bun audit --json` exits 1 when advisories exist and 0 when clean; either way
  // the JSON is on stdout. A non-zero exit with empty stdout means it could not run.
  const proc = Bun.spawn(['bun', 'audit', '--json'], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

const USAGE = 'usage: bun run audit:gate   (takes no arguments)';

export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  // The gate takes no arguments. Accepting and ignoring them is the same
  // fail-quiet shape ADR-0016 exists to prevent: `audit-gate --input fixture.json`
  // would silently audit the live tree and print a reassuring PASSED that says
  // nothing about the file the operator believed was checked.
  if (argv.length > 0) {
    console.error(`audit-gate: unexpected argument(s): ${argv.join(' ')}\n${USAGE}`);
    return 2;
  }

  const { stdout, exitCode } = await runBunAuditJson();
  const evaluation = evaluateAudit(stdout);
  console.log(formatEvaluation(evaluation));

  if (evaluation.reason === 'no-output') {
    // Reinforce the blind case with the tool's own exit code for the operator.
    console.error(`audit-gate: bun audit exited ${exitCode} with no JSON on stdout.`);
  }
  return evaluation.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await main());
}
