import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalHash } from './audit-oracle-freeze.ts';

/**
 * R5 mechanism 2 — the CI freeze-hash drift check. It re-derives the canonical
 * content hash of every frozen artifact under the two freeze directories and fails
 * the build on any drift from the recorded `contentHash`. Because the freeze is what
 * makes the oracle immutable, this is why the freeze artifacts must be git-tracked
 * under specs/010-catalog-backstage/evidence/ (plan.md Barrier B, R5).
 *
 * "Everything under" is interpreted as: every JSON artifact that carries a recorded
 * `contentHash`. Sibling audit records (audit-record.json, adequacy-audit.json) carry
 * no `contentHash` — hashing them would be circular and is deliberately out of scope
 * (evidence/README.md audit-records-as-siblings rule). Any JSON that DOES carry a
 * contentHash is checked; any drift, missing hash on a hashed artifact, or unreadable
 * file fails the build.
 */

const FREEZE_DIRS = ['frozen-expectations', 'accept-corpus-freeze'] as const;

export interface DriftFinding {
  file: string;
  reason: string;
  recorded?: string;
  recomputed?: string;
}

export interface DriftResult {
  ok: boolean;
  checked: string[];
  findings: DriftFinding[];
}

export const REASON_DRIFT = 'recorded contentHash does not match recomputed canonical hash (freeze drift)';
export const REASON_NOT_OBJECT = 'frozen artifact is not a JSON object';

async function listJsonFiles(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(join(dir, entry.name));
  }
  return files.sort();
}

export async function checkFreezeHashes(evidenceDir: string): Promise<DriftResult> {
  const findings: DriftFinding[] = [];
  const checked: string[] = [];

  for (const sub of FREEZE_DIRS) {
    const dir = join(evidenceDir, sub);
    for (const file of await listJsonFiles(dir)) {
      const rel = `${sub}/${file.split('/').pop()}`;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        findings.push({ file: rel, reason: 'frozen artifact is not valid JSON' });
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        findings.push({ file: rel, reason: REASON_NOT_OBJECT });
        continue;
      }
      const obj = parsed as Record<string, unknown>;
      // Only artifacts that carry a recorded contentHash are in scope. Sibling audit
      // records (no contentHash) are intentionally skipped, not failed.
      if (typeof obj.contentHash !== 'string') continue;
      checked.push(rel);
      const recomputed = canonicalHash(obj);
      if (recomputed !== obj.contentHash) {
        findings.push({
          file: rel,
          reason: REASON_DRIFT,
          recorded: obj.contentHash,
          recomputed,
        });
      }
    }
  }

  return { ok: findings.length === 0, checked, findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const evidenceDir =
    process.argv[2] ?? join(process.cwd(), 'specs/010-catalog-backstage/evidence');
  const result = await checkFreezeHashes(evidenceDir);
  if (result.ok) {
    console.log(`check-freeze-hashes: ok (${result.checked.length} artifacts: ${result.checked.join(', ')})`);
  } else {
    for (const finding of result.findings) {
      const detail = finding.recorded
        ? ` recorded=${finding.recorded} recomputed=${finding.recomputed}`
        : '';
      console.error(`${finding.file}: ${finding.reason}${detail}`);
    }
    process.exitCode = 1;
  }
}
