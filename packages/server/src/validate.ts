/**
 * Validation of everything a request carries, before any SDK call
 * ([ADR-0055](../../../docs/adr/0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-th.md)
 * clauses 7 and 8). Pure: no clock (the caller passes `now`), file, or environment.
 */

import type { DecisionEdgeKind } from '@adrkit/sdk/src/index.ts';

/**
 * A record id: the schema's `id` grammar (`packages/core/src/schema/adr.schema.ts`, four or
 * more digits or a ULID), with the digit form capped at 64 so a path segment cannot be long.
 */
export const RECORD_ID = /^(?:[0-9]{4,64}|[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})$/;

/** `adr graph --kind`'s vocabulary, in the canonical order a query is normalized to. */
export const EDGE_KINDS: readonly DecisionEdgeKind[] = Object.freeze(['supersedes', 'relatesTo', 'conflictsWith']);

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_PATH = 1024;

export type Validated<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

const invalid = { ok: false } as const;

/**
 * A caller-supplied path for `governing`: relative, no `..` segment, no leading `-`, no control
 * character, at most 1024 characters. It is never read (`readMarkers: false`); it is only
 * matched against `affects`.
 */
export function validateGoverningPath(path: string): Validated<string> {
  if (path.length === 0 || path.length > MAX_PATH) return invalid;
  if (CONTROL.test(path) || path.startsWith('-')) return invalid;
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return invalid;
  if (path.split(/[\\/]/).some((segment) => segment === '..')) return invalid;
  return { ok: true, value: path };
}

/** `kinds`: a comma-separated, non-empty subset of the three edge kinds, returned de-duplicated in canonical order. */
export function parseKinds(raw: string): Validated<readonly DecisionEdgeKind[]> {
  const items = raw.split(',');
  const wanted = new Set<string>();
  for (const item of items) {
    if (!(EDGE_KINDS as readonly string[]).includes(item)) return invalid;
    wanted.add(item);
  }
  return { ok: true, value: EDGE_KINDS.filter((kind) => wanted.has(kind)) };
}

/** `asOf`: a real UTC calendar date in `YYYY-MM-DD` form. */
export function parseAsOf(raw: string): Validated<string> {
  const match = CALENDAR_DATE.exec(raw);
  if (!match) return invalid;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return invalid;
  return { ok: true, value: raw };
}

/** The UTC calendar date of `now`, `YYYY-MM-DD`. */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}
