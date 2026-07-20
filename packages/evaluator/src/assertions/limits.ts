/**
 * @adrkit/evaluator — deterministic JSON resource limits.
 *
 * Shared bounds for assertion evaluation input and Rego envelope data (research §R1):
 * canonical size, nesting depth, and node count. Exceeding a bound is a deterministic
 * rejection, never a hang OR a stack overflow: depth and node count are enforced by an
 * ITERATIVE traversal FIRST, so hostile deep JSON returns `false` before any recursive
 * or serializing work runs (finding #5). Only after the structure is proven bounded is
 * the canonical byte size measured.
 */

import { canonicalStringify } from '../report/serialize.ts';
import type { JsonValue } from '../types.ts';

export interface JsonLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}

export const ASSERTION_INPUT_LIMITS: JsonLimits = { maxBytes: 1024 * 1024, maxDepth: 64, maxNodes: 100_000 };
export const REGO_DATA_LIMITS: JsonLimits = { maxBytes: 1024 * 1024, maxDepth: 64, maxNodes: 100_000 };

/** Compact canonical JSON (code-unit key order, no whitespace) — used for hashing/sizing. */
export function canonicalJsonString(value: unknown): string {
  return canonicalStringify(value, false);
}

/** True iff the depth and node count are within bounds — iterative, no serialization. */
function withinStructuralLimits(value: JsonValue, limits: JsonLimits): boolean {
  let nodes = 0;
  const stack: { value: JsonValue; depth: number }[] = [{ value, depth: 1 }];
  while (stack.length > 0) {
    const { value: current, depth } = stack.pop() as { value: JsonValue; depth: number };
    nodes += 1;
    if (nodes > limits.maxNodes) return false;
    if (depth > limits.maxDepth) return false;
    if (Array.isArray(current)) {
      for (const item of current) stack.push({ value: item, depth: depth + 1 });
    } else if (current !== null && typeof current === 'object') {
      // Own enumerable keys (null-prototype dictionaries retain __proto__/constructor).
      for (const entry of Object.values(current)) {
        stack.push({ value: entry, depth: depth + 1 });
      }
    }
  }
  return true;
}

export function withinJsonLimits(value: JsonValue, limits: JsonLimits): boolean {
  // Bound depth + node count FIRST so a hostile deep/large structure is rejected before
  // any serialization is attempted.
  if (!withinStructuralLimits(value, limits)) return false;
  // Now the structure is proven bounded; measuring canonical bytes is safe.
  const bytes = new TextEncoder().encode(canonicalJsonString(value)).length;
  return bytes <= limits.maxBytes;
}
