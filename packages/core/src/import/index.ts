import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parseFrontmatter } from '../parse/frontmatter.ts';
import { isRecordFileName, normalizeDisplayPath } from '../load/corpus.ts';
import { AdrFrontmatter, type Adr } from '../schema/adr.schema.ts';
import { nextSequentialId, slugifyTitle } from '../scaffold/new.ts';
import { sortFindings, type Finding } from '../validate/findings.ts';
import { validateImportIncomplete } from '../validate/import-incomplete.ts';
import { classifyReimport, type ReimportBucket, type ReimportClassification } from './classify.ts';
import { fingerprintSourceBody } from './fingerprint.ts';
import { discoverMadrCandidateFiles, fileNameId, readMadrFile, type MadrSourceFile } from './madr.ts';
import { MadrMergeError, mergeMadr, recordFromMerge } from './merge.ts';

export { classifyReimport } from './classify.ts';
export type { ReimportBucket, ReimportClassification, ReimportSourceEntry } from './classify.ts';
export { fingerprintSourceBody, normalizeSourceBody } from './fingerprint.ts';
export { readMadrFile, discoverMadrCandidateFiles, extractMadrBodyFields, type MadrBodyFields } from './madr.ts';
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
  /**
   * Rename each migrated file to `<id>-<slug>.md` so corpus discovery can see it.
   * Off by default: ADR-0008 makes migration additive and in place, so existing MADR
   * tooling and inbound links keep working. Opt in when the source corpus does not
   * already use `NNNN-` filenames.
   */
  rename?: boolean;
}

export interface MigrateMadrResultItem {
  path: string;
  outcome: MigrateOutcome;
  frontmatter?: AdrFrontmatter;
  /** Set when `rename` moved the record; the new repo-relative path. */
  renamedTo?: string;
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

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function notMadrFinding(path: string, reason: string): Finding {
  return {
    rule: 'import-not-madr',
    severity: 'warn',
    message: reason,
    path,
  };
}

/**
 * A migrated record that corpus discovery cannot see is invisible to `lint`, `graph`,
 * `check`, `explain`, and `queue` — migration reports success while governance covers
 * nothing. Report it at the moment it happens (#41).
 */
function undiscoverableFinding(path: string, id: string, reason: string): Finding {
  return {
    rule: 'import-undiscoverable',
    severity: 'warn',
    message: `Migrated record is not discoverable: ${reason}. Until it is, lint, check, explain, graph, and queue will skip it`,
    path,
    id,
    field: 'path',
  };
}

const UNDISCOVERABLE_FILENAME =
  'its filename does not match <id>-<slug>.md (four or more leading digits) — re-run with --rename, or rename it by hand';
const UNDISCOVERABLE_NESTED =
  'it is in a subdirectory of the corpus, and discovery reads only the top level of the corpus directory — move it up, or point --dir at its directory';

/** Target filename for `--rename`: the corpus grammar, derived from the allocated id. */
function discoverableFileName(id: string, title: string | undefined): string {
  if (!title) return `${id}-record.md`;
  try {
    return `${id}-${slugifyTitle(title)}.md`;
  } catch {
    return `${id}-record.md`;
  }
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
  const rename_ = input.rename === true;
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

  const sorted = prepared.sort((a, b) => a.source.path.localeCompare(b.source.path));
  const writable = sorted.filter((entry) => {
    const bucket: ReimportBucket = classificationForSource.get(entry.sourceRef)?.bucket ?? 'new';
    return bucket !== 'diverged' && bucket !== 'unchanged';
  });

  // Ids are allocated up front, in canonical order, so a `superseded by <ref>` status
  // can be resolved into the id space this run is actually writing rather than the
  // source project's numbering (which is a different namespace entirely).
  const allocatedIds = new Map<string, string>(
    writable.map((entry) => [entry.sourceRef, allocateId(entry.source, classificationForSource.get(entry.sourceRef))]),
  );

  // Built over *every* prepared source, not just the writable ones: in an incremental
  // migration the successor a new record points at was often imported by an earlier run
  // and is now `unchanged`. Its id is known from its classification, so the reference
  // still resolves instead of being downgraded to an unrecognized status.
  const sourceNumberToId = new Map<string, string>();
  for (const entry of sorted) {
    const declared = rawId(entry.source) ?? fileNameId(entry.source.absolutePath);
    if (!declared || sourceNumberToId.has(declared)) continue;
    const resolved = allocatedIds.get(entry.sourceRef) ?? classificationForSource.get(entry.sourceRef)?.recordId;
    if (resolved) sourceNumberToId.set(declared, resolved);
  }
  const resolveSupersededRef = (ref: string): string | undefined => sourceNumberToId.get(ref);

  for (const entry of sorted) {
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
      const id = allocatedIds.get(entry.sourceRef) ?? allocateId(entry.source, classification);

      const sourceDir = dirname(entry.source.absolutePath);
      // Discovery reads only the top level of the corpus directory, so a record in a
      // subdirectory is invisible no matter what it is called — and renaming it in
      // place would not help.
      const isNested = resolve(sourceDir) !== resolve(toAbsolutePath(dir, cwd));
      const targetAbsolutePath = join(sourceDir, discoverableFileName(id, entry.source.title));
      const needsRename = !isNested && !isRecordFileName(basename(entry.source.absolutePath));
      // Never clobber an unrelated file that already occupies the target name.
      const targetTaken =
        targetAbsolutePath !== entry.source.absolutePath && (await pathExists(targetAbsolutePath));
      const willRename = rename_ && needsRename && !targetTaken;
      const finalAbsolutePath = willRename ? targetAbsolutePath : entry.source.absolutePath;
      const finalPath = willRename ? normalizeDisplayPath(finalAbsolutePath, cwd) : entry.source.path;

      // Provenance records where the record ends up, not where it started, so the next
      // run classifies a renamed record as `unchanged` instead of re-importing it.
      const merged = mergeMadr({
        source: entry.source,
        id,
        sourceRef: finalPath,
        fingerprint: entry.fingerprint,
        resolveSupersededRef,
      });
      findings.push(...merged.findings);
      const outcome = bucket === 'updated' ? 'updated' : 'migrated';

      if (write && (merged.content !== entry.source.source || willRename)) {
        await writeFile(entry.source.absolutePath, merged.content, 'utf8');
        if (willRename) await rename(entry.source.absolutePath, finalAbsolutePath);
      }

      // Reported against the path the record actually ends up at, so a `--rename` run
      // is clean and an in-place run points at the file the user has to fix.
      if (isNested) {
        findings.push(undiscoverableFinding(entry.source.path, id, UNDISCOVERABLE_NESTED));
      } else if (needsRename && !willRename) {
        findings.push(undiscoverableFinding(entry.source.path, id, UNDISCOVERABLE_FILENAME));
      }

      results.push({
        path: entry.source.path,
        outcome,
        frontmatter: merged.frontmatter,
        ...(willRename ? { renamedTo: finalPath } : {}),
      });
      recordsForIncomplete.push({ ...recordFromMerge(merged, entry.source), path: finalPath });
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
