#!/usr/bin/env bun
// CI gate: fail the build on high- or critical-severity dependency advisories
// reported by `bun audit --json`.
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

export interface AuditEvaluation {
  /** True only when the audit was read AND contained no high/critical advisory. */
  readonly ok: boolean;
  /**
   * Why the gate could not pass. `undefined` means it was read successfully.
   * 'no-output' / 'unparseable' are blind states: the audit could not be read,
   * which ADR-0016 requires we surface rather than render as a clean pass.
   */
  readonly reason?: 'blocking-advisories' | 'no-output' | 'unparseable';
  /** High- and critical-severity advisories that block the gate. */
  readonly blocking: BlockingAdvisory[];
  /** What was examined: advisory count per severity across every package. */
  readonly examinedBySeverity: Record<AdvisorySeverity, number>;
  /** Number of distinct packages carrying at least one advisory. */
  readonly examinedPackages: number;
}

const BLOCKING: ReadonlySet<AdvisorySeverity> = new Set(['critical', 'high']);

function emptySeverityTally(): Record<AdvisorySeverity, number> {
  return { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
}

/**
 * Evaluate raw `bun audit --json` stdout. Pure: no process, no I/O. Distinguishes
 * "read the audit and it was clean" from "could not read the audit at all".
 */
export function evaluateAudit(raw: string): AuditEvaluation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    // ADR-0016: an absent report is "could not look", not "looked, found nothing".
    return {
      ok: false,
      reason: 'no-output',
      blocking: [],
      examinedBySeverity: emptySeverityTally(),
      examinedPackages: 0,
    };
  }

  let parsed: BunAuditJson;
  try {
    parsed = JSON.parse(trimmed) as BunAuditJson;
  } catch {
    return {
      ok: false,
      reason: 'unparseable',
      blocking: [],
      examinedBySeverity: emptySeverityTally(),
      examinedPackages: 0,
    };
  }

  const examinedBySeverity = emptySeverityTally();
  const blocking: BlockingAdvisory[] = [];
  let examinedPackages = 0;

  for (const [pkg, advisories] of Object.entries(parsed)) {
    if (!Array.isArray(advisories) || advisories.length === 0) continue;
    examinedPackages += 1;
    for (const advisory of advisories) {
      examinedBySeverity[advisory.severity] = (examinedBySeverity[advisory.severity] ?? 0) + 1;
      if (BLOCKING.has(advisory.severity)) {
        blocking.push({ ...advisory, package: pkg });
      }
    }
  }

  return {
    ok: blocking.length === 0,
    reason: blocking.length === 0 ? undefined : 'blocking-advisories',
    blocking,
    examinedBySeverity,
    examinedPackages,
  };
}

/** Human-readable summary of what the gate examined and why it passed or failed. */
export function formatEvaluation(evaluation: AuditEvaluation): string {
  if (evaluation.reason === 'no-output') {
    return 'audit-gate: FAILED — `bun audit --json` produced no output; the audit could not be read (blind), not a clean tree.';
  }
  if (evaluation.reason === 'unparseable') {
    return 'audit-gate: FAILED — `bun audit --json` output was not valid JSON; the audit could not be read (blind).';
  }

  const s = evaluation.examinedBySeverity;
  const examined =
    `audit-gate: examined ${evaluation.examinedPackages} package(s) with advisories ` +
    `(critical=${s.critical}, high=${s.high}, moderate=${s.moderate}, low=${s.low}, info=${s.info}).`;

  if (evaluation.ok) {
    return `${examined}\naudit-gate: PASSED — no high- or critical-severity advisories.`;
  }

  const lines = evaluation.blocking.map(
    (a) => `  - ${a.severity.toUpperCase()} ${a.package}: ${a.title} (${a.url})`,
  );
  return (
    `${examined}\n` +
    `audit-gate: FAILED — ${evaluation.blocking.length} high/critical advisory(ies) must be resolved:\n` +
    lines.join('\n')
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

export async function main(): Promise<number> {
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
