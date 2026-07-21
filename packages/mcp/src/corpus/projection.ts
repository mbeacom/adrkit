/**
 * @adrkit/mcp — the per-call, in-memory corpus projection (data-model.md §3, §8).
 *
 * Rebuilt from scratch on every tool call: fresh canonical-root validation, the
 * pre-read 64 KiB size guard, `discoverAdrFiles` + `lintCorpus`, a local multi-valued
 * `byId` index, immutable corpus findings, and a canonical SHA-256 fingerprint.
 * No cache, index, or database of any kind.
 */

import { access, constants as FS, lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  discoverAdrFiles,
  fingerprintOf,
  lintCorpus,
  normalizeDisplayPath,
  type Adr,
  type Finding,
} from '@adrkit/core';
import { compareCodeUnits, sortFindingsCanonical } from './ordering.ts';

export const MAX_SOURCE_BYTES = 64 * 1024;

export type CorpusUnavailableReason =
  | 'root-not-found'
  | 'root-not-directory'
  | 'root-not-readable'
  | 'root-not-git'
  | 'dir-not-found'
  | 'dir-not-directory'
  | 'dir-not-readable'
  | 'dir-outside-root'
  | 'corpus-changed-during-load';

/** Typed rejection carrying one of the `CorpusUnavailableOutcome` reasons (data-model.md §5). */
export class CorpusUnavailableError extends Error {
  readonly reason: CorpusUnavailableReason;
  constructor(reason: CorpusUnavailableReason) {
    super(reason);
    this.name = 'CorpusUnavailableError';
    this.reason = reason;
  }
}

export interface CorpusHealth {
  readonly fingerprint: string;
  readonly recordCount: number;
  readonly excludedCount: number;
}

export interface CorpusProjection {
  readonly records: readonly Adr[];
  readonly byId: ReadonlyMap<string, readonly Adr[]>;
  readonly corpusFindings: readonly Finding[];
  readonly fingerprint: string;
  readonly recordCount: number;
  readonly excludedCount: number;
}

function fail(reason: CorpusUnavailableReason): never {
  throw new CorpusUnavailableError(reason);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

/** Path-segment-safe containment on two ALREADY-canonical paths (never a string prefix). */
function isContained(parent: string, child: string): boolean {
  if (parent === child) return true;
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export interface ResolveCanonicalRootsOptions {
  readonly cwd: string;
  readonly dir: string;
}

export interface CanonicalRoots {
  readonly canonicalCwd: string;
  readonly canonicalDir: string;
}

/** The one canonicalization/containment routine both `start()` and every load call use. */
export async function resolveCanonicalRoots(options: ResolveCanonicalRootsOptions): Promise<CanonicalRoots> {
  let canonicalCwd: string;
  try {
    canonicalCwd = await realpath(options.cwd);
  } catch (error) {
    fail(errorCode(error) === 'ENOENT' ? 'root-not-found' : 'root-not-readable');
  }

  try {
    const info = await stat(canonicalCwd);
    if (!info.isDirectory()) fail('root-not-directory');
  } catch (error) {
    if (error instanceof CorpusUnavailableError) throw error;
    fail(errorCode(error) === 'ENOENT' ? 'root-not-found' : 'root-not-readable');
  }
  try {
    await access(canonicalCwd, FS.R_OK | FS.X_OK);
  } catch {
    fail('root-not-readable');
  }

  const gitEntry = resolve(canonicalCwd, '.git');
  try {
    await stat(gitEntry);
    await access(gitEntry, FS.R_OK);
  } catch {
    fail('root-not-git');
  }

  const dirInput = isAbsolute(options.dir) ? options.dir : resolve(canonicalCwd, options.dir);
  let canonicalDir: string;
  try {
    canonicalDir = await realpath(dirInput);
  } catch (error) {
    fail(errorCode(error) === 'ENOENT' ? 'dir-not-found' : 'dir-not-readable');
  }

  try {
    const info = await stat(canonicalDir);
    if (!info.isDirectory()) fail('dir-not-directory');
  } catch (error) {
    if (error instanceof CorpusUnavailableError) throw error;
    fail(errorCode(error) === 'ENOENT' ? 'dir-not-found' : 'dir-not-readable');
  }
  try {
    await access(canonicalDir, FS.R_OK | FS.X_OK);
  } catch {
    fail('dir-not-readable');
  }

  if (!isContained(canonicalCwd, canonicalDir)) fail('dir-outside-root');

  return { canonicalCwd, canonicalDir };
}

export interface LoadCorpusProjectionOptions {
  readonly configuredCwd: string;
  readonly configuredDir: string;
  readonly expectedCanonicalCwd: string;
  readonly maxSourceBytes: number;
}

interface KeptCandidate {
  readonly absolutePath: string;
  readonly displayPath: string;
  readonly identity: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint };
}

function statError(displayPath: string): Finding {
  return {
    rule: 'record-stat-error',
    severity: 'error',
    path: displayPath,
    message: 'ADR candidate could not be read to validate its size and was excluded from this response',
  };
}

function tooLarge(displayPath: string): Finding {
  return {
    rule: 'record-too-large',
    severity: 'error',
    path: displayPath,
    message: 'ADR source exceeds the 64 KiB maximum and was excluded from this response',
  };
}

async function verifyRoots(options: LoadCorpusProjectionOptions): Promise<CanonicalRoots> {
  const roots = await resolveCanonicalRoots({ cwd: options.configuredCwd, dir: options.configuredDir });
  if (roots.canonicalCwd !== options.expectedCanonicalCwd) fail('root-not-found');
  return roots;
}

/** The one entry point every tool handler calls, fresh, at the start of its execution. */
export async function loadCorpusProjection(options: LoadCorpusProjectionOptions): Promise<CorpusProjection> {
  const roots = await verifyRoots(options);

  let candidates: string[];
  try {
    candidates = await discoverAdrFiles(roots.canonicalDir, roots.canonicalCwd);
  } catch (error) {
    fail(errorCode(error) === 'ENOENT' ? 'dir-not-found' : 'dir-not-readable');
  }

  const preReadFindings: Finding[] = [];
  const kept: KeptCandidate[] = [];

  for (const candidate of candidates) {
    const displayPath = normalizeDisplayPath(candidate, roots.canonicalCwd);
    try {
      const link = await lstat(candidate);
      if (link.isSymbolicLink() || !link.isFile()) {
        preReadFindings.push(statError(displayPath));
        continue;
      }
      const real = await realpath(candidate);
      if (!isContained(roots.canonicalDir, real)) {
        preReadFindings.push(statError(displayPath));
        continue;
      }
      const info = await stat(candidate, { bigint: true });
      if (Number(info.size) > options.maxSourceBytes) {
        preReadFindings.push(tooLarge(displayPath));
        continue;
      }
      kept.push({
        absolutePath: candidate,
        displayPath,
        identity: { dev: info.dev, ino: info.ino, size: info.size, mtimeNs: info.mtimeNs },
      });
    } catch {
      preReadFindings.push(statError(displayPath));
    }
  }

  // Never call lintCorpus with an empty paths array: expandRecordInputs would
  // re-discover the whole directory and reinstate the excluded files (data-model.md §3.3).
  let records: Adr[] = [];
  let lintFindings: Finding[] = [];
  if (kept.length > 0) {
    const result = await lintCorpus({ paths: kept.map((k) => k.absolutePath), cwd: roots.canonicalCwd });
    records = result.records;
    lintFindings = result.findings;
  }

  // Post-load revalidation: roots plus every kept candidate's type, containment, and identity.
  const postRoots = await verifyRoots(options);
  if (postRoots.canonicalDir !== roots.canonicalDir) fail('corpus-changed-during-load');
  for (const candidate of kept) {
    try {
      const link = await lstat(candidate.absolutePath);
      if (link.isSymbolicLink() || !link.isFile()) fail('corpus-changed-during-load');
      const real = await realpath(candidate.absolutePath);
      if (!isContained(postRoots.canonicalDir, real)) fail('corpus-changed-during-load');
      const info = await stat(candidate.absolutePath, { bigint: true });
      if (Number(info.size) > options.maxSourceBytes) fail('corpus-changed-during-load');
      if (
        info.dev !== candidate.identity.dev ||
        info.ino !== candidate.identity.ino ||
        info.size !== candidate.identity.size ||
        info.mtimeNs !== candidate.identity.mtimeNs
      ) {
        fail('corpus-changed-during-load');
      }
    } catch (error) {
      if (error instanceof CorpusUnavailableError) throw error;
      fail('corpus-changed-during-load');
    }
  }

  const orderedRecords = [...records].sort(
    (a, b) => compareCodeUnits(a.frontmatter.id, b.frontmatter.id) || compareCodeUnits(a.path, b.path),
  );

  const byId = new Map<string, Adr[]>();
  for (const record of orderedRecords) {
    const bucket = byId.get(record.frontmatter.id) ?? [];
    bucket.push(record);
    byId.set(record.frontmatter.id, bucket);
  }
  // Each bucket inherits `orderedRecords`' canonical (id, sourcePath) order already.

  const corpusFindings = sortFindingsCanonical([...lintFindings, ...preReadFindings]);
  const recordCount = orderedRecords.length;
  const excludedCount = candidates.length - recordCount;
  const fingerprint = fingerprintOf(orderedRecords, corpusFindings, recordCount, excludedCount);

  return {
    records: orderedRecords,
    byId,
    corpusFindings,
    fingerprint,
    recordCount,
    excludedCount,
  };
}
