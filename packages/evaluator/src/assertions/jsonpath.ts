/**
 * @adrkit/evaluator — JSONPath assertion engine (approved source profile, R1).
 *
 * Uses exact `jsonpath-rfc9535@1.3.0` in process. `compile` validates the restricted
 * RFC 9535 source profile: it rejects source over 8 KiB, anything the RFC parser
 * rejects (parent/backtick/type selectors, scripts, JSONPath-Plus/JS extensions), and
 * the `match()`/`search()` functions plus any function outside `length`/`count`/`value`
 * (attacker-controlled regex is outside this release's ReDoS boundary). It stores an
 * immutable `{ source, ast }` payload.
 *
 * The package's `query` accepts a source string and internally reparses it; it cannot
 * consume the exported AST. `evaluate` therefore truthfully calls `query` with the
 * already-validated source — the same immutable payload still travels directly from
 * compile to evaluate. There is NO second evaluator-level compile, hidden mutable
 * cache, recompile, or unsafe payload cast. A result passes iff the nodelist is
 * non-empty (selecting `false` still passes). Evaluation input is bounded to canonical
 * JSON ≤ 1 MiB / depth 64 / 100,000 nodes.
 */

import { query } from 'jsonpath-rfc9535';
import parseJsonPath from 'jsonpath-rfc9535/parser';
import { ASSERTION_INPUT_LIMITS, withinJsonLimits } from './limits.ts';
import type {
  CompileOutcome,
  CompiledAssertion,
  EvalOutcome,
  JsonPathCompiledPayload,
  JsonValue,
  SourceAssertionEnginePort,
} from '../types.ts';

const MAX_SOURCE_BYTES = 8 * 1024;
const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set(['length', 'count', 'value']);

/** Collect every FunctionExpr name in the AST so disallowed functions can be rejected. */
function functionNames(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) functionNames(item, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (record.type === 'FunctionExpr' && typeof record.name === 'string') {
    out.add(record.name);
  }
  for (const value of Object.values(record)) functionNames(value, out);
}

function usesOnlyAllowedFunctions(ast: unknown): boolean {
  const names = new Set<string>();
  functionNames(ast, names);
  for (const name of names) {
    if (!ALLOWED_FUNCTIONS.has(name)) return false;
  }
  return true;
}

export function createJsonPathEngine(): SourceAssertionEnginePort<'jsonpath', JsonPathCompiledPayload> {
  return {
    engine: 'jsonpath',
    profile: 'source',
    compile(effectiveSource: string, sourceRef?: string): CompileOutcome<'jsonpath', JsonPathCompiledPayload> {
      if (new TextEncoder().encode(effectiveSource).length > MAX_SOURCE_BYTES) {
        return { ok: false, reason: 'assertions-compile.parse-error' };
      }
      let ast: unknown;
      try {
        ast = parseJsonPath(effectiveSource);
      } catch {
        return { ok: false, reason: 'assertions-compile.parse-error' };
      }
      if (!usesOnlyAllowedFunctions(ast)) {
        return { ok: false, reason: 'assertions-compile.parse-error' };
      }
      const payload: JsonPathCompiledPayload = { source: effectiveSource, ast };
      return {
        ok: true,
        compiled: { engine: 'jsonpath', payload, ...(sourceRef !== undefined ? { sourceRef } : {}) },
      };
    },
    evaluate(compiled: CompiledAssertion<'jsonpath', JsonPathCompiledPayload>, input: JsonValue): EvalOutcome {
      if (!withinJsonLimits(input, ASSERTION_INPUT_LIMITS)) {
        return { ok: false, reason: 'assertions-pass.evaluation-error' };
      }
      try {
        // Truthful reparse inside the package (documented in R1). The immutable payload
        // still carries source→evaluate directly; no evaluator-level recompile.
        const nodes = query(input as Parameters<typeof query>[0], compiled.payload.source);
        return { ok: true, pass: nodes.length > 0 };
      } catch {
        return { ok: false, reason: 'assertions-pass.evaluation-error' };
      }
    },
  };
}
