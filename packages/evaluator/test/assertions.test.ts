import { describe, expect, test } from 'bun:test';
import {
  createAssertionEngineRegistry,
  createJsonPathEngine,
  makeAssertionKey,
  validateRegoWasmPolicyEnvelopeV1,
  type AssertionEnginePort,
  type JsonValue,
  type Pass0Input,
  type RegoWasmPolicyEnvelopeV1,
} from '../src/index.ts';
import { sha256Hex, sha256HexUtf8 } from '../src/crypto/sha256.ts';
import { canonicalJsonString } from '../src/assertions/limits.ts';
import { baseInput, corpusOf, evaluateReport, record, ruleResult } from './support.ts';

/**
 * US3 / T032 — assertions-compile + assertions-pass. Exercises the real restricted
 * JSONPath source engine, the Rego compiled-artifact envelope boundary, one-source
 * enforcement, missing engine/source/input inertness, the compile→evaluate payload
 * handoff (exactly one compile), compile-failure prereq propagation, and canonical keys.
 */

const jsonpathEngine = createJsonPathEngine();

function jsonpathAssertion(id: string, expression: string) {
  return { id, engine: 'jsonpath' as const, expression, input: 'source' as const, severity: 'error' as const };
}

function keyFor(path: string, id: string, log?: string): string {
  return makeAssertionKey(log, path, id);
}

describe('assertions via the restricted JSONPath source engine', () => {
  const registry = createAssertionEngineRegistry({ jsonpath: jsonpathEngine });

  test('inline expression: nodelist non-empty passes compile + pass', () => {
    const path = 'docs/adr/0001.md';
    const proposal = record({ id: '0001', assertions: [jsonpathAssertion('has-name', '$.name')] }, { path });
    const report = evaluateReport(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: path,
        assertionEngines: registry,
        assertionInputs: { sources: {}, inputs: { [keyFor(path, 'has-name')]: { document: { name: 'x' } } } },
      }),
    );
    expect(ruleResult(report, 'assertions-compile')).toMatchObject({ status: 'pass', reason: 'assertions-compile.ok' });
    expect(ruleResult(report, 'assertions-pass')).toMatchObject({ status: 'pass', reason: 'assertions-pass.ok' });
  });

  test('empty nodelist ⇒ assertions-pass warn evaluates-false', () => {
    const path = 'docs/adr/0001.md';
    const proposal = record({ id: '0001', assertions: [jsonpathAssertion('has-name', '$.name')] }, { path });
    const report = evaluateReport(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: path,
        assertionEngines: registry,
        assertionInputs: { sources: {}, inputs: { [keyFor(path, 'has-name')]: { document: { other: 1 } } } },
      }),
    );
    const result = ruleResult(report, 'assertions-pass');
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('warn');
    expect(result.reason).toBe('assertions-pass.evaluates-false');
  });

  test('caller-resolved expressionFile content compiles', () => {
    const path = 'docs/adr/0001.md';
    const proposal = record(
      { id: '0001', assertions: [{ id: 'from-file', engine: 'jsonpath', expressionFile: 'policy.jsonpath', input: 'source', severity: 'error' }] },
      { path },
    );
    const key = keyFor(path, 'from-file');
    const report = evaluateReport(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: path,
        assertionEngines: registry,
        assertionInputs: { sources: { [key]: { fileContent: '$.name', sourceRef: 'sha256:abc' } }, inputs: { [key]: { document: { name: 'y' } } } },
      }),
    );
    expect(ruleResult(report, 'assertions-compile').status).toBe('pass');
    expect(ruleResult(report, 'assertions-pass').status).toBe('pass');
  });

  test('rejects match()/search() as a compile parse-error and makes assertions-pass not-evaluated', () => {
    const path = 'docs/adr/0001.md';
    const proposal = record({ id: '0001', assertions: [jsonpathAssertion('regex', '$[?match(@.x, "a.*")]')] }, { path });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal]), proposalPath: path, assertionEngines: registry, assertionInputs: { sources: {}, inputs: { [keyFor(path, 'regex')]: { document: {} } } } }),
    );
    expect(ruleResult(report, 'assertions-compile')).toMatchObject({ status: 'fail', reason: 'assertions-compile.parse-error' });
    expect(ruleResult(report, 'assertions-pass')).toMatchObject({ status: 'not-evaluated', reason: 'not-evaluated.prereq-failed' });
    expect(report.outcome).toBe('returned'); // compile is an error rule
  });

  test('missing evaluation input ⇒ assertions-pass inert input-absent (compile still passes)', () => {
    const path = 'docs/adr/0001.md';
    const proposal = record({ id: '0001', assertions: [jsonpathAssertion('has-name', '$.name')] }, { path });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal]), proposalPath: path, assertionEngines: registry, assertionInputs: { sources: {}, inputs: {} } }),
    );
    expect(ruleResult(report, 'assertions-compile').status).toBe('pass');
    expect(ruleResult(report, 'assertions-pass')).toMatchObject({ status: 'inert', reason: 'assertions-pass.input-absent' });
  });
});

describe('one-source enforcement + missing engine', () => {
  test('neither source ⇒ compile no-source', () => {
    const path = 'docs/adr/0001.md';
    const proposal = record({ id: '0001', assertions: [{ id: 'x', engine: 'jsonpath', input: 'source', severity: 'error' }] }, { path });
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal]), proposalPath: path, assertionEngines: createAssertionEngineRegistry({ jsonpath: jsonpathEngine }) }),
    );
    expect(ruleResult(report, 'assertions-compile').reason).toBe('assertions-compile.no-source');
  });

  test('both sources ⇒ compile ambiguous-source', () => {
    const path = 'docs/adr/0001.md';
    const proposal = record(
      { id: '0001', assertions: [{ id: 'x', engine: 'jsonpath', expression: '$.a', expressionFile: 'p.jsonpath', input: 'source', severity: 'error' }] },
      { path },
    );
    const report = evaluateReport(
      baseInput({ corpus: corpusOf([proposal]), proposalPath: path, assertionEngines: createAssertionEngineRegistry({ jsonpath: jsonpathEngine }) }),
    );
    expect(ruleResult(report, 'assertions-compile').reason).toBe('assertions-compile.ambiguous-source');
  });

  test('a rego assertion with no registered engine ⇒ compile inert engine-absent', () => {
    const path = 'docs/adr/0001.md';
    const proposal = record({ id: '0001', assertions: [{ id: 'r', engine: 'rego', expressionFile: 'p.rego', input: 'source', severity: 'error' }] }, { path });
    const report = evaluateReport(baseInput({ corpus: corpusOf([proposal]), proposalPath: path }));
    expect(ruleResult(report, 'assertions-compile')).toMatchObject({ status: 'inert', reason: 'assertions-compile.engine-absent' });
    expect(ruleResult(report, 'assertions-pass')).toMatchObject({ status: 'inert', reason: 'assertions-pass.engine-absent' });
  });
});

describe('compile→evaluate payload handoff (exactly one compile)', () => {
  test('the opaque payload flows from one compile straight into evaluate', () => {
    let compileCount = 0;
    let evalCount = 0;
    interface Payload { readonly token: symbol }
    const countingPort: AssertionEnginePort<'custom', Payload> = {
      engine: 'custom',
      profile: 'source',
      compile: (source) => {
        compileCount += 1;
        return { ok: true, compiled: { engine: 'custom', payload: { token: Symbol(source) } } };
      },
      evaluate: (compiled, _input) => {
        evalCount += 1;
        return { ok: true, pass: typeof compiled.payload.token === 'symbol' };
      },
    };
    const path = 'docs/adr/0001.md';
    const proposal = record({ id: '0001', assertions: [{ id: 'c', engine: 'custom', expression: 'anything', input: 'source', severity: 'error' }] }, { path });
    const report = evaluateReport(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: path,
        assertionEngines: createAssertionEngineRegistry({ custom: countingPort }),
        assertionInputs: { sources: {}, inputs: { [keyFor(path, 'c')]: { document: {} } } },
      }),
    );
    expect(compileCount).toBe(1);
    expect(evalCount).toBe(1);
    expect(ruleResult(report, 'assertions-pass').status).toBe('pass');
  });
});

describe('Rego compiled-artifact envelope', () => {
  function sealEnvelope(source: string, moduleBytes: Uint8Array, entrypoint: string): RegoWasmPolicyEnvelopeV1 {
    let binary = '';
    for (const b of moduleBytes) binary += String.fromCharCode(b);
    const withoutHash: Omit<RegoWasmPolicyEnvelopeV1, 'envelopeSha256'> = {
      mediaType: 'application/vnd.adrkit.rego-wasm-policy.v1+json',
      schemaVersion: 'adrkit.rego-wasm-policy/v1',
      source,
      sourceSha256: sha256HexUtf8(source),
      moduleBase64: btoa(binary),
      moduleSha256: sha256Hex(moduleBytes),
      data: {},
      entrypoint,
      abi: { major: 1, minor: 3 },
      compiler: { name: 'opa', version: '0.60.0', capabilitiesProfile: 'adrkit.rego-wasm.capabilities/v1', capabilitiesSha256: sha256HexUtf8('caps') },
      requiredHostBuiltins: [],
    };
    return { ...withoutHash, envelopeSha256: sha256HexUtf8(canonicalJsonString(withoutHash)) };
  }

  const validEnvelope = sealEnvelope('package example\nallow = true', new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), '/example/allow');

  test('the sealed envelope validates', () => {
    expect(validateRegoWasmPolicyEnvelopeV1(validEnvelope).ok).toBe(true);
  });

  test('a tampered envelope hash is rejected', () => {
    const tampered = { ...validEnvelope, source: 'package tampered' };
    const result = validateRegoWasmPolicyEnvelopeV1(tampered);
    expect(result.ok).toBe(false);
  });

  test('an unknown key is rejected', () => {
    const result = validateRegoWasmPolicyEnvelopeV1({ ...validEnvelope, bogus: 1 });
    expect(result.ok).toBe(false);
  });

  test('a real (non-empty) valid Wasm module validates', () => {
    // magic+version + a type section + function section + code section (empty func)
    const realModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 4, 1, 2, 0, 11]);
    const envelope = sealEnvelope('package example\nallow = true', realModule, '/example/allow');
    expect(validateRegoWasmPolicyEnvelopeV1(envelope).ok).toBe(true);
  });

  test('a magic-prefixed but structurally invalid Wasm module is rejected', () => {
    // correct magic + version, then a garbage section body ⇒ WebAssembly.validate === false
    const badModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xff, 0x01, 0x02]);
    const envelope = sealEnvelope('package example\nallow = true', badModule, '/example/allow');
    const result = validateRegoWasmPolicyEnvelopeV1(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('structurally valid Wasm');
  });

  test('a Wasm module with a bad version is rejected', () => {
    const badVersion = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x09, 0x00, 0x00, 0x00]);
    const envelope = sealEnvelope('package example\nallow = true', badVersion, '/example/allow');
    expect(validateRegoWasmPolicyEnvelopeV1(envelope).ok).toBe(false);
  });

  test('an unknown nested abi key is rejected (strict nested envelope)', () => {
    const tampered = { ...validEnvelope, abi: { ...validEnvelope.abi, extra: 1 } };
    const result = validateRegoWasmPolicyEnvelopeV1(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('unknown abi key');
  });

  test('a non-JSON `data` value is rejected (no unsafe cast crosses the boundary)', () => {
    const tampered = { ...validEnvelope, data: () => undefined };
    const result = validateRegoWasmPolicyEnvelopeV1(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('data must be a JSON value');
  });

  test('Date, Map, cycles, and hostile depth are rejected without recursion failure', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = null;
    for (let index = 0; index < 20_000; index += 1) deep = [deep];

    for (const data of [new Date(0), new Map([['a', 1]]), cyclic, deep]) {
      expect(() => validateRegoWasmPolicyEnvelopeV1({ ...validEnvelope, data })).not.toThrow();
      const result = validateRegoWasmPolicyEnvelopeV1({ ...validEnvelope, data });
      expect(result.ok).toBe(false);
    }
  });

  test('an oversized moduleBase64 is rejected before decoding (finding #6)', () => {
    // canonical base64 encodes 3 bytes → 4 chars; 4 MiB ⇒ 5,592,408 chars max.
    const oversized = 'A'.repeat(5_592_408 + 4);
    const tampered = { ...validEnvelope, moduleBase64: oversized };
    const result = validateRegoWasmPolicyEnvelopeV1(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('maximum encoded length');
  });

  test('a trusted compiled-artifact port validates then evaluates the opaque payload', () => {
    interface RegoPayload { readonly allow: boolean }
    const regoPort: AssertionEnginePort<'rego', RegoPayload> = {
      engine: 'rego',
      profile: 'compiled-artifact',
      validateArtifact: (artifact) => {
        const validation = validateRegoWasmPolicyEnvelopeV1(artifact);
        if (!validation.ok) return { ok: false, reason: 'assertions-compile.parse-error' };
        return { ok: true, compiled: { engine: 'rego', payload: { allow: validation.envelope.entrypoint === '/example/allow' } } };
      },
      evaluate: (compiled, _input: JsonValue) => ({ ok: true, pass: compiled.payload.allow }),
    };
    const path = 'docs/adr/0001.md';
    const proposal = record({ id: '0001', assertions: [{ id: 'policy', engine: 'rego', expressionFile: 'policy.rego', input: 'source', severity: 'error' }] }, { path });
    const key = keyFor(path, 'policy');
    const report = evaluateReport(
      baseInput({
        corpus: corpusOf([proposal]),
        proposalPath: path,
        assertionEngines: createAssertionEngineRegistry({ rego: regoPort }),
        assertionInputs: { sources: { [key]: { compiledArtifact: validEnvelope } }, inputs: { [key]: { document: {} } } },
      }),
    );
    expect(ruleResult(report, 'assertions-compile').status).toBe('pass');
    expect(ruleResult(report, 'assertions-pass').status).toBe('pass');
  });
});

describe('canonical assertion keys stay distinct under duplicate ADR ids', () => {
  test('two records with the same id but different paths produce different keys', () => {
    expect(keyFor('docs/adr/a.md', '0001')).not.toBe(keyFor('docs/adr/b.md', '0001'));
  });
});
