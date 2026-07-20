/**
 * @adrkit/mcp — the shared tool contract: strict Zod input/output schemas, the
 * fixed annotations, the deterministic text renderer (contracts/tools.md §2.1),
 * and the wire shapes every tool returns. This is the ONE place limits, the text
 * templates, and the envelope live.
 */

import { z } from 'zod';
import { AdrFrontmatter, AdrRef, Status, Scope, type Finding, type FiredMatcher } from '@adrkit/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  loadCorpusProjection,
  CorpusUnavailableError,
  type CorpusHealth,
  type CorpusProjection,
  type CorpusUnavailableReason,
} from '../corpus/projection.ts';
import type { CursorScope, InvalidCursorReason, Page } from '../pagination/cursor.ts';

export type { Finding, FiredMatcher } from '@adrkit/core';
export type { CorpusHealth } from '../corpus/projection.ts';

/* ------------------------------------------------------------------ *
 * Fixed limits (contracts/tools.md §8)
 * ------------------------------------------------------------------ */

export const LIMITS = {
  query: { min: 1, max: 256 },
  ref: { min: 1, max: 128 },
  status: { min: 1, max: 6 },
  scope: { min: 1, max: 3 },
  tags: { min: 1, max: 32 },
  tag: { min: 1, max: 64 },
  fileLength: { min: 1, max: 1024 },
  files: { min: 1, max: 256 },
  page: { min: 1, max: 100, default: 20 },
  cursorBytes: 4 * 1024,
  textCap: 512,
} as const;

/* ------------------------------------------------------------------ *
 * Fixed annotations (contracts/tools.md §2)
 * ------------------------------------------------------------------ */

export const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/* ------------------------------------------------------------------ *
 * Fixed message tables (contracts/tools.md §2.1)
 * ------------------------------------------------------------------ */

export const INVALID_CURSOR_MESSAGES: Record<InvalidCursorReason, string> = {
  'decode-failed': 'Cursor could not be decoded.',
  'version-unsupported': 'Cursor version is not supported.',
  'wrong-channel': 'Cursor does not belong to this tool channel.',
  'corpus-changed': 'Corpus changed after this cursor was issued.',
  'query-mismatch': 'Cursor was issued for different request parameters.',
  'cursor-not-applicable': 'Cursor does not apply to this outcome.',
  'offset-out-of-range': 'Cursor offset is outside the current result set.',
};

export const CORPUS_UNAVAILABLE_MESSAGES: Record<CorpusUnavailableReason, string> = {
  'root-not-found': 'Configured repository root was not found.',
  'root-not-directory': 'Configured repository root is not a directory.',
  'root-not-readable': 'Configured repository root is not readable.',
  'root-not-git': 'Configured repository root is not a Git worktree.',
  'dir-not-found': 'Configured ADR directory was not found.',
  'dir-not-directory': 'Configured ADR directory is not a directory.',
  'dir-not-readable': 'Configured ADR directory is not readable.',
  'dir-outside-root': 'Configured ADR directory resolves outside the repository root.',
  'corpus-changed-during-load': 'Corpus changed while it was being loaded; retry the call.',
};

const INVALID_CURSOR_REASONS = Object.keys(INVALID_CURSOR_MESSAGES) as [InvalidCursorReason, ...InvalidCursorReason[]];
const CORPUS_UNAVAILABLE_REASONS = Object.keys(CORPUS_UNAVAILABLE_MESSAGES) as [
  CorpusUnavailableReason,
  ...CorpusUnavailableReason[],
];

/** `n === 1 ? one : many`. */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Immutable per-server config every tool handler reads to load its projection. */
export interface ToolConfig {
  readonly configuredCwd: string;
  readonly configuredDir: string;
  readonly expectedCanonicalCwd: string;
  readonly maxSourceBytes: number;
}

/* ------------------------------------------------------------------ *
 * Wire shapes (data-model.md §4, §6)
 * ------------------------------------------------------------------ */

export type StatusValue = z.infer<typeof Status>;
export type ScopeValue = z.infer<typeof Scope>;

export interface DecisionSummary {
  readonly id: string;
  readonly title: string;
  readonly status: StatusValue;
  readonly sourcePath: string;
}

export interface RelationRefs {
  readonly supersedes: readonly string[];
  readonly supersededBy: string | null;
  readonly relatesTo: readonly string[];
  readonly conflictsWith: readonly string[];
}

export interface FullDecision {
  readonly requestedRef: string;
  readonly id: string;
  readonly title: string;
  readonly status: StatusValue;
  readonly sourcePath: string;
  readonly frontmatter: z.infer<typeof AdrFrontmatter>;
  readonly body: string;
}

export interface SearchMatch extends DecisionSummary {
  readonly matchedFields: readonly ('id' | 'title' | 'tag' | 'body')[];
}

export interface ContextEntry extends DecisionSummary {
  readonly firedMatchers: readonly FiredMatcher[];
  readonly relations: RelationRefs;
}

export type SupersededByState =
  | { readonly resolved: true; readonly target: DecisionSummary }
  | { readonly resolved: false; readonly targetRef: string; readonly reason: 'dangling' }
  | { readonly resolved: false; readonly targetRef: string; readonly reason: 'ambiguous'; readonly candidateCount: number }
  | {
      readonly resolved: false;
      readonly targetRef: string;
      readonly reason: 'federated-unavailable';
      readonly log: string;
      readonly id: string;
    };

export interface SupersededEntry extends DecisionSummary {
  readonly supersededBy: SupersededByState;
}

export type FindingsPage = Page<Finding>;

export interface InvalidCursorOutcome {
  readonly outcome: 'invalid-cursor';
  readonly reason: InvalidCursorReason;
  readonly message: string;
}

export interface CorpusUnavailableOutcome {
  readonly outcome: 'corpus-unavailable';
  readonly reason: CorpusUnavailableReason;
  readonly message: string;
}

export type SearchDecisionsResult =
  | { outcome: 'results'; items: readonly SearchMatch[]; cursor: string | null; findings: FindingsPage }
  | InvalidCursorOutcome
  | CorpusUnavailableOutcome;

export type GetDecisionResult =
  | { outcome: 'found'; decision: FullDecision; findings: FindingsPage }
  | { outcome: 'not-found'; requestedRef: string; findings: FindingsPage }
  | {
      outcome: 'ambiguous-local-id';
      requestedRef: string;
      candidates: readonly DecisionSummary[];
      cursor: string | null;
      findings: FindingsPage;
    }
  | { outcome: 'federated-log-unavailable'; requestedRef: string; log: string; id: string; findings: FindingsPage }
  | InvalidCursorOutcome
  | CorpusUnavailableOutcome;

export type GetDecisionContextResult =
  | {
      outcome: 'matches';
      governing: readonly ContextEntry[];
      activeProposals: readonly ContextEntry[];
      history: readonly ContextEntry[];
      cursor: string | null;
      findings: FindingsPage;
    }
  | InvalidCursorOutcome
  | CorpusUnavailableOutcome;

export type ListSupersededResult =
  | { outcome: 'entries'; items: readonly SupersededEntry[]; cursor: string | null; findings: FindingsPage }
  | InvalidCursorOutcome
  | CorpusUnavailableOutcome;

/* ------------------------------------------------------------------ *
 * Deterministic text renderer (contracts/tools.md §2.1)
 * ------------------------------------------------------------------ */

export type TextSpec =
  | { kind: 'results'; itemsLength: number; findings: number }
  | { kind: 'found'; id: string; findings: number }
  | { kind: 'not-found'; requestedRef: string; findings: number }
  | { kind: 'ambiguous-local-id'; candidatesLength: number; requestedRef: string; findings: number }
  | { kind: 'federated-log-unavailable'; requestedRef: string; findings: number }
  | { kind: 'matches'; governing: number; activeProposals: number; history: number; findings: number }
  | { kind: 'entries'; itemsLength: number; findings: number }
  | { kind: 'invalid-cursor'; reason: InvalidCursorReason }
  | { kind: 'corpus-unavailable'; reason: CorpusUnavailableReason };

/** Cap a rendered string at 512 UTF-16 code units. */
export function cap512(value: string): string {
  return value.length > LIMITS.textCap ? value.slice(0, LIMITS.textCap) : value;
}

function findingsPhrase(findings: number): string {
  return `${findings} ${plural(findings, 'finding', 'findings')} on this page.`;
}

export function renderResponseText(spec: TextSpec): string {
  let text: string;
  switch (spec.kind) {
    case 'results':
      text = `Returned ${spec.itemsLength} decision ${plural(spec.itemsLength, 'result', 'results')}; ${findingsPhrase(spec.findings)}`;
      break;
    case 'found':
      text = `Found decision "${spec.id}"; ${findingsPhrase(spec.findings)}`;
      break;
    case 'not-found':
      text = `No local decision matches "${spec.requestedRef}"; ${findingsPhrase(spec.findings)}`;
      break;
    case 'ambiguous-local-id':
      text = `Returned ${spec.candidatesLength} ${plural(spec.candidatesLength, 'candidate', 'candidates')} for ambiguous local ref "${spec.requestedRef}"; ${findingsPhrase(spec.findings)}`;
      break;
    case 'federated-log-unavailable':
      text = `Named-log federation is unavailable for "${spec.requestedRef}"; ${findingsPhrase(spec.findings)}`;
      break;
    case 'matches': {
      const pageMatchCount = spec.governing + spec.activeProposals + spec.history;
      text = `Returned ${pageMatchCount} context ${plural(pageMatchCount, 'match', 'matches')}: ${spec.governing} governing, ${spec.activeProposals} active ${plural(spec.activeProposals, 'proposal', 'proposals')}, ${spec.history} historical; ${findingsPhrase(spec.findings)}`;
      break;
    }
    case 'entries':
      text = `Returned ${spec.itemsLength} superseded decision ${plural(spec.itemsLength, 'entry', 'entries')}; ${findingsPhrase(spec.findings)}`;
      break;
    case 'invalid-cursor':
      text = INVALID_CURSOR_MESSAGES[spec.reason];
      break;
    case 'corpus-unavailable':
      text = CORPUS_UNAVAILABLE_MESSAGES[spec.reason];
      break;
  }
  return cap512(text);
}

/* ------------------------------------------------------------------ *
 * Schemas
 * ------------------------------------------------------------------ */

export type ToolInputSchema = z.ZodType;
export type ToolOutputSchema = z.ZodRawShape;

const uniqueArray = <T>(schema: z.ZodType<T>, min: number, max: number) =>
  z
    .array(schema)
    .min(min)
    .max(max)
    .refine((values) => new Set(values.map((v) => JSON.stringify(v))).size === values.length, {
      message: 'Items must be unique',
    });

function paginationShape(): z.ZodRawShape {
  const cursor = z.string().max(LIMITS.cursorBytes).optional();
  const limit = z.number().int().min(LIMITS.page.min).max(LIMITS.page.max).default(LIMITS.page.default);
  return { cursor, limit, findingsCursor: cursor, findingsLimit: limit };
}

function isSafePosixPath(path: string): boolean {
  if (path.includes('\\')) return false;
  if (path.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  if (path.split('/').includes('..')) return false;
  return path.length > 0;
}

export function searchDecisionsInputSchema(): ToolInputSchema {
  return z.strictObject({
    query: z
      .string()
      .min(LIMITS.query.min)
      .max(LIMITS.query.max)
      .refine((q) => q.trim().length >= 1, { message: 'query must be non-empty after trimming' }),
    status: uniqueArray(Status, LIMITS.status.min, LIMITS.status.max).optional(),
    tags: uniqueArray(z.string().min(LIMITS.tag.min).max(LIMITS.tag.max), LIMITS.tags.min, LIMITS.tags.max).optional(),
    scope: uniqueArray(Scope, LIMITS.scope.min, LIMITS.scope.max).optional(),
    ...paginationShape(),
  });
}

export function getDecisionInputSchema(): ToolInputSchema {
  return z.strictObject({
    ref: AdrRef.max(LIMITS.ref.max),
    ...paginationShape(),
  });
}

export function getDecisionContextInputSchema(): ToolInputSchema {
  return z.strictObject({
    files: z
      .array(
        z
          .string()
          .min(LIMITS.fileLength.min)
          .max(LIMITS.fileLength.max)
          .refine(isSafePosixPath, { message: 'files must be repo-relative POSIX paths' }),
      )
      .min(LIMITS.files.min)
      .max(LIMITS.files.max),
    ...paginationShape(),
  });
}

export function listSupersededInputSchema(): ToolInputSchema {
  return z.strictObject({ ...paginationShape() });
}

export function findingSchema(): z.ZodType {
  return z.object({
    rule: z.string(),
    severity: z.enum(['error', 'warn', 'info']),
    message: z.string(),
    path: z.string().optional(),
    id: z.string().optional(),
    field: z.string().optional(),
    pattern: z.string().optional(),
  });
}

export function corpusHealthSchema(): z.ZodType {
  return z.object({
    fingerprint: z.string(),
    recordCount: z.number().int(),
    excludedCount: z.number().int(),
  });
}

function findingsPageSchema(): z.ZodType {
  return z.object({ items: z.array(findingSchema()), cursor: z.string().nullable() });
}

function decisionSummarySchema(): z.ZodType {
  return z.object({ id: z.string(), title: z.string(), status: Status, sourcePath: z.string() });
}

function relationRefsSchema(): z.ZodType {
  return z.object({
    supersedes: z.array(z.string()),
    supersededBy: z.string().nullable(),
    relatesTo: z.array(z.string()),
    conflictsWith: z.array(z.string()),
  });
}

function invalidCursorSchema() {
  return z.object({
    outcome: z.literal('invalid-cursor'),
    reason: z.enum(INVALID_CURSOR_REASONS),
    message: z.string(),
  });
}

function corpusUnavailableSchema() {
  return z.object({
    outcome: z.literal('corpus-unavailable'),
    reason: z.enum(CORPUS_UNAVAILABLE_REASONS),
    message: z.string(),
  });
}

export function searchDecisionsOutputSchema(): ToolOutputSchema {
  const searchMatch = z.object({
    id: z.string(),
    title: z.string(),
    status: Status,
    sourcePath: z.string(),
    matchedFields: z.array(z.enum(['id', 'title', 'tag', 'body'])),
  });
  return {
    corpusHealth: corpusHealthSchema().optional(),
    result: z.discriminatedUnion('outcome', [
      z.object({
        outcome: z.literal('results'),
        items: z.array(searchMatch),
        cursor: z.string().nullable(),
        findings: findingsPageSchema(),
      }),
      invalidCursorSchema(),
      corpusUnavailableSchema(),
    ]),
  };
}

export function getDecisionOutputSchema(): ToolOutputSchema {
  const fullDecision = z.object({
    requestedRef: z.string(),
    id: z.string(),
    title: z.string(),
    status: Status,
    sourcePath: z.string(),
    frontmatter: AdrFrontmatter,
    body: z.string(),
  });
  return {
    corpusHealth: corpusHealthSchema().optional(),
    result: z.discriminatedUnion('outcome', [
      z.object({ outcome: z.literal('found'), decision: fullDecision, findings: findingsPageSchema() }),
      z.object({ outcome: z.literal('not-found'), requestedRef: z.string(), findings: findingsPageSchema() }),
      z.object({
        outcome: z.literal('ambiguous-local-id'),
        requestedRef: z.string(),
        candidates: z.array(decisionSummarySchema()),
        cursor: z.string().nullable(),
        findings: findingsPageSchema(),
      }),
      z.object({
        outcome: z.literal('federated-log-unavailable'),
        requestedRef: z.string(),
        log: z.string(),
        id: z.string(),
        findings: findingsPageSchema(),
      }),
      invalidCursorSchema(),
      corpusUnavailableSchema(),
    ]),
  };
}

export function getDecisionContextOutputSchema(): ToolOutputSchema {
  const contextEntry = z.object({
    id: z.string(),
    title: z.string(),
    status: Status,
    sourcePath: z.string(),
    firedMatchers: z.array(z.object({ type: z.string(), pattern: z.string() })),
    relations: relationRefsSchema(),
  });
  return {
    corpusHealth: corpusHealthSchema().optional(),
    result: z.discriminatedUnion('outcome', [
      z.object({
        outcome: z.literal('matches'),
        governing: z.array(contextEntry),
        activeProposals: z.array(contextEntry),
        history: z.array(contextEntry),
        cursor: z.string().nullable(),
        findings: findingsPageSchema(),
      }),
      invalidCursorSchema(),
      corpusUnavailableSchema(),
    ]),
  };
}

export function listSupersededOutputSchema(): ToolOutputSchema {
  const supersededBy = z.union([
    z.object({ resolved: z.literal(true), target: decisionSummarySchema() }),
    z.object({ resolved: z.literal(false), targetRef: z.string(), reason: z.literal('dangling') }),
    z.object({
      resolved: z.literal(false),
      targetRef: z.string(),
      reason: z.literal('ambiguous'),
      candidateCount: z.number().int(),
    }),
    z.object({
      resolved: z.literal(false),
      targetRef: z.string(),
      reason: z.literal('federated-unavailable'),
      log: z.string(),
      id: z.string(),
    }),
  ]);
  const supersededEntry = z.object({
    id: z.string(),
    title: z.string(),
    status: Status,
    sourcePath: z.string(),
    supersededBy,
  });
  return {
    corpusHealth: corpusHealthSchema().optional(),
    result: z.discriminatedUnion('outcome', [
      z.object({
        outcome: z.literal('entries'),
        items: z.array(supersededEntry),
        cursor: z.string().nullable(),
        findings: findingsPageSchema(),
      }),
      invalidCursorSchema(),
      corpusUnavailableSchema(),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * CallToolResult builder
 * ------------------------------------------------------------------ */

export type StructuredResult = CallToolResult;

export function structuredResult(
  result: unknown,
  text: string,
  corpusHealth: CorpusHealth | undefined,
): CallToolResult {
  const structuredContent = corpusHealth === undefined ? { result } : { corpusHealth, result };
  return { structuredContent, content: [{ type: 'text', text }] };
}

/* ------------------------------------------------------------------ *
 * Handler runtime helpers
 * ------------------------------------------------------------------ */

export function corpusHealthOf(projection: CorpusProjection): CorpusHealth {
  return {
    fingerprint: projection.fingerprint,
    recordCount: projection.recordCount,
    excludedCount: projection.excludedCount,
  };
}

export function invalidCursor(reason: InvalidCursorReason): InvalidCursorOutcome {
  return { outcome: 'invalid-cursor', reason, message: INVALID_CURSOR_MESSAGES[reason] };
}

export function corpusUnavailable(reason: CorpusUnavailableReason): CorpusUnavailableOutcome {
  return { outcome: 'corpus-unavailable', reason, message: CORPUS_UNAVAILABLE_MESSAGES[reason] };
}

export type LoadResult =
  | { readonly ok: true; readonly projection: CorpusProjection }
  | { readonly ok: false; readonly outcome: CorpusUnavailableOutcome };

/** Load the fresh projection, mapping a typed `CorpusUnavailableError` to its outcome. */
export async function loadProjection(config: ToolConfig): Promise<LoadResult> {
  try {
    const projection = await loadCorpusProjection({
      configuredCwd: config.configuredCwd,
      configuredDir: config.configuredDir,
      expectedCanonicalCwd: config.expectedCanonicalCwd,
      maxSourceBytes: config.maxSourceBytes,
    });
    return { ok: true, projection };
  } catch (error) {
    if (error instanceof CorpusUnavailableError) return { ok: false, outcome: corpusUnavailable(error.reason) };
    throw error;
  }
}

/** Every tool derives its DecisionSummary from an Adr record the same way. */
export function toSummary(record: { frontmatter: { id: string; title: string; status: StatusValue }; path: string }): DecisionSummary {
  return {
    id: record.frontmatter.id,
    title: record.frontmatter.title,
    status: record.frontmatter.status,
    sourcePath: record.path,
  };
}

export function toRelationRefs(frontmatter: z.infer<typeof AdrFrontmatter>): RelationRefs {
  return {
    supersedes: frontmatter.supersedes,
    supersededBy: frontmatter.supersededBy ?? null,
    relatesTo: frontmatter.relatesTo,
    conflictsWith: frontmatter.conflictsWith,
  };
}
