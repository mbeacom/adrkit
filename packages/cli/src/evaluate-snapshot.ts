/**
 * @adrkit/cli — strict `adrkit.pass0.snapshot/v1` bundle validation + normalization.
 *
 * Snapshot JSON is DATA ONLY. It can never select, import, or execute a registry,
 * module, command, or port (data-model §2.1). This module parses the bundle with a
 * duplicate-key-aware JSON reader, validates the strict v1 shape (rejecting unknown
 * keys, wrong types, noncanonical assertion/target keys, and duplicate identities),
 * and normalizes omitted optional backing to empty/unavailable runtime containers so
 * the affected rule reports inert. Malformed present data is an exit-2 error; the CLI
 * never invents defaults for a broken bundle.
 */

import {
  canonicalTargetKey,
  isCanonicalAssertionKey,
  makeTargetId,
  validateRegoWasmPolicyEnvelopeV1,
  type AffectsType,
  type AssertionInputSnapshot,
  type FederatedLogSnapshot,
  type IdentityDirectorySnapshot,
  type JsonValue,
  type RegoWasmPolicyEnvelopeV1,
  type ResolvedAssertionInput,
  type ResolvedAssertionSource,
  type RoutingTriggerEvidence,
  type ScopeContradictionEvidence,
  type TargetInventorySnapshots,
} from '@adrkit/evaluator';

export class SnapshotContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotContractError';
  }
}

/** Normalized, immutable snapshot pieces ready to assemble a Pass0Input. */
export interface NormalizedSnapshot {
  readonly federatedLogs?: readonly FederatedLogSnapshot[];
  readonly resolutionLog?: string;
  readonly targets: TargetInventorySnapshots;
  readonly assertionInputs: AssertionInputSnapshot;
  readonly identity?: IdentityDirectorySnapshot;
  readonly scopeEvidence?: ScopeContradictionEvidence;
  readonly routingEvidence?: RoutingTriggerEvidence;
}

/* ------------------------------------------------------------------ *
 * Duplicate-key-aware JSON reader
 * ------------------------------------------------------------------ */

class StrictJsonReader {
  private static readonly MAX_DEPTH = 128;
  private i = 0;
  constructor(private readonly s: string) {}

  read(): JsonValue {
    this.ws();
    const value = this.value(0);
    this.ws();
    if (this.i !== this.s.length) this.fail('unexpected trailing content');
    return value;
  }

  private fail(message: string): never {
    throw new SnapshotContractError(`Malformed snapshot JSON: ${message} (offset ${this.i})`);
  }

  private ws(): void {
    while (this.i < this.s.length) {
      const c = this.s.charCodeAt(this.i);
      if (c === 32 || c === 9 || c === 10 || c === 13) this.i += 1;
      else break;
    }
  }

  private value(depth: number): JsonValue {
    if (depth > StrictJsonReader.MAX_DEPTH) {
      this.fail(`nesting exceeds ${StrictJsonReader.MAX_DEPTH}`);
    }
    const c = this.s[this.i];
    if (c === '{') return this.object(depth);
    if (c === '[') return this.array(depth);
    if (c === '"') return this.string();
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return this.number();
    if (this.s.startsWith('true', this.i)) return (this.i += 4), true;
    if (this.s.startsWith('false', this.i)) return (this.i += 5), false;
    if (this.s.startsWith('null', this.i)) return (this.i += 4), null;
    this.fail('unexpected token');
  }

  private object(depth: number): JsonValue {
    this.i += 1;
    // Null-prototype dictionary so a smuggled `__proto__`/`constructor` key becomes a
    // real own property (retained for unknown-key validation, hashing, and sizing)
    // instead of being swallowed by the object prototype (finding #1).
    const obj: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    const seen = new Set<string>();
    this.ws();
    if (this.s[this.i] === '}') return (this.i += 1), obj;
    for (;;) {
      this.ws();
      if (this.s[this.i] !== '"') this.fail('expected string key');
      const key = this.string();
      if (seen.has(key)) throw new SnapshotContractError(`Duplicate key "${key}" in snapshot bundle`);
      seen.add(key);
      this.ws();
      if (this.s[this.i] !== ':') this.fail('expected ":"');
      this.i += 1;
      this.ws();
      obj[key] = this.value(depth + 1);
      this.ws();
      const ch = this.s[this.i];
      if (ch === ',') {
        this.i += 1;
        continue;
      }
      if (ch === '}') {
        this.i += 1;
        break;
      }
      this.fail('expected "," or "}"');
    }
    return obj;
  }

  private array(depth: number): JsonValue {
    this.i += 1;
    const arr: JsonValue[] = [];
    this.ws();
    if (this.s[this.i] === ']') return (this.i += 1), arr;
    for (;;) {
      this.ws();
      arr.push(this.value(depth + 1));
      this.ws();
      const ch = this.s[this.i];
      if (ch === ',') {
        this.i += 1;
        continue;
      }
      if (ch === ']') {
        this.i += 1;
        break;
      }
      this.fail('expected "," or "]"');
    }
    return arr;
  }

  private string(): string {
    const start = this.i;
    this.i += 1;
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === '\\') {
        this.i += 2;
        continue;
      }
      if (ch === '"') {
        this.i += 1;
        break;
      }
      this.i += 1;
    }
    const raw = this.s.slice(start, this.i);
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'string') this.fail('invalid string literal');
      return parsed;
    } catch {
      this.fail('invalid string literal');
    }
  }

  private number(): number {
    // Enforce the exact RFC 8259 number grammar before Number() conversion:
    //   number = [ "-" ] int [ frac ] [ exp ]
    //   int    = "0" / ( digit1-9 *DIGIT )     ; no leading zeros, no "+"
    //   frac   = "." 1*DIGIT
    //   exp    = ("e"/"E") ["+"/"-"] 1*DIGIT
    const start = this.i;
    const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

    if (this.s[this.i] === '-') this.i += 1; // optional minus (never plus)

    if (this.s[this.i] === '0') {
      this.i += 1; // a leading zero must stand alone (no "01")
    } else if (this.s[this.i] !== undefined && this.s[this.i]! >= '1' && this.s[this.i]! <= '9') {
      this.i += 1;
      while (isDigit(this.s[this.i])) this.i += 1;
    } else {
      this.fail('invalid number: expected an integer part');
    }

    if (this.s[this.i] === '.') {
      this.i += 1;
      if (!isDigit(this.s[this.i])) this.fail('invalid number: expected a digit after the decimal point');
      while (isDigit(this.s[this.i])) this.i += 1;
    }

    if (this.s[this.i] === 'e' || this.s[this.i] === 'E') {
      this.i += 1;
      if (this.s[this.i] === '+' || this.s[this.i] === '-') this.i += 1;
      if (!isDigit(this.s[this.i])) this.fail('invalid number: expected a digit in the exponent');
      while (isDigit(this.s[this.i])) this.i += 1;
    }

    const raw = this.s.slice(start, this.i);
    const n = Number(raw);
    if (raw.length === 0 || !Number.isFinite(n)) this.fail('invalid number');
    return n;
  }
}

export function parseSnapshotJson(text: string): JsonValue {
  return new StrictJsonReader(text).read();
}

/* ------------------------------------------------------------------ *
 * Shape validation helpers
 * ------------------------------------------------------------------ */

const AFFECTS_TYPES = ['path', 'entity', 'package', 'resource', 'api', 'data'] as const;

function parseAffectsType(value: string): AffectsType | undefined {
  return AFFECTS_TYPES.find((type) => type === value);
}

function isPlainObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: JsonValue, where: string): { readonly [key: string]: JsonValue } {
  if (!isPlainObject(value)) throw new SnapshotContractError(`${where} must be an object`);
  return value;
}

function requireString(value: JsonValue, where: string): string {
  if (typeof value !== 'string') throw new SnapshotContractError(`${where} must be a string`);
  return value;
}

function requireBoolean(value: JsonValue, where: string): boolean {
  if (typeof value !== 'boolean') throw new SnapshotContractError(`${where} must be a boolean`);
  return value;
}

function requireNumber(value: JsonValue, where: string): number {
  if (typeof value !== 'number') throw new SnapshotContractError(`${where} must be a number`);
  return value;
}

function requireStringArray(value: JsonValue, where: string): readonly string[] {
  if (!Array.isArray(value)) throw new SnapshotContractError(`${where} must be an array`);
  return value.map((item, idx) => requireString(item, `${where}[${idx}]`));
}

function rejectUnknownKeys(obj: { readonly [key: string]: JsonValue }, allowed: readonly string[], where: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) throw new SnapshotContractError(`Unknown key "${key}" in ${where}`);
  }
}

function isCanonicalTargetKey(key: string): boolean {
  const idx = key.indexOf(':');
  if (idx <= 0) return false;
  const kind = parseAffectsType(key.slice(0, idx));
  if (!kind) return false;
  const id = key.slice(idx + 1);
  if (id.length === 0) return false;
  // Require full canonical normalization + byte equality using the evaluator's own
  // helpers, so a noncanonical spelling (`path:./src/a.ts`, `path:src\a.ts`) that would
  // silently MISS a resolved target is rejected rather than accepted (finding #3).
  return canonicalTargetKey(makeTargetId(kind, id)) === key;
}

function requireCanonicalTargetKeys(value: JsonValue, where: string): readonly string[] {
  const keys = requireStringArray(value, where);
  for (const key of keys) {
    if (!isCanonicalTargetKey(key)) throw new SnapshotContractError(`"${key}" in ${where} is not a canonical target key`);
  }
  return keys;
}

function requireCanonicalAssertionKeys(obj: { readonly [key: string]: JsonValue }, where: string): void {
  for (const key of Object.keys(obj)) {
    if (!isCanonicalAssertionKey(key)) {
      throw new SnapshotContractError(`Assertion key "${key}" in ${where} is not canonical`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Section validators
 * ------------------------------------------------------------------ */

function validateFederatedLogs(value: JsonValue): readonly FederatedLogSnapshot[] {
  if (!Array.isArray(value)) throw new SnapshotContractError('federatedLogs must be an array');
  return value.map((item, idx) => {
    const obj = requireObject(item, `federatedLogs[${idx}]`);
    rejectUnknownKeys(obj, ['log', 'adrIds', 'sourceRef'], `federatedLogs[${idx}]`);
    const log = requireString(obj.log ?? null, `federatedLogs[${idx}].log`);
    const adrIds = requireStringArray(obj.adrIds ?? null, `federatedLogs[${idx}].adrIds`);
    return {
      log,
      adrIds,
      ...(obj.sourceRef !== undefined ? { sourceRef: requireString(obj.sourceRef, `federatedLogs[${idx}].sourceRef`) } : {}),
    };
  });
}

function validateTargets(value: JsonValue): TargetInventorySnapshots {
  const obj = requireObject(value, 'targets');
  rejectUnknownKeys(obj, ['trackedPaths', 'dependencies', 'entities', 'resources', 'apis', 'data'], 'targets');
  const targets: {
    trackedPaths?: readonly string[];
    dependencies?: readonly { name: string; version?: string }[];
    entities?: readonly { id: string; owner?: string }[];
    resources?: readonly { id: string; securitySurface?: boolean; production?: boolean; regulated?: boolean }[];
    apis?: readonly { id: string; securitySurface?: boolean; production?: boolean }[];
    data?: readonly { id: string; residency?: string; regulated?: boolean }[];
  } = {};

  if (obj.trackedPaths !== undefined) targets.trackedPaths = requireStringArray(obj.trackedPaths, 'targets.trackedPaths');
  if (obj.dependencies !== undefined) {
    if (!Array.isArray(obj.dependencies)) throw new SnapshotContractError('targets.dependencies must be an array');
    targets.dependencies = obj.dependencies.map((item, idx) => {
      const dep = requireObject(item, `targets.dependencies[${idx}]`);
      rejectUnknownKeys(dep, ['name', 'version'], `targets.dependencies[${idx}]`);
      return {
        name: requireString(dep.name ?? null, `targets.dependencies[${idx}].name`),
        ...(dep.version !== undefined ? { version: requireString(dep.version, `targets.dependencies[${idx}].version`) } : {}),
      };
    });
  }
  if (obj.entities !== undefined) {
    if (!Array.isArray(obj.entities)) throw new SnapshotContractError('targets.entities must be an array');
    targets.entities = obj.entities.map((item, idx) => {
      const ent = requireObject(item, `targets.entities[${idx}]`);
      rejectUnknownKeys(ent, ['id', 'owner'], `targets.entities[${idx}]`);
      return {
        id: requireString(ent.id ?? null, `targets.entities[${idx}].id`),
        ...(ent.owner !== undefined ? { owner: requireString(ent.owner, `targets.entities[${idx}].owner`) } : {}),
      };
    });
  }
  if (obj.resources !== undefined) {
    if (!Array.isArray(obj.resources)) throw new SnapshotContractError('targets.resources must be an array');
    targets.resources = obj.resources.map((item, idx) => {
      const r = requireObject(item, `targets.resources[${idx}]`);
      rejectUnknownKeys(r, ['id', 'securitySurface', 'production', 'regulated'], `targets.resources[${idx}]`);
      return {
        id: requireString(r.id ?? null, `targets.resources[${idx}].id`),
        ...(r.securitySurface !== undefined ? { securitySurface: requireBoolean(r.securitySurface, `targets.resources[${idx}].securitySurface`) } : {}),
        ...(r.production !== undefined ? { production: requireBoolean(r.production, `targets.resources[${idx}].production`) } : {}),
        ...(r.regulated !== undefined ? { regulated: requireBoolean(r.regulated, `targets.resources[${idx}].regulated`) } : {}),
      };
    });
  }
  if (obj.apis !== undefined) {
    if (!Array.isArray(obj.apis)) throw new SnapshotContractError('targets.apis must be an array');
    targets.apis = obj.apis.map((item, idx) => {
      const a = requireObject(item, `targets.apis[${idx}]`);
      rejectUnknownKeys(a, ['id', 'securitySurface', 'production'], `targets.apis[${idx}]`);
      return {
        id: requireString(a.id ?? null, `targets.apis[${idx}].id`),
        ...(a.securitySurface !== undefined ? { securitySurface: requireBoolean(a.securitySurface, `targets.apis[${idx}].securitySurface`) } : {}),
        ...(a.production !== undefined ? { production: requireBoolean(a.production, `targets.apis[${idx}].production`) } : {}),
      };
    });
  }
  if (obj.data !== undefined) {
    if (!Array.isArray(obj.data)) throw new SnapshotContractError('targets.data must be an array');
    targets.data = obj.data.map((item, idx) => {
      const d = requireObject(item, `targets.data[${idx}]`);
      rejectUnknownKeys(d, ['id', 'residency', 'regulated'], `targets.data[${idx}]`);
      return {
        id: requireString(d.id ?? null, `targets.data[${idx}].id`),
        ...(d.residency !== undefined ? { residency: requireString(d.residency, `targets.data[${idx}].residency`) } : {}),
        ...(d.regulated !== undefined ? { regulated: requireBoolean(d.regulated, `targets.data[${idx}].regulated`) } : {}),
      };
    });
  }
  return targets;
}

function validateAssertionSource(value: JsonValue, where: string): ResolvedAssertionSource {
  const obj = requireObject(value, where);
  rejectUnknownKeys(obj, ['fileContent', 'sourceRef', 'compiledArtifact'], where);
  const source: { fileContent?: string; sourceRef?: string; compiledArtifact?: RegoWasmPolicyEnvelopeV1 } = {};
  if (obj.fileContent !== undefined) source.fileContent = requireString(obj.fileContent, `${where}.fileContent`);
  if (obj.sourceRef !== undefined) source.sourceRef = requireString(obj.sourceRef, `${where}.sourceRef`);
  if (obj.compiledArtifact !== undefined) {
    // The envelope is data only. Validate it deeply here so a malformed caller artifact
    // is an exit-2 bundle error, not a silent inert. A registered engine re-validates
    // before it evaluates; adrkit never executes the module.
    const validation = validateRegoWasmPolicyEnvelopeV1(obj.compiledArtifact);
    if (!validation.ok) throw new SnapshotContractError(`${where}.compiledArtifact: ${validation.message}`);
    source.compiledArtifact = validation.envelope;
  }
  return source;
}

function validateAssertionInputs(value: JsonValue): AssertionInputSnapshot {
  const obj = requireObject(value, 'assertionInputs');
  rejectUnknownKeys(obj, ['sources', 'inputs'], 'assertionInputs');
  const sources: Record<string, ResolvedAssertionSource> = {};
  const inputs: Record<string, ResolvedAssertionInput> = {};
  if (obj.sources !== undefined) {
    const src = requireObject(obj.sources, 'assertionInputs.sources');
    requireCanonicalAssertionKeys(src, 'assertionInputs.sources');
    for (const [key, val] of Object.entries(src)) {
      sources[key] = validateAssertionSource(val, `assertionInputs.sources["${key}"]`);
    }
  }
  if (obj.inputs !== undefined) {
    const inp = requireObject(obj.inputs, 'assertionInputs.inputs');
    requireCanonicalAssertionKeys(inp, 'assertionInputs.inputs');
    for (const [key, val] of Object.entries(inp)) {
      const entry = requireObject(val, `assertionInputs.inputs["${key}"]`);
      rejectUnknownKeys(entry, ['document'], `assertionInputs.inputs["${key}"]`);
      if (entry.document === undefined) throw new SnapshotContractError(`assertionInputs.inputs["${key}"].document is required`);
      inputs[key] = { document: entry.document };
    }
  }
  return { sources, inputs };
}

function validateIdentity(value: JsonValue): IdentityDirectorySnapshot {
  const obj = requireObject(value, 'identity');
  rejectUnknownKeys(obj, ['principals', 'teams', 'codeowners', 'catalogOwners'], 'identity');
  if (!Array.isArray(obj.principals)) throw new SnapshotContractError('identity.principals must be an array');
  const seenPrincipals = new Set<string>();
  const principals = obj.principals.map((item, idx) => {
    const p = requireObject(item, `identity.principals[${idx}]`);
    rejectUnknownKeys(p, ['id', 'active', 'kind'], `identity.principals[${idx}]`);
    const id = requireString(p.id ?? null, `identity.principals[${idx}].id`);
    if (seenPrincipals.has(id)) throw new SnapshotContractError(`Duplicate principal id "${id}"`);
    seenPrincipals.add(id);
    const kind = requireString(p.kind ?? null, `identity.principals[${idx}].kind`);
    if (kind !== 'human' && kind !== 'team') throw new SnapshotContractError(`identity.principals[${idx}].kind must be "human" or "team"`);
    return { id, active: requireBoolean(p.active ?? null, `identity.principals[${idx}].active`), kind: kind as 'human' | 'team' };
  });
  const teams = Array.isArray(obj.teams)
    ? obj.teams.map((item, idx) => {
        const t = requireObject(item, `identity.teams[${idx}]`);
        rejectUnknownKeys(t, ['id', 'members'], `identity.teams[${idx}]`);
        return {
          id: requireString(t.id ?? null, `identity.teams[${idx}].id`),
          members: requireStringArray(t.members ?? null, `identity.teams[${idx}].members`),
        };
      })
    : obj.teams === undefined
      ? []
      : (() => {
          throw new SnapshotContractError('identity.teams must be an array');
        })();

  const identity: {
    principals: readonly { id: string; active: boolean; kind: 'human' | 'team' }[];
    teams: readonly { id: string; members: readonly string[] }[];
    codeowners?: readonly { pattern: string; owners: readonly string[] }[];
    catalogOwners?: Readonly<Record<string, readonly string[]>>;
  } = { principals, teams };

  // Team/principal consistency (finding #4): duplicate team ids let the last write win in
  // the index Map and could bypass the ambiguity barrier; a team id must be a principal
  // of kind "team", and a "team" principal must have a membership entry.
  const principalKindById = new Map(principals.map((p) => [p.id, p.kind]));
  const teamIds = new Set<string>();
  for (const team of teams) {
    if (teamIds.has(team.id)) throw new SnapshotContractError(`Duplicate team id "${team.id}"`);
    teamIds.add(team.id);
    const kind = principalKindById.get(team.id);
    if (kind === undefined) throw new SnapshotContractError(`Team "${team.id}" has no matching principal`);
    if (kind !== 'team') throw new SnapshotContractError(`Team "${team.id}" collides with a non-team principal`);
  }
  for (const p of principals) {
    if (p.kind === 'team' && !teamIds.has(p.id)) {
      throw new SnapshotContractError(`Team principal "${p.id}" has no membership entry`);
    }
  }

  if (obj.codeowners !== undefined) {
    if (!Array.isArray(obj.codeowners)) throw new SnapshotContractError('identity.codeowners must be an array');
    identity.codeowners = obj.codeowners.map((item, idx) => {
      const rule = requireObject(item, `identity.codeowners[${idx}]`);
      rejectUnknownKeys(rule, ['pattern', 'owners'], `identity.codeowners[${idx}]`);
      return {
        pattern: requireString(rule.pattern ?? null, `identity.codeowners[${idx}].pattern`),
        owners: requireStringArray(rule.owners ?? null, `identity.codeowners[${idx}].owners`),
      };
    });
  }
  if (obj.catalogOwners !== undefined) {
    const co = requireObject(obj.catalogOwners, 'identity.catalogOwners');
    // Null-prototype map: entity ids are arbitrary, so a literal `__proto__` key must be
    // retained as data rather than mutating a prototype (finding #1).
    const map: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;
    for (const [key, owners] of Object.entries(co)) {
      map[key] = requireStringArray(owners, `identity.catalogOwners["${key}"]`);
    }
    identity.catalogOwners = map;
  }
  return identity;
}

function validateScopeEvidence(value: JsonValue): ScopeContradictionEvidence {
  const obj = requireObject(value, 'scopeEvidence');
  rejectUnknownKeys(obj, ['baseInputs'], 'scopeEvidence');
  if (obj.baseInputs === undefined) return {};
  const base = requireObject(obj.baseInputs, 'scopeEvidence.baseInputs');
  requireCanonicalAssertionKeys(base, 'scopeEvidence.baseInputs');
  const baseInputs: Record<string, ResolvedAssertionInput> = {};
  for (const [key, val] of Object.entries(base)) {
    const entry = requireObject(val, `scopeEvidence.baseInputs["${key}"]`);
    rejectUnknownKeys(entry, ['document'], `scopeEvidence.baseInputs["${key}"]`);
    if (entry.document === undefined) throw new SnapshotContractError(`scopeEvidence.baseInputs["${key}"].document is required`);
    baseInputs[key] = { document: entry.document };
  }
  return { baseInputs };
}

function validateRoutingEvidence(value: JsonValue): RoutingTriggerEvidence {
  const obj = requireObject(value, 'routingEvidence');
  rejectUnknownKeys(
    obj,
    ['costEvidence', 'dataResidency', 'humanRequested', 'securitySurfaceTargetKeys', 'regulatedTargetKeys', 'productionTargetKeys'],
    'routingEvidence',
  );
  const evidence: {
    costEvidence?: { normalizedCost: number; threshold: number };
    dataResidency?: { present: boolean };
    humanRequested?: { requester: string };
    securitySurfaceTargets?: ReadonlySet<string>;
    regulatedTargets?: ReadonlySet<string>;
    productionTargets?: ReadonlySet<string>;
  } = {};
  if (obj.costEvidence !== undefined) {
    const c = requireObject(obj.costEvidence, 'routingEvidence.costEvidence');
    rejectUnknownKeys(c, ['normalizedCost', 'threshold'], 'routingEvidence.costEvidence');
    evidence.costEvidence = {
      normalizedCost: requireNumber(c.normalizedCost ?? null, 'routingEvidence.costEvidence.normalizedCost'),
      threshold: requireNumber(c.threshold ?? null, 'routingEvidence.costEvidence.threshold'),
    };
  }
  if (obj.dataResidency !== undefined) {
    const d = requireObject(obj.dataResidency, 'routingEvidence.dataResidency');
    rejectUnknownKeys(d, ['present'], 'routingEvidence.dataResidency');
    evidence.dataResidency = { present: requireBoolean(d.present ?? null, 'routingEvidence.dataResidency.present') };
  }
  if (obj.humanRequested !== undefined) {
    const h = requireObject(obj.humanRequested, 'routingEvidence.humanRequested');
    rejectUnknownKeys(h, ['requester'], 'routingEvidence.humanRequested');
    evidence.humanRequested = { requester: requireString(h.requester ?? null, 'routingEvidence.humanRequested.requester') };
  }
  if (obj.securitySurfaceTargetKeys !== undefined) {
    evidence.securitySurfaceTargets = new Set(requireCanonicalTargetKeys(obj.securitySurfaceTargetKeys, 'routingEvidence.securitySurfaceTargetKeys'));
  }
  if (obj.regulatedTargetKeys !== undefined) {
    evidence.regulatedTargets = new Set(requireCanonicalTargetKeys(obj.regulatedTargetKeys, 'routingEvidence.regulatedTargetKeys'));
  }
  if (obj.productionTargetKeys !== undefined) {
    evidence.productionTargets = new Set(requireCanonicalTargetKeys(obj.productionTargetKeys, 'routingEvidence.productionTargetKeys'));
  }
  return evidence;
}

/**
 * Parse + strictly validate + normalize a snapshot bundle. Throws SnapshotContractError
 * (⇒ CLI exit 2) on any malformed present data.
 */
export function loadSnapshotBundle(text: string): NormalizedSnapshot {
  const raw = parseSnapshotJson(text);
  const bundle = requireObject(raw, 'snapshot bundle');
  rejectUnknownKeys(
    bundle,
    ['schemaVersion', 'federatedLogs', 'log', 'targets', 'assertionInputs', 'identity', 'scopeEvidence', 'routingEvidence'],
    'snapshot bundle',
  );
  if (bundle.schemaVersion !== 'adrkit.pass0.snapshot/v1') {
    throw new SnapshotContractError('snapshot schemaVersion must be exactly "adrkit.pass0.snapshot/v1"');
  }

  const normalized: {
    federatedLogs?: readonly FederatedLogSnapshot[];
    resolutionLog?: string;
    targets: TargetInventorySnapshots;
    assertionInputs: AssertionInputSnapshot;
    identity?: IdentityDirectorySnapshot;
    scopeEvidence?: ScopeContradictionEvidence;
    routingEvidence?: RoutingTriggerEvidence;
  } = {
    targets: bundle.targets !== undefined ? validateTargets(bundle.targets) : {},
    assertionInputs: bundle.assertionInputs !== undefined ? validateAssertionInputs(bundle.assertionInputs) : { sources: {}, inputs: {} },
  };

  if (bundle.log !== undefined) normalized.resolutionLog = requireString(bundle.log, 'log');
  if (bundle.federatedLogs !== undefined) normalized.federatedLogs = validateFederatedLogs(bundle.federatedLogs);
  if (bundle.identity !== undefined) normalized.identity = validateIdentity(bundle.identity);
  if (bundle.scopeEvidence !== undefined) normalized.scopeEvidence = validateScopeEvidence(bundle.scopeEvidence);
  if (bundle.routingEvidence !== undefined) normalized.routingEvidence = validateRoutingEvidence(bundle.routingEvidence);

  return normalized;
}
