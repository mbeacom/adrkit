/**
 * @adrkit/evaluator — assertion compile + evaluate pipeline (R6/R7, T038).
 *
 * One pass over the proposal's assertions produces both rules' sub-results. The
 * effective source is decided by what the ADR DECLARES (exactly one of inline
 * `expression` or `expressionFile`): neither ⇒ compile error `no-source`; both ⇒
 * `ambiguous-source`. A declared file with no resolved content, an unregistered engine,
 * or an absent compiled artifact is inert (never a violation). A successful compile /
 * artifact-validation produces the engine-owned opaque `CompiledAssertion<E, Payload>`,
 * which is handed DIRECTLY to the SAME port's `evaluate` — no recompile, hidden cache,
 * or unsafe cast. Compile failure is kept distinct from evaluate-false.
 */

import type { Adr, Assertion } from '@adrkit/core';
import type { SubResult } from '../report/aggregate.ts';
import type { RuleContext } from '../rules/context.ts';
import { makeAssertionKey } from '../keys.ts';
import type {
  AssertionEngineName,
  AssertionEnginePort,
  AssertionKey,
  EvalOutcome,
  JsonValue,
  ResolvedAssertionSource,
} from '../types.ts';

export interface AssertionOutcomes {
  readonly compileSubs: readonly SubResult[];
  readonly passSubs: readonly SubResult[];
  readonly hasAssertions: boolean;
}

interface PortResult {
  readonly compile: SubResult;
  readonly pass?: SubResult;
}

function runPort<E extends AssertionEngineName, Payload>(
  port: AssertionEnginePort<E, Payload> | undefined,
  key: AssertionKey,
  record: Adr,
  hasInline: boolean,
  inline: string | undefined,
  source: ResolvedAssertionSource | undefined,
  input: JsonValue | undefined,
): PortResult {
  const base = { assertionKey: key, candidateAdr: record.frontmatter.id, recordPath: record.path } as const;

  if (!port) {
    return {
      compile: { status: 'inert', reason: 'assertions-compile.engine-absent', finding: { reason: 'assertions-compile.engine-absent', ...base } },
      pass: { status: 'inert', reason: 'assertions-pass.engine-absent', finding: { reason: 'assertions-pass.engine-absent', ...base } },
    };
  }

  if (port.profile === 'source') {
    const effectiveSource = hasInline ? inline : source?.fileContent;
    if (effectiveSource === undefined) {
      return {
        compile: { status: 'inert', reason: 'assertions-compile.source-absent', finding: { reason: 'assertions-compile.source-absent', ...base } },
        pass: { status: 'inert', reason: 'assertions-pass.input-absent', finding: { reason: 'assertions-pass.input-absent', ...base } },
      };
    }
    const outcome = port.compile(effectiveSource, source?.sourceRef);
    if (!outcome.ok) {
      return { compile: { status: 'fail', reason: outcome.reason, finding: { reason: outcome.reason, ...base } } };
    }
    const compileSub: SubResult = { status: 'pass', reason: 'assertions-compile.ok' };
    if (input === undefined) {
      return { compile: compileSub, pass: { status: 'inert', reason: 'assertions-pass.input-absent', finding: { reason: 'assertions-pass.input-absent', ...base } } };
    }
    const evaluated = port.evaluate(outcome.compiled, input);
    if (!evaluated.ok) {
      return { compile: compileSub, pass: { status: 'fail', reason: evaluated.reason, finding: { reason: evaluated.reason, ...base } } };
    }
    return {
      compile: compileSub,
      pass: evaluated.pass
        ? { status: 'pass', reason: 'assertions-pass.ok' }
        : { status: 'fail', reason: 'assertions-pass.evaluates-false', finding: { reason: 'assertions-pass.evaluates-false', ...base } },
    };
  }

  // compiled-artifact profile
  const artifact = source?.compiledArtifact;
  if (artifact === undefined) {
    return {
      compile: { status: 'inert', reason: 'assertions-compile.source-absent', finding: { reason: 'assertions-compile.source-absent', ...base } },
      pass: { status: 'inert', reason: 'assertions-pass.input-absent', finding: { reason: 'assertions-pass.input-absent', ...base } },
    };
  }
  const outcome = port.validateArtifact(artifact);
  if (!outcome.ok) {
    return { compile: { status: 'fail', reason: outcome.reason, finding: { reason: outcome.reason, ...base } } };
  }
  const compileSub: SubResult = { status: 'pass', reason: 'assertions-compile.ok' };
  if (input === undefined) {
    return { compile: compileSub, pass: { status: 'inert', reason: 'assertions-pass.input-absent', finding: { reason: 'assertions-pass.input-absent', ...base } } };
  }
  const evaluated = port.evaluate(outcome.compiled, input);
  if (!evaluated.ok) {
    return { compile: compileSub, pass: { status: 'fail', reason: evaluated.reason, finding: { reason: evaluated.reason, ...base } } };
  }
  return {
    compile: compileSub,
    pass: evaluated.pass
      ? { status: 'pass', reason: 'assertions-pass.ok' }
      : { status: 'fail', reason: 'assertions-pass.evaluates-false', finding: { reason: 'assertions-pass.evaluates-false', ...base } },
  };
}

function dispatch(ctx: RuleContext, assertion: Assertion, key: AssertionKey, input: JsonValue | undefined): PortResult {
  const record = ctx.proposed;
  const source = ctx.input.assertionInputs.sources[key];
  const hasInline = assertion.expression !== undefined;
  const registry = ctx.input.assertionEngines;
  switch (assertion.engine) {
    case 'rego':
      return runPort(registry.rego, key, record, hasInline, assertion.expression, source, input);
    case 'jsonpath':
      return runPort(registry.jsonpath, key, record, hasInline, assertion.expression, source, input);
    case 'grep':
      return runPort(registry.grep, key, record, hasInline, assertion.expression, source, input);
    case 'custom':
      return runPort(registry.custom, key, record, hasInline, assertion.expression, source, input);
  }
}

/** Evaluate every proposal assertion once, producing both rules' sub-results. */
export function computeAssertionOutcomes(ctx: RuleContext): AssertionOutcomes {
  const assertions = ctx.proposed.frontmatter.assertions;
  const compileSubs: SubResult[] = [];
  const passSubs: SubResult[] = [];

  for (const assertion of assertions) {
    const key = makeAssertionKey(ctx.proposed.log, ctx.proposed.path, assertion.id);
    const base = { assertionKey: key, candidateAdr: ctx.proposed.frontmatter.id, recordPath: ctx.proposed.path } as const;

    const hasInline = assertion.expression !== undefined;
    const hasFile = assertion.expressionFile !== undefined;
    if (!hasInline && !hasFile) {
      compileSubs.push({
        status: 'fail',
        reason: 'assertions-compile.no-source',
        finding: { reason: 'assertions-compile.no-source', field: 'assertions', message: `Assertion "${assertion.id}" declares no source`, ...base },
      });
      continue;
    }
    if (hasInline && hasFile) {
      compileSubs.push({
        status: 'fail',
        reason: 'assertions-compile.ambiguous-source',
        finding: { reason: 'assertions-compile.ambiguous-source', field: 'assertions', message: `Assertion "${assertion.id}" declares both expression and expressionFile`, ...base },
      });
      continue;
    }

    const input = ctx.input.assertionInputs.inputs[key]?.document;
    const result = dispatch(ctx, assertion, key, input);
    compileSubs.push(result.compile);
    if (result.pass) passSubs.push(result.pass);
  }

  return { compileSubs, passSubs, hasAssertions: assertions.length > 0 };
}

/**
 * A compiled assertion that scope-hierarchy can evaluate against multiple inputs
 * (base vs proposed) from a single compile/validate — no recompile or unsafe cast.
 */
export type ScopeCompile =
  | { readonly ok: true; readonly evaluate: (input: JsonValue) => EvalOutcome }
  | { readonly ok: false; readonly reason: 'engine-absent' | 'source-absent' | 'compile-error' };

function compileWith<E extends AssertionEngineName, Payload>(
  port: AssertionEnginePort<E, Payload> | undefined,
  hasInline: boolean,
  inline: string | undefined,
  source: ResolvedAssertionSource | undefined,
): ScopeCompile {
  if (!port) return { ok: false, reason: 'engine-absent' };
  if (port.profile === 'source') {
    const effectiveSource = hasInline ? inline : source?.fileContent;
    if (effectiveSource === undefined) return { ok: false, reason: 'source-absent' };
    const outcome = port.compile(effectiveSource, source?.sourceRef);
    if (!outcome.ok) return { ok: false, reason: 'compile-error' };
    return { ok: true, evaluate: (input: JsonValue) => port.evaluate(outcome.compiled, input) };
  }
  const artifact = source?.compiledArtifact;
  if (artifact === undefined) return { ok: false, reason: 'source-absent' };
  const outcome = port.validateArtifact(artifact);
  if (!outcome.ok) return { ok: false, reason: 'compile-error' };
  return { ok: true, evaluate: (input: JsonValue) => port.evaluate(outcome.compiled, input) };
}

/** Compile one accepted-org ADR assertion for base/proposed evaluation (scope-hierarchy). */
export function compileAssertionForScope(ctx: RuleContext, orgRecord: Adr, assertion: Assertion): ScopeCompile {
  const key = makeAssertionKey(orgRecord.log, orgRecord.path, assertion.id);
  const source = ctx.input.assertionInputs.sources[key];
  const hasInline = assertion.expression !== undefined;
  const registry = ctx.input.assertionEngines;
  switch (assertion.engine) {
    case 'rego':
      return compileWith(registry.rego, hasInline, assertion.expression, source);
    case 'jsonpath':
      return compileWith(registry.jsonpath, hasInline, assertion.expression, source);
    case 'grep':
      return compileWith(registry.grep, hasInline, assertion.expression, source);
    case 'custom':
      return compileWith(registry.custom, hasInline, assertion.expression, source);
  }
}
