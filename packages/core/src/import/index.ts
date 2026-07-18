import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { parseFrontmatter } from '../parse/frontmatter.ts';
import { normalizeDisplayPath } from '../load/corpus.ts';
import { AdrFrontmatter, type Adr } from '../schema/adr.schema.ts';
import { nextSequentialId } from '../scaffold/new.ts';
import { sortFindings, type Finding } from '../validate/findings.ts';
import { validateImportIncomplete } from '../validate/import-incomplete.ts';
import { classifyReimport, type ReimportBucket, type ReimportClassification } from './classify.ts';
import { fingerprintSourceBody } from './fingerprint.ts';
import { discoverMadrCandidateFiles, fileNameId, readMadrFile, type MadrSourceFile } from './madr.ts';
import { MadrMergeError, mergeMadr, recordFromMerge } from './merge.ts';

export { classifyReimport } from './classify.ts';
export type { ReimportBucket, ReimportClassification, ReimportSourceEntry } from './classify.ts';
export { fingerprintSourceBody, normalizeSourceBody } from './fingerprint.ts';
export { readMadrFile, discoverMadrCandidateFiles } from './madr.ts';
export { mapMadrStatus } from './status.ts';
export { mergeMadr, renderMigratedContent } from './merge.ts';

export type MigrateOutcome = 'migrated' | 'updated' | 'unchanged' | 'diverged' | 'skipped';

export interface MigrateMadrInput {
  dir?: string;
  files?: string[];
  existingRecords?: Adr[];
  recordEdited?: (id: string) => boolean;
  cwd?: string;
  write?: boolean;
}

export interface MigrateMadrResultItem {
  path: string;
  outcome: MigrateOutcome;
  frontmatter?: AdrFrontmatter;
}

export interface MigrateMadrDivergenceItem {
  path: string;
  sourceRef: string;
}

export interface MigrateMadrResult {
  results: MigrateMadrResultItem[];
  divergence: MigrateMadrDivergenceItem[];
  findings: Finding[];
}

interface PreparedSource {
  source: MadrSourceFile;
  sourceRef: string;
  fingerprint: string;
}

function toAbsolutePath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function notMadrFinding(path: string, reason: string): Finding {
  return {
    rule: 'import-not-madr',
    severity: 'warn',
    message: reason,
    path,
  };
}

async function existingRecordsFromFiles(files: readonly string[], cwd: string): Promise<Adr[]> {
  const records: Adr[] = [];
  for (const file of files) {
    const absolutePath = toAbsolutePath(file, cwd);
    try {
      const source = await readFile(absolutePath, 'utf8');
      const parsed = parseFrontmatter(source);
      const frontmatter = AdrFrontmatter.safeParse(parsed.data);
      if (frontmatter.success) {
        records.push({
          frontmatter: frontmatter.data,
          body: parsed.body,
          path: normalizeDisplayPath(absolutePath, cwd),
        });
      }
    } catch {
      // Non-ADR sources are handled by the MADR reader; this loader is best-effort.
    }
  }
  return records.sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id));
}

function recordById(records: readonly Adr[]): Map<string, Adr> {
  return new Map(records.map((record) => [record.frontmatter.id, record]));
}

function classifyBySourceRef(classifications: readonly ReimportClassification[]): Map<string, ReimportClassification> {
  return new Map(classifications.map((classification) => [classification.sourceRef, classification]));
}

function numericId(id: string): number | undefined {
  return /^\d+$/.test(id) ? Number(id) : undefined;
}

function rawId(source: MadrSourceFile): string | undefined {
  const id = source.frontmatter.id;
  return typeof id === 'string' && /^([0-9]{4,}|[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})$/.test(id) ? id : undefined;
}

function createIdAllocator(seed: string, usedIds: Iterable<string>): (source: MadrSourceFile, classification?: ReimportClassification) => string {
  const used = new Set(usedIds);
  let next = numericId(seed) ?? 1;

  return (source, classification) => {
    const existing = classification?.recordId;
    if (existing) return existing;

    const sourceId = rawId(source);
    if (sourceId) {
      used.add(sourceId);
      return sourceId;
    }

    const fileId = fileNameId(source.absolutePath);
    if (fileId && !used.has(fileId)) {
      used.add(fileId);
      return fileId;
    }

    for (;;) {
      const id = String(next).padStart(4, '0');
      next += 1;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
}

function importIncompleteRecords(records: readonly Adr[]): Adr[] {
  const seen = new Set<string>();
  const unique: Adr[] = [];
  for (const record of records) {
    const key = `${record.frontmatter.id}\0${record.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
  }
  return unique;
}

export async function migrateMadr(input: MigrateMadrInput): Promise<MigrateMadrResult> {
  const cwd = input.cwd ?? process.cwd();
  const dir = input.dir ?? 'docs/adr';
  const write = input.write !== false;
  const files = input.files
    ? input.files.map((file) => toAbsolutePath(file, cwd)).sort((a, b) => normalizeDisplayPath(a, cwd).localeCompare(normalizeDisplayPath(b, cwd)))
    : await discoverMadrCandidateFiles(dir, cwd);

  const findings: Finding[] = [];
  const results: MigrateMadrResultItem[] = [];
  const divergence: MigrateMadrDivergenceItem[] = [];
  const prepared: PreparedSource[] = [];

  for (const file of files) {
    const read = await readMadrFile(file, cwd);
    if (read.kind === 'not-madr') {
      results.push({ path: read.path, outcome: 'skipped' });
      findings.push(notMadrFinding(read.path, read.reason));
      continue;
    }
    const sourceRef = read.path;
    prepared.push({ source: read, sourceRef, fingerprint: fingerprintSourceBody(read.body) });
  }

  const existingRecords = input.existingRecords ?? (await existingRecordsFromFiles(files, cwd));
  const classifications = classifyReimport(
    prepared.map((entry) => ({ sourceRef: entry.sourceRef, fingerprint: entry.fingerprint, path: entry.source.path })),
    existingRecords,
    input.recordEdited ?? (() => false),
  );
  const classificationForSource = classifyBySourceRef(classifications);
  const existingById = recordById(existingRecords);
  const seed = await nextSequentialId(dir, cwd).catch(() => '0001');
  const allocateId = createIdAllocator(seed, [
    ...existingRecords.map((record) => record.frontmatter.id),
    ...prepared.map((entry) => rawId(entry.source)).filter((id): id is string => Boolean(id)),
  ]);
  const recordsForIncomplete: Adr[] = [];

  for (const entry of prepared.sort((a, b) => a.source.path.localeCompare(b.source.path))) {
    const classification = classificationForSource.get(entry.sourceRef);
    const bucket: ReimportBucket = classification?.bucket ?? 'new';

    if (bucket === 'diverged') {
      results.push({ path: entry.source.path, outcome: 'diverged' });
      divergence.push({ path: entry.source.path, sourceRef: entry.sourceRef });
      const existing = classification?.recordId ? existingById.get(classification.recordId) : undefined;
      if (existing) recordsForIncomplete.push(existing);
      continue;
    }

    if (bucket === 'unchanged') {
      results.push({ path: entry.source.path, outcome: 'unchanged' });
      const existing = classification?.recordId ? existingById.get(classification.recordId) : undefined;
      if (existing) recordsForIncomplete.push(existing);
      continue;
    }

    try {
      const id = allocateId(entry.source, classification);
      const merged = mergeMadr({
        source: entry.source,
        id,
        sourceRef: entry.sourceRef,
        fingerprint: entry.fingerprint,
      });
      findings.push(...merged.findings);
      const outcome = bucket === 'updated' ? 'updated' : 'migrated';
      if (write && merged.content !== entry.source.source) {
        await writeFile(entry.source.absolutePath, merged.content, 'utf8');
      }
      results.push({ path: entry.source.path, outcome, frontmatter: merged.frontmatter });
      recordsForIncomplete.push(recordFromMerge(merged, entry.source));
    } catch (error) {
      if (error instanceof MadrMergeError) {
        results.push({ path: entry.source.path, outcome: 'skipped' });
        findings.push(...error.findings);
        continue;
      }
      throw error;
    }
  }

  findings.push(...validateImportIncomplete(importIncompleteRecords(recordsForIncomplete)));

  return {
    results: results.sort((a, b) => a.path.localeCompare(b.path)),
    divergence: divergence.sort((a, b) => a.path.localeCompare(b.path) || a.sourceRef.localeCompare(b.sourceRef)),
    findings: sortFindings(findings),
  };
}
