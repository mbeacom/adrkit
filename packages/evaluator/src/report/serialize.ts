/**
 * @adrkit/evaluator — canonical serialization (T028, R11).
 *
 * Produces byte-reproducible `report` and `patch` bytes. Serialization is a hand-written
 * ITERATIVE emitter (no recursion, no `JSON.stringify` key reordering) so that:
 *   - object keys are emitted in strict code-unit order — including integer-like keys
 *     (`{"2":..,"10":..}` ⇒ `{"10":..,"2":..}`), which `JSON.stringify` would reorder
 *     numerically (finding #7);
 *   - EVERY own JSON key is retained and emitted, including `__proto__`/`constructor`
 *     smuggled through a null-prototype parse (finding #1); and
 *   - hostile deep input cannot overflow the stack (finding #5) — the emitter uses an
 *     explicit work stack, and untrusted data is depth/node-bounded by `withinJsonLimits`
 *     before it ever reaches here.
 *
 * The deterministic payload carries NO timestamp, run id, or duration — caller
 * `runMetadata` lives in the envelope, outside these bytes (FR-005).
 */

import { byCodeUnit } from '../compare.ts';
import type { EvaluationPatch, Pass0Report } from '../types.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type EmitTask = { readonly kind: 'str'; readonly text: string } | { readonly kind: 'val'; readonly value: unknown; readonly depth: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function indentOf(depth: number, pretty: boolean): string {
  return pretty ? '  '.repeat(depth) : '';
}

/**
 * Canonical JSON string with keys in code-unit order. `pretty` matches
 * `JSON.stringify(x, null, 2)` formatting exactly (2-space indent, `": "`, LF).
 */
export function canonicalStringify(root: unknown, pretty = false): string {
  const nl = pretty ? '\n' : '';
  const colon = pretty ? ': ' : ':';
  const out: string[] = [];
  const stack: EmitTask[] = [{ kind: 'val', value: root, depth: 0 }];

  while (stack.length > 0) {
    const task = stack.pop();
    if (!task) continue;
    if (task.kind === 'str') {
      out.push(task.text);
      continue;
    }
    const { value, depth } = task;
    if (value === null) {
      out.push('null');
      continue;
    }
    const type = typeof value;
    if (type === 'string' || type === 'boolean') {
      out.push(JSON.stringify(value));
      continue;
    }
    if (type === 'number') {
      // Only finite numbers are valid JSON; a non-finite slips through as null.
      out.push(Number.isFinite(value) ? JSON.stringify(value) : 'null');
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push('[]');
        continue;
      }
      const parts: EmitTask[] = [{ kind: 'str', text: `[${nl}` }];
      value.forEach((item, i) => {
        parts.push({ kind: 'str', text: indentOf(depth + 1, pretty) });
        parts.push({ kind: 'val', value: item, depth: depth + 1 });
        parts.push({ kind: 'str', text: `${i < value.length - 1 ? ',' : ''}${nl}` });
      });
      parts.push({ kind: 'str', text: `${indentOf(depth, pretty)}]` });
      for (let i = parts.length - 1; i >= 0; i -= 1) stack.push(parts[i] as EmitTask);
      continue;
    }
    if (isRecord(value)) {
      const source = value;
      // Own enumerable keys (null-prototype dictionaries keep __proto__/constructor as
      // own keys), sorted deterministically by code unit; undefined values are omitted.
      const keys = Object.keys(source)
        .filter((key) => source[key] !== undefined)
        .sort(byCodeUnit);
      if (keys.length === 0) {
        out.push('{}');
        continue;
      }
      const parts: EmitTask[] = [{ kind: 'str', text: `{${nl}` }];
      keys.forEach((key, i) => {
        parts.push({ kind: 'str', text: `${indentOf(depth + 1, pretty)}${JSON.stringify(key)}${colon}` });
        parts.push({ kind: 'val', value: source[key], depth: depth + 1 });
        parts.push({ kind: 'str', text: `${i < keys.length - 1 ? ',' : ''}${nl}` });
      });
      parts.push({ kind: 'str', text: `${indentOf(depth, pretty)}}` });
      for (let i = parts.length - 1; i >= 0; i -= 1) stack.push(parts[i] as EmitTask);
      continue;
    }
    // Non-JSON (function/symbol/undefined) — defensively emit null. Validated inputs
    // never reach this branch.
    out.push('null');
  }
  return out.join('');
}

/**
 * Canonical JS structure with keys recursively sorted (code unit) — used for structural
 * equality comparisons and CLI envelope building, NOT for byte emission. Output objects
 * are null-prototype so a smuggled `__proto__` own key is retained rather than dropped.
 */
export function canonicalize(value: unknown): Json {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (!isRecord(value)) return null;
  const source = value;
  const out: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
  for (const key of Object.keys(source).sort(byCodeUnit)) {
    const entry = source[key];
    if (entry === undefined) continue;
    out[key] = canonicalize(entry);
  }
  return out;
}

/** Canonical JSON bytes: code-unit-sorted keys, 2-space indent, single trailing LF. */
export function canonicalBytes(value: unknown): string {
  return `${canonicalStringify(value, true)}\n`;
}

export function serializeReport(report: Pass0Report): string {
  return canonicalBytes(report);
}

export function serializePatch(patch: EvaluationPatch): string {
  return canonicalBytes(patch);
}

export interface CanonicalArtifacts {
  readonly report: string;
  readonly patch: string;
}

export function serializeArtifacts(report: Pass0Report, patch: EvaluationPatch): CanonicalArtifacts {
  return { report: serializeReport(report), patch: serializePatch(patch) };
}
