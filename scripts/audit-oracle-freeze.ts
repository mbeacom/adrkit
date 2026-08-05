import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The T019 oracle-freeze audit procedure, encoded as an executable so that its
 * FAIL behaviour can be observed (ADR-0016), not merely asserted. This is the same
 * procedure the independent auditor ran by hand in T019; making it a program lets
 * T020 and T021 attack it with deliberately bad input and record the exact reason
 * strings it emits.
 *
 * It performs three checks:
 *   1. content-hash integrity — recompute each artifact's canonical hash and compare
 *      to the recorded contentHash (evidence/README.md §3 canonical form);
 *   2. derivedPathPatterns ordering — confirm compareCodeUnits order, not input order;
 *   3. adequacy — require an explicit adequacy finding (ADR-0020 clause 5(a));
 *      hash integrity alone is NOT sufficient and must be recorded as a FAIL
 *      against SC-010, never silently accepted.
 */

/** compareCodeUnits: UTF-16 code-unit ordering. JS relational operators ARE this. */
export function compareCodeUnits(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** README §3 canonical form: object with contentHash removed, keys ascending by
 *  compareCodeUnits, array order preserved, no insignificant whitespace, JSON string
 *  escaping, UTF-8, no trailing newline. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort(compareCodeUnits);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

export function canonicalHash(artifact: Record<string, unknown>): string {
  const { contentHash: _omit, ...rest } = artifact;
  return createHash('sha256').update(Buffer.from(canonicalize(rest), 'utf8')).digest('hex');
}

export interface AuditFinding {
  check: 'content-hash' | 'ordering' | 'adequacy';
  reason: string;
}

export interface AdequacyFinding {
  /** Must be exactly 'adequate' or 'inadequate'; anything else (including absence)
   *  means the audit never reached an adequacy determination. */
  finding?: 'adequate' | 'inadequate';
  reasoning?: string;
}

export interface AuditInput {
  frozenExpectationSet: Record<string, unknown>;
  acceptCorpusFreeze: Record<string, unknown>;
  /** The adequacy finding the auditor recorded. Its ABSENCE is the T021 failure mode. */
  adequacy?: AdequacyFinding;
}

export interface AuditResult {
  ok: boolean;
  findings: AuditFinding[];
}

// Exact reason strings — frozen so the observed-failing tests can match them verbatim.
export const REASON_HASH_DRIFT = 'content hash does not match recomputed canonical hash';
export const REASON_ORDER_NOT_COMPARE_CODE_UNITS =
  'derivedPathPatterns is not in compareCodeUnits order (input order or any other order is inadmissible)';
export const REASON_NO_ADEQUACY =
  'audit confirmed integrity but recorded no adequacy finding — SC-010 requires an explicit adequacy determination, an integrity confirmation alone does not satisfy clause 5(a)';

export function auditOracleFreeze(input: AuditInput): AuditResult {
  const findings: AuditFinding[] = [];

  // 1. content-hash integrity for both artifacts.
  for (const artifact of [input.frozenExpectationSet, input.acceptCorpusFreeze]) {
    const recorded = artifact.contentHash;
    const recomputed = canonicalHash(artifact);
    if (recorded !== recomputed) {
      findings.push({ check: 'content-hash', reason: REASON_HASH_DRIFT });
    }
  }

  // 2. derivedPathPatterns ordering — must be exactly compareCodeUnits-sorted.
  const dpp = input.frozenExpectationSet.derivedPathPatterns;
  if (Array.isArray(dpp)) {
    const sorted = [...(dpp as string[])].sort(compareCodeUnits);
    if (JSON.stringify(dpp) !== JSON.stringify(sorted)) {
      findings.push({ check: 'ordering', reason: REASON_ORDER_NOT_COMPARE_CODE_UNITS });
    }
  } else {
    findings.push({ check: 'ordering', reason: REASON_ORDER_NOT_COMPARE_CODE_UNITS });
  }

  // 3. adequacy — an explicit finding is mandatory (ADR-0020 clause 5(a) / SC-010).
  if (input.adequacy?.finding !== 'adequate' && input.adequacy?.finding !== 'inadequate') {
    findings.push({ check: 'adequacy', reason: REASON_NO_ADEQUACY });
  }

  return { ok: findings.length === 0, findings };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

/** Load the live evidence artifacts and the auditor's recorded adequacy finding. */
export async function auditFromEvidence(evidenceDir: string): Promise<AuditResult> {
  const frozenExpectationSet = await readJson(
    join(evidenceDir, 'frozen-expectations', 'frozen-expectation-set.json'),
  );
  const acceptCorpusFreeze = await readJson(
    join(evidenceDir, 'accept-corpus-freeze', 'accept-corpus-freeze.json'),
  );
  const adequacyAudit = await readJson(
    join(evidenceDir, 'accept-corpus-freeze', 'adequacy-audit.json'),
  );
  const rawFinding = (adequacyAudit.requirement3_adequacyFinding as Record<string, unknown> | undefined)
    ?.finding;
  // The recorded finding is a prose sentence beginning with the verdict word.
  const adequacy: AdequacyFinding =
    typeof rawFinding === 'string' && /^ADEQUATE\b/i.test(rawFinding) && !/^INADEQUATE/i.test(rawFinding)
      ? { finding: 'adequate' }
      : typeof rawFinding === 'string' && /^INADEQUATE\b/i.test(rawFinding)
        ? { finding: 'inadequate' }
        : {};
  return auditOracleFreeze({ frozenExpectationSet, acceptCorpusFreeze, adequacy });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const evidenceDir =
    process.argv[2] ?? join(process.cwd(), 'specs/010-catalog-backstage/evidence');
  const result = await auditFromEvidence(evidenceDir);
  if (result.ok) {
    console.log('audit-oracle-freeze: PASS');
  } else {
    for (const finding of result.findings) {
      console.error(`FAIL [${finding.check}]: ${finding.reason}`);
    }
    process.exitCode = 1;
  }
}
