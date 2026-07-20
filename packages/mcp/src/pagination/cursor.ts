/**
 * @adrkit/mcp — opaque, versioned, query-bound pagination cursors and the
 * query-shape hash (contracts/pagination-and-cursors.md).
 */

import { createHash } from 'node:crypto';

export type CursorScope =
  | 'search.results'
  | 'search.findings'
  | 'get_decision.candidates'
  | 'get_decision.findings'
  | 'context.results'
  | 'context.findings'
  | 'superseded.results'
  | 'superseded.findings';

export interface CursorPayloadV1 {
  readonly v: 1;
  readonly scope: CursorScope;
  readonly fp: string;
  readonly qh: string;
  readonly offset: number;
}

export type InvalidCursorReason =
  | 'decode-failed'
  | 'version-unsupported'
  | 'wrong-channel'
  | 'corpus-changed'
  | 'query-mismatch'
  | 'cursor-not-applicable'
  | 'offset-out-of-range';

export interface Page<T> {
  readonly items: readonly T[];
  readonly cursor: string | null;
}

const CURSOR_KEYS = ['v', 'scope', 'fp', 'qh', 'offset'] as const;

/** Fixed-field-order base64url(no-pad) UTF-8 JSON — byte-identical for identical payloads. */
export function encodeCursor(payload: CursorPayloadV1): string {
  const json =
    `{"v":1,"scope":${JSON.stringify(payload.scope)},` +
    `"fp":${JSON.stringify(payload.fp)},"qh":${JSON.stringify(payload.qh)},` +
    `"offset":${payload.offset}}`;
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** SHA-256 hex over a fixed-order canonical JSON array of the hashed parameters. */
export function queryShapeHash(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export interface VerifyCursorOptions {
  readonly cursor: string;
  readonly expectedScope: CursorScope;
  readonly fp: string;
  readonly qh: string;
}

export type VerifyCursorResult =
  | { readonly ok: true; readonly offset: number }
  | { readonly ok: false; readonly reason: InvalidCursorReason };

function decodeStrict(
  cursor: string,
): { v: number; scope: string; fp: string; qh: string; offset: number } | undefined {
  let text: string;
  try {
    text = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const keys = Object.keys(parsed);
  if (keys.length !== CURSOR_KEYS.length || !CURSOR_KEYS.every((k) => keys.includes(k))) return undefined;
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.v !== 'number' ||
    typeof obj.scope !== 'string' ||
    typeof obj.fp !== 'string' ||
    typeof obj.qh !== 'string' ||
    typeof obj.offset !== 'number' ||
    !Number.isSafeInteger(obj.offset) ||
    obj.offset < 1
  ) {
    return undefined;
  }
  return { v: obj.v, scope: obj.scope, fp: obj.fp, qh: obj.qh, offset: obj.offset };
}

/** Decode/verify steps 1-6 (pagination §2). */
export function verifyCursor(options: VerifyCursorOptions): VerifyCursorResult {
  const decoded = decodeStrict(options.cursor);
  if (!decoded) return { ok: false, reason: 'decode-failed' };
  if (decoded.v !== 1) return { ok: false, reason: 'version-unsupported' };
  if (decoded.scope !== options.expectedScope) return { ok: false, reason: 'wrong-channel' };
  if (decoded.fp !== options.fp) return { ok: false, reason: 'corpus-changed' };
  if (decoded.qh !== options.qh) return { ok: false, reason: 'query-mismatch' };
  return { ok: true, offset: decoded.offset };
}

export interface PaginateOptions<T> {
  readonly items: readonly T[];
  readonly cursor: string | undefined;
  readonly limit: number;
  readonly scope: CursorScope;
  readonly fp: string;
  readonly qh: string;
}

export type PaginateResult<T> =
  | { readonly ok: true; readonly page: Page<T> }
  | { readonly ok: false; readonly reason: InvalidCursorReason };

/** Full applicable-channel pagination: verify (1-6), range-check (8), slice (9), mint. */
export function paginate<T>(options: PaginateOptions<T>): PaginateResult<T> {
  const { items, cursor, limit, scope, fp, qh } = options;
  let offset = 0;
  if (cursor !== undefined) {
    const verified = verifyCursor({ cursor, expectedScope: scope, fp, qh });
    if (!verified.ok) return { ok: false, reason: verified.reason };
    offset = verified.offset;
    if (offset >= items.length) return { ok: false, reason: 'offset-out-of-range' };
  }
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  const nextCursor = nextOffset < items.length ? encodeCursor({ v: 1, scope, fp, qh, offset: nextOffset }) : null;
  return { ok: true, page: { items: slice, cursor: nextCursor } };
}

export interface InapplicablePrimaryOptions {
  readonly cursor: string | undefined;
  readonly scope: CursorScope;
  readonly fp: string;
  readonly qh: string;
}

export type InapplicablePrimaryResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: InvalidCursorReason };

/** A primary cursor supplied against an outcome with no primary channel (step 7). */
export function checkInapplicablePrimaryCursor(options: InapplicablePrimaryOptions): InapplicablePrimaryResult {
  if (options.cursor === undefined) return { ok: true };
  const verified = verifyCursor({
    cursor: options.cursor,
    expectedScope: options.scope,
    fp: options.fp,
    qh: options.qh,
  });
  if (!verified.ok) return { ok: false, reason: verified.reason };
  return { ok: false, reason: 'cursor-not-applicable' };
}
