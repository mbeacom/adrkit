/**
 * @adrkit/evaluator — canonical key helpers.
 *
 * The compact assertion key and the canonical target key are the two identity
 * strings that keep the report byte-stable and collision-safe (data-model §4/§5).
 * Both are pure string functions.
 */

import type { Adr, Assertion } from '@adrkit/core';
import type { AssertionKey, CanonicalTargetId, CanonicalTargetKey } from './types.ts';

/** Compact standard `JSON.stringify([log ?? "", path, id])` — no added whitespace. */
export function makeAssertionKey(
  log: string | undefined,
  path: string,
  id: string,
): AssertionKey {
  return JSON.stringify([log ?? '', path, id]);
}

/** The canonical assertion key for one assertion declared on one record. */
export function assertionKeyForAssertion(record: Adr, assertion: Assertion): AssertionKey {
  return makeAssertionKey(record.log, record.path, assertion.id);
}

/**
 * A key is canonical iff parsing it yields exactly three strings AND the original
 * key is byte-equal to the compact re-serialization. Whitespace-padded or otherwise
 * noncanonical spellings are rejected, never normalized.
 */
export function isCanonicalAssertionKey(key: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return false;
  if (!parsed.every((part): part is string => typeof part === 'string')) return false;
  return JSON.stringify(parsed) === key;
}

/** Parse a canonical assertion key back into its three string components. */
export function parseAssertionKey(
  key: string,
): { readonly log: string; readonly path: string; readonly id: string } | undefined {
  if (!isCanonicalAssertionKey(key)) return undefined;
  const [log, path, id] = JSON.parse(key) as [string, string, string];
  return { log, path, id };
}

/** Stable `${kind}:${id}` serialization used for equality/intersection/ordering. */
export function canonicalTargetKey(id: CanonicalTargetId): CanonicalTargetKey {
  return `${id.kind}:${id.id}`;
}
