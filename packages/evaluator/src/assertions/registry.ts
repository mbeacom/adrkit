/**
 * @adrkit/evaluator — assertion engine registry.
 *
 * The registry has one typed optional property per engine. Each property pairs an
 * `AssertionEnginePort<E, Payload>` with its engine-owned opaque payload type. A
 * rule dispatches on `assertion.engine`, obtains the matching property (whose static
 * type carries that engine's payload), compiles/validates once, and passes the exact
 * `CompiledAssertion<E, Payload>` straight into the SAME port's `evaluate`. There is
 * no hidden mutable ref cache, no recompile, and no `any`/`unknown` cast (R7).
 */

import type {
  AssertionEngineRegistry,
  AssertionEnginePort,
} from '../types.ts';

export interface AssertionEnginePorts<RegoPayload, JsonPathPayload, GrepPayload, CustomPayload> {
  readonly rego?: AssertionEnginePort<'rego', RegoPayload>;
  readonly jsonpath?: AssertionEnginePort<'jsonpath', JsonPathPayload>;
  readonly grep?: AssertionEnginePort<'grep', GrepPayload>;
  readonly custom?: AssertionEnginePort<'custom', CustomPayload>;
}

export function createAssertionEngineRegistry<RegoPayload, JsonPathPayload, GrepPayload, CustomPayload>(
  ports: AssertionEnginePorts<RegoPayload, JsonPathPayload, GrepPayload, CustomPayload> = {},
): AssertionEngineRegistry<RegoPayload, JsonPathPayload, GrepPayload, CustomPayload> {
  // Copy only the declared ports; a missing property is `engine-absent` inert.
  const registry: AssertionEngineRegistry<RegoPayload, JsonPathPayload, GrepPayload, CustomPayload> = {
    ...(ports.rego ? { rego: ports.rego } : {}),
    ...(ports.jsonpath ? { jsonpath: ports.jsonpath } : {}),
    ...(ports.grep ? { grep: ports.grep } : {}),
    ...(ports.custom ? { custom: ports.custom } : {}),
  };
  return registry;
}

/** A registry with no engines — every assertion is `engine-absent` inert. */
export const emptyAssertionEngineRegistry: AssertionEngineRegistry<never, never, never, never> = {};
