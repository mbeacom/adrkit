/**
 * @adrkit/evaluator — Rego-Wasm policy envelope validation (R1, inert by default).
 *
 * adrkit registers NO Rego runtime and executes NO Wasm. A Rego assertion is therefore
 * `engine-absent` inert unless a trusted caller registers a compiled-artifact port. This
 * module only VALIDATES the fixed, strict
 * `application/vnd.adrkit.rego-wasm-policy.v1+json` envelope so the CLI can reject
 * malformed artifacts (exit 2) and a trusted port can validate before it evaluates. It
 * never runs the module, shells out, or claims opa-wasm compiles raw Rego.
 */

import { sha256Hex, sha256HexUtf8 } from '../crypto/sha256.ts';
import { REGO_DATA_LIMITS, canonicalJsonString, withinJsonLimits } from './limits.ts';
import type { JsonValue, RegoWasmPolicyEnvelopeV1 } from '../types.ts';

const MEDIA_TYPE = 'application/vnd.adrkit.rego-wasm-policy.v1+json';
const SCHEMA_VERSION = 'adrkit.rego-wasm-policy/v1';
const CAPABILITIES_PROFILE = 'adrkit.rego-wasm.capabilities/v1';
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_MODULE_BYTES = 4 * 1024 * 1024;
// Canonical base64 encodes 3 bytes → 4 chars; a string longer than this necessarily
// decodes to more than 4 MiB, so reject it BEFORE atob/byte allocation (finding #6).
const MAX_MODULE_BASE64_LEN = Math.ceil(MAX_MODULE_BYTES / 3) * 4; // 5,592,408
// 6.75 MiB, measured over the COMPLETE canonical envelope (including envelopeSha256).
const MAX_ENVELOPE_BYTES = Math.floor(6.75 * 1024 * 1024); // 7,077,888 bytes
const HEX_64 = /^[0-9a-f]{64}$/;
const ENVELOPE_KEYS = [
  'mediaType',
  'schemaVersion',
  'source',
  'sourceSha256',
  'moduleBase64',
  'moduleSha256',
  'data',
  'entrypoint',
  'abi',
  'compiler',
  'requiredHostBuiltins',
  'envelopeSha256',
] as const;

export type EnvelopeValidation =
  | { readonly ok: true; readonly envelope: RegoWasmPolicyEnvelopeV1 }
  | { readonly ok: false; readonly message: string };

function fail(message: string): EnvelopeValidation {
  return { ok: false, message: `Rego-Wasm envelope: ${message}` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeCanonicalBase64(b64: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) return undefined;
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    return undefined;
  }
  if (btoa(binary) !== b64) return undefined; // canonical round-trip
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hasWasmMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
}

/**
 * Deterministic, synchronous structural validation of the module WITHOUT executing it.
 * `WebAssembly.validate` compiles/validates the full binary structure (sections, types,
 * function bodies) and returns a boolean; it never instantiates the module, resolves
 * imports, or runs a start function, so it stays inside the pure boundary (R1).
 */
function isStructurallyValidWasm(bytes: Uint8Array): boolean {
  try {
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

/** Narrow an `unknown` to an acyclic JSON tree without recursive stack growth. */
function isJsonValue(root: unknown): root is JsonValue {
  type WalkTask =
    | { readonly kind: 'enter'; readonly value: unknown }
    | { readonly kind: 'exit'; readonly value: object };

  const active = new Set<object>();
  const stack: WalkTask[] = [{ kind: 'enter', value: root }];

  while (stack.length > 0) {
    const task = stack.pop();
    if (!task) continue;
    if (task.kind === 'exit') {
      active.delete(task.value);
      continue;
    }

    const value = task.value;
    if (value === null) continue;
    const type = typeof value;
    if (type === 'boolean' || type === 'string') continue;
    if (type === 'number') {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== 'object' || value === null) return false;

    const objectValue = value;
    if (active.has(objectValue)) return false;
    active.add(objectValue);
    stack.push({ kind: 'exit', value: objectValue });

    if (Array.isArray(objectValue)) {
      for (let index = objectValue.length - 1; index >= 0; index -= 1) {
        if (!(index in objectValue)) return false;
        stack.push({ kind: 'enter', value: objectValue[index] });
      }
      continue;
    }

    let prototype: object | null;
    let descriptors: PropertyDescriptorMap;
    try {
      prototype = Object.getPrototypeOf(objectValue);
      descriptors = Object.getOwnPropertyDescriptors(objectValue);
    } catch {
      return false;
    }
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return false;
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return false;
      stack.push({ kind: 'enter', value: descriptor.value });
    }
  }

  return true;
}

function isCanonicalEntrypoint(entrypoint: string): boolean {
  if (!entrypoint.startsWith('/') || entrypoint.length < 2) return false;
  if (entrypoint.endsWith('/') || entrypoint.includes('//')) return false;
  return entrypoint
    .slice(1)
    .split('/')
    .every((segment) => segment.length > 0);
}

/**
 * Validate a caller-supplied Rego-Wasm policy envelope. Structural, size, canonical
 * base64, Wasm magic + `WebAssembly.validate` structure, strict ABI (1.3, no extra
 * keys), compiler/capability, empty host-builtins, JSON `data` limits, and every
 * SHA-256 binding are checked. On success it constructs the typed envelope from
 * validated locals — no unsafe cast crosses the trusted boundary. The module is never
 * executed.
 */
export function validateRegoWasmPolicyEnvelopeV1(artifact: unknown): EnvelopeValidation {
  if (!isPlainObject(artifact)) return fail('must be an object');
  for (const key of Object.keys(artifact)) {
    if (!(ENVELOPE_KEYS as readonly string[]).includes(key)) return fail(`unknown key "${key}"`);
  }
  for (const key of ENVELOPE_KEYS) {
    if (!(key in artifact)) return fail(`missing key "${key}"`);
  }

  if (artifact.mediaType !== MEDIA_TYPE) return fail('mediaType mismatch');
  if (artifact.schemaVersion !== SCHEMA_VERSION) return fail('schemaVersion mismatch');

  const source = artifact.source;
  if (typeof source !== 'string') return fail('source must be a string');
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) return fail('source exceeds 64 KiB');

  const sourceSha256 = artifact.sourceSha256;
  if (typeof sourceSha256 !== 'string' || !HEX_64.test(sourceSha256)) return fail('sourceSha256 must be 64 lowercase hex');
  if (sha256HexUtf8(source) !== sourceSha256) return fail('sourceSha256 does not match source');

  const moduleBase64 = artifact.moduleBase64;
  if (typeof moduleBase64 !== 'string') return fail('moduleBase64 must be a string');
  // Bound the ENCODED length before decoding so a hostile oversized string cannot force
  // a large atob/byte allocation.
  if (moduleBase64.length > MAX_MODULE_BASE64_LEN) return fail('moduleBase64 exceeds the maximum encoded length for a 4 MiB module');
  const moduleBytes = decodeCanonicalBase64(moduleBase64);
  if (!moduleBytes) return fail('moduleBase64 is not canonical base64');
  if (moduleBytes.length > MAX_MODULE_BYTES) return fail('module exceeds 4 MiB');
  if (!hasWasmMagic(moduleBytes)) return fail('module is not a valid Wasm binary (magic)');
  if (!isStructurallyValidWasm(moduleBytes)) return fail('module is not a structurally valid Wasm binary');

  const moduleSha256 = artifact.moduleSha256;
  if (typeof moduleSha256 !== 'string' || !HEX_64.test(moduleSha256)) return fail('moduleSha256 must be 64 lowercase hex');
  if (sha256Hex(moduleBytes) !== moduleSha256) return fail('moduleSha256 does not match module');

  // `data` must be a real JSON value before any size/depth/node measurement.
  const data = artifact.data;
  if (!isJsonValue(data)) return fail('data must be a JSON value');
  if (!withinJsonLimits(data, REGO_DATA_LIMITS)) return fail('data exceeds size/depth/node limits');

  const entrypoint = artifact.entrypoint;
  if (typeof entrypoint !== 'string' || !isCanonicalEntrypoint(entrypoint)) {
    return fail('entrypoint must be a canonical /slash/path');
  }

  const abi = artifact.abi;
  if (!isPlainObject(abi)) return fail('abi must be an object');
  for (const key of Object.keys(abi)) {
    if (key !== 'major' && key !== 'minor') return fail(`unknown abi key "${key}"`);
  }
  if (abi.major !== 1 || abi.minor !== 3) return fail('unsupported ABI (expected 1.3)');

  const compiler = artifact.compiler;
  if (!isPlainObject(compiler)) return fail('compiler must be an object');
  for (const key of Object.keys(compiler)) {
    if (!['name', 'version', 'capabilitiesProfile', 'capabilitiesSha256'].includes(key)) {
      return fail(`unknown compiler key "${key}"`);
    }
  }
  if (compiler.name !== 'opa') return fail('compiler.name must be "opa"');
  const compilerVersion = compiler.version;
  if (typeof compilerVersion !== 'string' || compilerVersion.length === 0) return fail('compiler.version required');
  if (compiler.capabilitiesProfile !== CAPABILITIES_PROFILE) return fail('unsupported capabilities profile');
  const capabilitiesSha256 = compiler.capabilitiesSha256;
  if (typeof capabilitiesSha256 !== 'string' || !HEX_64.test(capabilitiesSha256)) {
    return fail('compiler.capabilitiesSha256 must be 64 lowercase hex');
  }

  if (!Array.isArray(artifact.requiredHostBuiltins) || artifact.requiredHostBuiltins.length !== 0) {
    return fail('requiredHostBuiltins must be empty in v1');
  }

  const envelopeSha256 = artifact.envelopeSha256;
  if (typeof envelopeSha256 !== 'string' || !HEX_64.test(envelopeSha256)) return fail('envelopeSha256 must be 64 lowercase hex');

  // Construct the typed envelope from validated locals — no unsafe cast crosses here.
  const envelope: RegoWasmPolicyEnvelopeV1 = {
    mediaType: MEDIA_TYPE,
    schemaVersion: SCHEMA_VERSION,
    source,
    sourceSha256,
    moduleBase64,
    moduleSha256,
    data,
    entrypoint,
    abi: { major: 1, minor: 3 },
    compiler: {
      name: 'opa',
      version: compilerVersion,
      capabilitiesProfile: CAPABILITIES_PROFILE,
      capabilitiesSha256,
    },
    requiredHostBuiltins: [],
    envelopeSha256,
  };

  // Size limit applies to the COMPLETE canonical envelope (including the hash field).
  if (new TextEncoder().encode(canonicalJsonString(envelope)).length > MAX_ENVELOPE_BYTES) {
    return fail('decoded envelope exceeds 6.75 MiB');
  }

  // The hash binds every prior field, excluding envelopeSha256 itself.
  const { envelopeSha256: _boundHash, ...priorFields } = envelope;
  void _boundHash;
  if (sha256HexUtf8(canonicalJsonString(priorFields)) !== envelopeSha256) {
    return fail('envelopeSha256 does not bind the prior fields');
  }

  return { ok: true, envelope };
}
