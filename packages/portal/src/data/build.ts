/**
 * The pure builder of `portal-data.json`
 * ([ADR-0054](../../../../docs/adr/0054-publish-a-static-decision-portal-for-github-pages-built-outside-the-cli-from-the.md)
 * clause 3), and its canonical serializer.
 *
 * **Pure, and it must stay pure**: ADR-0055's server calls {@link buildPortalData} directly,
 * per request. It reads no clock, file, or environment, spawns nothing, and touches no
 * network. Everything arrives as an argument: the SDK handle, the commit, `asOf`, and the
 * already-resolved path table. `test/purity.test.ts` asserts it both statically (imports and
 * forbidden globals) and at run time (the clock, `process`, and `fetch` stubbed to throw).
 *
 * The only SDK import is a **type** import; the handle's methods are called, never imported.
 */

import type {
  CorpusIssue,
  DecisionRecord,
  DecisionSet,
  GoverningDecision,
  PathGovernance,
  QueueEntry,
} from '@adrkit/sdk/src/index.ts';
import {
  PORTAL_DATA_VERSION,
  type PortalData,
  type PortalIssue,
  type PortalPathDecision,
  type PortalPathEntry,
  type PortalPathLookup,
  type PortalPathTable,
  type PortalPathTableAvailable,
  type PortalPathTableCaps,
  type PortalQueueEntry,
  type PortalRecord,
} from './contract.ts';
import { parseMarkdown } from './markdown.ts';

/**
 * The part of an `@adrkit/sdk` handle the builder reads. Narrower than `DecisionSet` on
 * purpose: `governing` is absent, because the path table arrives already resolved, and a
 * builder that could call it would be one that could read files.
 */
export type PortalDataSource = Pick<DecisionSet, 'records' | 'issues' | 'graph' | 'queue'>;

export interface BuildPortalDataOptions {
  /** Corpus directory, repository-relative POSIX, no leading `./` or trailing `/`. */
  readonly dir: string;
  /** 40- or 64-character lowercase hex commit, or `null` when unknown. */
  readonly commit: string | null;
  /** UTC calendar date `YYYY-MM-DD` for the queue's SLA states. Required: the builder never reads a clock. */
  readonly asOf: string;
  /** The resolved path table (see `buildPathTable`), `{ state: 'unavailable', … }`, or `{ state: 'absent' }`. */
  readonly pathTable: PortalPathTable;
  /**
   * Where this host answers one path per request, or `null` (the default). Only ADR-0055's
   * server passes one, and only beside an `absent` path table. Written as `pathLookup`.
   */
  readonly pathLookup?: PortalPathLookup | null;
}

const ALL_EDGE_KINDS = ['supersedes', 'relatesTo', 'conflictsWith'] as const;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * A page-relative route with no query, fragment, scheme, or root: `./` or `../` steps, then
 * plain segments. The page shows it as text, but a host still cannot publish something that
 * reads as an absolute URL or carries markup-looking characters.
 */
const LOOKUP_ROUTE = /^(?:\.\.?\/)*(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const LOOKUP_ROUTE_MAX = 512;

/**
 * Build `portal-data.json` v1 from an SDK handle. Same inputs, byte-identical
 * {@link serializePortalData} output.
 *
 * Throws `TypeError` for malformed options (a `pathLookup` beside a table that is not
 * `absent` among them), and for one inconsistent combination: an `available` path table
 * over a corpus with an error-severity issue. With corpus errors the
 * SDK's `governing` answers every path with empty groups, so such a table would present a
 * confident "nothing governs this" for every file (clause 6). The caller must pass
 * `unavailable` (or `absent`) instead. Any `RangeError` from `handle.queue` (a malformed
 * `asOf`) propagates.
 */
export function buildPortalData(handle: PortalDataSource, options: BuildPortalDataOptions): PortalData {
  const { dir, commit, asOf, pathTable } = options;
  const pathLookup = pathLookupOf(options.pathLookup ?? null);
  if (typeof dir !== 'string' || dir.length === 0) throw new TypeError('dir must be a non-empty string');
  if (commit !== null && (typeof commit !== 'string' || !COMMIT.test(commit))) {
    throw new TypeError('commit must be a 40- or 64-character lowercase hex string, or null');
  }
  if (typeof asOf !== 'string' || !CALENDAR_DATE.test(asOf)) throw new TypeError('asOf must be a YYYY-MM-DD string');

  const issues = handle.issues.map(issueOf);
  const hasCorpusError = issues.some((issue) => issue.severity === 'error');
  const table = pathTableOf(pathTable);
  if (hasCorpusError && table.state === 'available') {
    throw new TypeError("an available path table is inconsistent with a corpus that has errors; pass state 'unavailable'");
  }
  if (pathLookup !== null && table.state !== 'absent') {
    throw new TypeError("a pathLookup hint is only for a host with no path table; pass pathTable state 'absent'");
  }

  const recordPaths = new Map<string, string>();
  for (const record of handle.records) recordPaths.set(record.path, record.id);
  const graph = handle.graph({ kinds: ALL_EDGE_KINDS });
  const queue = handle.queue({ asOf });

  return {
    version: PORTAL_DATA_VERSION,
    dir,
    commit,
    asOf: queue.asOf,
    records: handle.records.map((record) => recordOf(record, recordPaths)),
    issues,
    graph: {
      nodes: graph.nodes.map((node) => ({ id: node.id, title: node.title, status: node.status })),
      edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind })),
    },
    queue: queue.entries.map(queueEntryOf),
    pathTable: table,
    pathLookup,
  };
}

/** Rebuild the lookup hint from its known field only, after checking the route's shape. */
function pathLookupOf(lookup: PortalPathLookup | null): PortalPathLookup | null {
  if (lookup === null) return null;
  const route = (lookup as { route?: unknown } | undefined)?.route;
  if (typeof route !== 'string' || route.length > LOOKUP_ROUTE_MAX || !LOOKUP_ROUTE.test(route)) {
    throw new TypeError('pathLookup.route must be a page-relative path with no query, fragment, or scheme');
  }
  return { route };
}

function recordOf(record: DecisionRecord, recordPaths: ReadonlyMap<string, string>): PortalRecord {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    standing: record.standing,
    date: record.date,
    path: record.path,
    tags: [...record.tags],
    supersedes: [...record.supersedes],
    supersededBy: record.supersededBy ?? null,
    body: parseMarkdown(record.body, { basePath: record.path, recordPaths }),
  };
}

function issueOf(issue: CorpusIssue): PortalIssue {
  return { code: issue.code, severity: issue.severity, message: issue.message, path: issue.path ?? null };
}

function queueEntryOf(entry: QueueEntry): PortalQueueEntry {
  return {
    id: entry.id,
    title: entry.title,
    path: entry.path,
    tier: entry.tier,
    slaState: entry.slaState,
    deadline: entry.deadline,
    approvalCount: entry.approvalCount,
    quorum: entry.quorum,
    unresolvedObjectionCount: entry.unresolvedObjectionCount,
    resolvedObjectionCount: entry.resolvedObjectionCount,
    routingTargets: [...entry.routingTargets],
    itemFindingCount: entry.itemFindingCount,
  };
}

/** Rebuild a path table from its known fields only, so nothing extra a caller attached is published. */
function pathTableOf(table: PortalPathTable): PortalPathTable {
  switch (table?.state) {
    case 'absent':
      return { state: 'absent' };
    case 'unavailable':
      if (table.reason !== 'corpus-errors') throw new TypeError(`unknown path table reason: ${String(table.reason)}`);
      return { state: 'unavailable', reason: 'corpus-errors' };
    case 'available':
      if (!Number.isSafeInteger(table.governedPathCount) || table.governedPathCount < table.entries.length) {
        throw new TypeError('pathTable.governedPathCount must be an integer no smaller than the entry count');
      }
      return {
        state: 'available',
        capped: table.capped === true,
        caps: checkedCaps(table.caps),
        governedPathCount: table.governedPathCount,
        entries: table.entries.map((entry) => ({
          path: entry.path,
          governing: entry.governing.map(pathDecisionCopy),
          activeProposals: entry.activeProposals.map(pathDecisionCopy),
          history: entry.history.map(pathDecisionCopy),
        })),
      };
    default:
      throw new TypeError('pathTable.state must be available, unavailable, or absent');
  }
}

function pathDecisionCopy(decision: PortalPathDecision): PortalPathDecision {
  return { id: decision.id, evidence: [...decision.evidence] };
}

/* ------------------------------------------------------------------ *
 * The path table (clause 6)
 * ------------------------------------------------------------------ */

/** Default caps: generous for a monorepo, small enough that a page can load the file. */
export const DEFAULT_PATH_TABLE_CAPS: PortalPathTableCaps = Object.freeze({ count: 20_000, bytes: 4 * 1024 * 1024 });

function checkedCaps(caps: PortalPathTableCaps): PortalPathTableCaps {
  for (const key of ['count', 'bytes'] as const) {
    if (!Number.isSafeInteger(caps?.[key]) || caps[key] < 0) {
      throw new TypeError(`path table caps.${key} must be a non-negative safe integer`);
    }
  }
  return { count: caps.count, bytes: caps.bytes };
}

function pathDecisionOf(decision: GoverningDecision): PortalPathDecision {
  const kinds = new Set(decision.matchedBy.map((evidence) => evidence.kind));
  return { id: decision.id, evidence: (['affects', 'marker'] as const).filter((kind) => kinds.has(kind)) };
}

/**
 * Build an `available` path table from per-path SDK answers (`handle.governing(path)` for
 * each tracked file). Pure: the caller does the resolving.
 *
 * Keeps the paths at least one decision reaches, sorts them by path in code-unit order, then
 * keeps the longest prefix within both caps — the entry count, and the UTF-8 byte length of
 * the `entries` array as {@link canonicalJson} writes it. The same tree therefore always
 * drops the same tail, and `capped` says whether anything was dropped.
 */
export function buildPathTable(
  resolutions: Iterable<PathGovernance>,
  caps: PortalPathTableCaps = DEFAULT_PATH_TABLE_CAPS,
): PortalPathTableAvailable {
  const limits = checkedCaps(caps);
  const governed: PortalPathEntry[] = [];
  for (const resolution of resolutions) {
    const entry: PortalPathEntry = {
      path: resolution.path,
      governing: resolution.governing.map(pathDecisionOf),
      activeProposals: resolution.activeProposals.map(pathDecisionOf),
      history: resolution.history.map(pathDecisionOf),
    };
    if (entry.governing.length + entry.activeProposals.length + entry.history.length > 0) governed.push(entry);
  }
  governed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const entries: PortalPathEntry[] = [];
  let bytes = 2; // "[]"
  for (const entry of governed) {
    const size = utf8Length(canonicalJson(entry)) + (entries.length > 0 ? 1 : 0);
    if (entries.length >= limits.count || bytes + size > limits.bytes) break;
    entries.push(entry);
    bytes += size;
  }
  return {
    state: 'available',
    capped: entries.length < governed.length,
    caps: limits,
    governedPathCount: governed.length,
    entries,
  };
}

/** UTF-8 byte length of a well-formed string (canonical JSON never holds a lone surrogate). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

/* ------------------------------------------------------------------ *
 * Canonical serialization
 * ------------------------------------------------------------------ */

/**
 * Canonical JSON: object keys sorted by code unit, no whitespace. Throws `TypeError` on
 * `undefined`, a function, a non-finite number, or any non-plain value, so the contract's
 * "no optional fields" rule fails loudly instead of silently dropping a key.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('canonicalJson: non-plain object');
      const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const record = value as Record<string, unknown>;
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
  }
}

/** The bytes of `portal-data.json`: {@link canonicalJson} plus a trailing newline. */
export function serializePortalData(data: PortalData): string {
  return `${canonicalJson(data)}\n`;
}
