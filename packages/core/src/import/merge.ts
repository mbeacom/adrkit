import { stringify } from 'yaml';
import { AdrFrontmatter, SCHEMA_VERSION, type Adr } from '../schema/adr.schema.ts';
import type { Finding } from '../validate/findings.ts';
import type { MadrSourceFile } from './madr.ts';
import { mapMadrStatus } from './status.ts';

export class MadrMergeError extends Error {
  readonly findings: Finding[];

  constructor(message: string, findings: Finding[]) {
    super(message);
    this.name = 'MadrMergeError';
    this.findings = findings;
  }
}

export interface MergeMadrOptions {
  source: MadrSourceFile;
  id: string;
  sourceRef: string;
  fingerprint: string;
}

export interface MergeMadrResult {
  frontmatter: AdrFrontmatter;
  content: string;
  findings: Finding[];
}

type MutableRecord = Record<string, unknown>;

const FALLBACKS: Record<string, unknown> = {
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
};

const OPTIONAL_COPY_KEYS = [
  'created',
  'deciders',
  'consulted',
  'informed',
  'tags',
  'scope',
  'domain',
  'reversibility',
  'blastRadius',
  'supersedes',
  'supersededBy',
  'relatesTo',
  'conflictsWith',
  'affects',
  'assertions',
  'review',
  'evaluation',
  'externalRefs',
  'complianceControls',
  'reviewBy',
] as const;

const OPTIONAL_REMOVE_KEYS = new Set<string>([
  'created',
  'domain',
  'supersededBy',
  'review',
  'evaluation',
  'reviewBy',
]);

const FRONTMATTER_ORDER = [
  'schemaVersion',
  'id',
  'title',
  'status',
  'date',
  'created',
  'deciders',
  'consulted',
  'informed',
  'tags',
  'scope',
  'domain',
  'reversibility',
  'blastRadius',
  'supersedes',
  'supersededBy',
  'relatesTo',
  'conflictsWith',
  'affects',
  'assertions',
  'provenance',
  'review',
  'evaluation',
  'externalRefs',
  'complianceControls',
  'reviewBy',
] as const;

function isRecord(value: unknown): value is MutableRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && /^([0-9]{4,}|[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})$/.test(value);
}

function isValidSchemaVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

function dateFrom(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : undefined;
}

function titleFinding(path: string, id?: string): Finding {
  return {
    rule: 'import-not-madr',
    severity: 'warn',
    message: 'MADR source is missing a usable title',
    path,
    id,
    field: 'title',
  };
}

function importedAtFrom(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const importedFrom = value.importedFrom;
  if (!isRecord(importedFrom)) return undefined;
  return typeof importedFrom.importedAt === 'string' ? importedFrom.importedAt : undefined;
}

function provenanceFrom(raw: MutableRecord, sourceRef: string, fingerprint: string): MutableRecord {
  const sourceProvenance = isRecord(raw.provenance) ? { ...raw.provenance } : {};
  const authoredBy = sourceProvenance.authoredBy;
  if (authoredBy !== 'human' && authoredBy !== 'agent' && authoredBy !== 'agent-drafted') {
    sourceProvenance.authoredBy = 'human';
  }

  const importedFrom: MutableRecord = {
    sourceKind: 'madr',
    sourceRef,
    fingerprint,
  };
  const importedAt = importedAtFrom(sourceProvenance);
  if (importedAt) importedFrom.importedAt = importedAt;

  return {
    ...sourceProvenance,
    importedFrom,
  };
}

function initialCandidate(options: MergeMadrOptions, findings: Finding[]): MutableRecord {
  const raw = options.source.frontmatter;
  const id = isValidId(raw.id) ? raw.id : options.id;
  const title = options.source.title;
  if (!title || title.length < 3 || title.length > 120) {
    throw new MadrMergeError('MADR source is missing a usable title', [titleFinding(options.source.path, id)]);
  }

  const status = mapMadrStatus(raw.status, { path: options.source.path, id });
  findings.push(...status.findings);

  const candidate: MutableRecord = {};
  for (const key of OPTIONAL_COPY_KEYS) {
    if (key in raw) candidate[key] = raw[key];
  }

  candidate.schemaVersion = isValidSchemaVersion(raw.schemaVersion) ? raw.schemaVersion : SCHEMA_VERSION;
  candidate.id = id;
  candidate.title = title;
  candidate.status = status.status;
  candidate.date = dateFrom(raw.date) ?? dateFrom(raw.created) ?? '1970-01-01';

  for (const [key, value] of Object.entries(FALLBACKS)) {
    if (!(key in candidate) || candidate[key] === undefined || candidate[key] === null) {
      candidate[key] = Array.isArray(value) ? [...value] : value;
    }
  }

  candidate.provenance = provenanceFrom(raw, options.sourceRef, options.fingerprint);
  return candidate;
}

function safeParseCandidate(candidate: MutableRecord, sourcePath: string): AdrFrontmatter {
  const working = { ...candidate };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const parsed = AdrFrontmatter.safeParse(working);
    if (parsed.success) return parsed.data;

    let changed = false;
    for (const issue of parsed.error.issues) {
      const top = issue.path[0];
      if (typeof top !== 'string') continue;

      if (top in FALLBACKS) {
        const fallback = FALLBACKS[top];
        working[top] = Array.isArray(fallback) ? [...fallback] : fallback;
        changed = true;
        continue;
      }

      if (OPTIONAL_REMOVE_KEYS.has(top)) {
        delete working[top];
        changed = true;
        continue;
      }

      if (top === 'provenance') {
        working.provenance = candidate.provenance;
        changed = true;
      }
    }

    if (!changed) {
      throw new MadrMergeError(
        `Migrated frontmatter for ${sourcePath} would not satisfy the adrkit schema`,
        parsed.error.issues.map((issue) => ({
          rule: 'import-not-madr',
          severity: 'warn' as const,
          message: issue.message,
          path: sourcePath,
          id: typeof working.id === 'string' ? working.id : undefined,
          field: issue.path.length > 0 ? issue.path.map(String).join('.') : 'frontmatter',
        })),
      );
    }
  }

  throw new MadrMergeError(`Unable to produce valid frontmatter for ${sourcePath}`, [
    {
      rule: 'import-not-madr',
      severity: 'warn',
      message: 'Unable to produce valid frontmatter after removing invalid optional fields',
      path: sourcePath,
      id: typeof working.id === 'string' ? working.id : undefined,
      field: 'frontmatter',
    },
  ]);
}

function orderedObject(value: MutableRecord, order: readonly string[]): MutableRecord {
  const output: MutableRecord = {};
  for (const key of order) {
    if (value[key] !== undefined) output[key] = value[key];
  }
  for (const key of Object.keys(value).sort()) {
    if (!(key in output) && value[key] !== undefined) output[key] = value[key];
  }
  return output;
}

function orderProvenance(provenance: NonNullable<AdrFrontmatter['provenance']>): MutableRecord {
  const output: MutableRecord = {};
  for (const key of ['authoredBy', 'agent', 'ratifiedBy', 'sourceArtifact'] as const) {
    if (provenance[key] !== undefined) output[key] = provenance[key];
  }
  if (provenance.importedFrom) {
    const importedFrom: MutableRecord = {
      sourceKind: provenance.importedFrom.sourceKind,
      sourceRef: provenance.importedFrom.sourceRef,
      fingerprint: provenance.importedFrom.fingerprint,
    };
    if (provenance.importedFrom.importedAt) importedFrom.importedAt = provenance.importedFrom.importedAt;
    output.importedFrom = importedFrom;
  }
  return output;
}

function orderedFrontmatter(frontmatter: AdrFrontmatter): MutableRecord {
  const raw = frontmatter as unknown as MutableRecord;
  const output = orderedObject(raw, FRONTMATTER_ORDER);
  if (frontmatter.provenance) output.provenance = orderProvenance(frontmatter.provenance);
  return output;
}

export function renderMigratedContent(frontmatter: AdrFrontmatter, body: string): string {
  const yaml = stringify(orderedFrontmatter(frontmatter), {
    lineWidth: 0,
    sortMapEntries: false,
  }).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}

export function mergeMadr(options: MergeMadrOptions): MergeMadrResult {
  const findings: Finding[] = [];
  const candidate = initialCandidate(options, findings);
  const frontmatter = safeParseCandidate(candidate, options.source.path);
  return {
    frontmatter,
    content: renderMigratedContent(frontmatter, options.source.body),
    findings,
  };
}

export function recordFromMerge(result: MergeMadrResult, source: MadrSourceFile): Adr {
  return {
    frontmatter: result.frontmatter,
    body: source.body,
    path: source.path,
  };
}
