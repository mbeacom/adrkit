/**
 * The **five ordered consumer validation steps**
 * (`specs/009-catalog-binding-viability/contracts/snapshot-envelope.md` §2,
 * carried forward unchanged by feature 010; `spec.md` FR-045;
 * `data-model.md` §11).
 *
 * The order is the contract, not an implementation detail. Each step rejects
 * with **its own** reason, and no later check — digest, revision, or repository
 * identity — is attempted until every one of the five has passed. Getting the
 * order wrong would let an envelope be rejected for the wrong reason, which is
 * indistinguishable in a log from being rejected for the right one.
 *
 * **What a pass here does and does not establish.** All five passing means the
 * envelope is *structurally intelligible*. It says nothing about whether the
 * ownership it records is right. That question is not answerable by this
 * package at all.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENTITY_RECORD_FIELDS,
  ENVELOPE_SCHEMA_VERSION,
  ENVELOPE_TOP_LEVEL_FIELDS,
  FROZEN_CAPABILITIES,
  FROZEN_GLOB_DIALECT,
  RECOGNIZED_DIGEST_ALGORITHM,
  RECOGNIZED_OWNERSHIP_STATES,
  isRecognizedProvenance,
  type SnapshotEnvelope,
} from '../envelope-shape.ts';

/**
 * The five reasons, one per step (`data-model.md` §11). This union is closed:
 * there is no sixth reason, and no step emits a reason belonging to another.
 */
export type EnvelopeRejectionReason =
  | 'invalid-json'
  | 'missing-or-wrong-required-field'
  | 'unrecognized-schema-or-dialect-or-capability'
  | 'missing-source-digest'
  | 'identity-only-true';

export type ValidationStep = 1 | 2 | 3 | 4 | 5;

/** The step each reason belongs to. Frozen 1:1 by `snapshot-envelope.md` §2. */
export const REASON_STEP: Readonly<Record<EnvelopeRejectionReason, ValidationStep>> = {
  'invalid-json': 1,
  'missing-or-wrong-required-field': 2,
  'unrecognized-schema-or-dialect-or-capability': 3,
  'missing-source-digest': 4,
  'identity-only-true': 5,
};

/**
 * What the validator actually looked at, reported alongside what it concluded.
 *
 * This is ADR-0016's complementary half: "report what was examined, not only
 * what was concluded", so that a reader can tell *looked and found nothing*
 * from *could not look*. Without it, a validator that silently inspected zero
 * entity records would render identically to one that inspected all of them and
 * found them sound.
 */
export interface EnvelopeExamination {
  /** Entity records step 2 inspected, including the one it rejected on. */
  readonly entityRecordsInspected: number;
  /** Source paths step 4 actually opened and hashed, in declaration order. */
  readonly sourcesVerified: readonly string[];
  /** The highest step reached, whether or not it passed. */
  readonly stepsReached: ValidationStep;
}

const VALIDATED: unique symbol = Symbol('adrkit.catalog-envelope.structurally-valid');

/**
 * An envelope that has passed **all five** steps.
 *
 * The brand is a module-private symbol, so this token cannot be forged by a
 * caller assembling an object literal. It is what makes "no derived value is
 * read before validation" a property of the type system and of the runtime,
 * rather than a convention a later edit could quietly drop.
 */
export interface StructurallyValidEnvelope {
  readonly [VALIDATED]: true;
  readonly envelope: SnapshotEnvelope;
}

export interface EnvelopeValidationValid {
  readonly outcome: 'valid';
  readonly failedStep: undefined;
  readonly reason: undefined;
  readonly detail: undefined;
  readonly examined: EnvelopeExamination;
  readonly validated: StructurallyValidEnvelope;
}

export interface EnvelopeValidationRejected {
  readonly outcome: 'rejected';
  readonly failedStep: ValidationStep;
  readonly reason: EnvelopeRejectionReason;
  /**
   * Human-readable specifics. Never load-bearing: the reason and the step are
   * what callers branch on. This exists so a rejection names *which* field or
   * *which* source failed instead of only naming its category.
   */
  readonly detail: string;
  readonly examined: EnvelopeExamination;
  readonly validated: undefined;
}

export type EnvelopeValidationResult = EnvelopeValidationValid | EnvelopeValidationRejected;

export interface ValidateOptions {
  /**
   * Directory that `sources[].path` entries are resolved against for step 4.
   *
   * Required, and deliberately not defaulted to the process's working
   * directory: a step-4 digest check silently reading the wrong tree would pass
   * or fail for reasons unrelated to the envelope.
   */
  readonly sourceBaseDir: string;
}

/** Unwraps a validated envelope. The only way to reach the payload. */
export function envelopeOf(validated: StructurallyValidEnvelope): SnapshotEnvelope {
  return validated.envelope;
}

/** True only for a token this module minted. */
export function isStructurallyValidEnvelope(value: unknown): value is StructurallyValidEnvelope {
  return (
    typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[VALIDATED] === true
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((element) => typeof element === 'string');
}

function reject(
  reason: EnvelopeRejectionReason,
  detail: string,
  examined: EnvelopeExamination,
): EnvelopeValidationRejected {
  return {
    outcome: 'rejected',
    failedStep: REASON_STEP[reason],
    reason,
    detail,
    examined,
    validated: undefined,
  };
}

function examination(
  stepsReached: ValidationStep,
  entityRecordsInspected: number,
  sourcesVerified: readonly string[],
): EnvelopeExamination {
  return { entityRecordsInspected, sourcesVerified, stepsReached };
}

/**
 * Step 2's shape check for one entity record.
 *
 * Returns a detail string on failure, `undefined` on success.
 *
 * **The single `derivedPaths` property read in the whole validator lives here**,
 * on the line marked below, and it is a *type inspection*: the array is read
 * once to confirm it is an array of strings, and its contents are never
 * consumed, compared, matched, or returned. Every other reference to
 * `derivedPaths` in this package is in the type declaration
 * (`envelope-shape.ts`) or behind the admission gate (`snapshot/index.ts`).
 * `test/no-early-read.test.ts` counts these reads and enforces that discipline.
 */
function checkEntityRecord(record: unknown, index: number): string | undefined {
  if (!isPlainObject(record)) return `entities[${index}] is not an object`;

  const extra = Object.keys(record).filter(
    (key) => !(ENTITY_RECORD_FIELDS as readonly string[]).includes(key),
  );
  if (extra.length > 0) {
    return `entities[${index}] carries unrecognized field(s) ${extra.join(', ')}; exactly ${ENTITY_RECORD_FIELDS.length} fields are defined`;
  }

  const identity = record['identity'];
  if (!isPlainObject(identity)) return `entities[${index}].identity is not an object`;
  if (typeof identity['canonicalId'] !== 'string') {
    return `entities[${index}].identity.canonicalId is not a string`;
  }
  if (!isStringArray(identity['allRefs'])) return `entities[${index}].identity.allRefs is not a string array`;
  if (identity['allRefs'].length === 0) return `entities[${index}].identity.allRefs is empty`;

  const ownershipState = record['ownershipState'];
  if (
    typeof ownershipState !== 'string' ||
    !(RECOGNIZED_OWNERSHIP_STATES as readonly string[]).includes(ownershipState)
  ) {
    return `entities[${index}].ownershipState is not one of ${RECOGNIZED_OWNERSHIP_STATES.join(' | ')}`;
  }

  const derivedPaths = record['derivedPaths']; // STEP-2 TYPE INSPECTION — the only read
  if (!isStringArray(derivedPaths)) return `entities[${index}].derivedPaths is not a string array`;

  const sourceDocument = record['sourceDocument'];
  if (!isPlainObject(sourceDocument)) return `entities[${index}].sourceDocument is not an object`;
  if (typeof sourceDocument['sourcePath'] !== 'string') {
    return `entities[${index}].sourceDocument.sourcePath is not a string`;
  }
  const documentIndexInFile = sourceDocument['documentIndexInFile'];
  if (
    typeof documentIndexInFile !== 'number' ||
    !Number.isInteger(documentIndexInFile) ||
    documentIndexInFile < 0
  ) {
    return `entities[${index}].sourceDocument.documentIndexInFile is not a non-negative integer`;
  }

  if (!isRecognizedProvenance(record['provenance'])) {
    return `entities[${index}].provenance is not a recognized (non-empty string) provenance`;
  }

  return undefined;
}

/** Step 2's shape check for one `sources[]` entry. Digest presence is step 4's job. */
function checkSourceEntry(entry: unknown, index: number): string | undefined {
  if (!isPlainObject(entry)) return `sources[${index}] is not an object`;
  if (typeof entry['path'] !== 'string') return `sources[${index}].path is not a string`;
  if (typeof entry['digestAlgorithm'] !== 'string') {
    return `sources[${index}].digestAlgorithm is not a string`;
  }
  const digest = entry['digest'];
  if (digest !== undefined && typeof digest !== 'string') {
    return `sources[${index}].digest is present but not a string`;
  }
  const extra = Object.keys(entry).filter((key) => !['path', 'digestAlgorithm', 'digest'].includes(key));
  if (extra.length > 0) return `sources[${index}] carries unrecognized field(s) ${extra.join(', ')}`;
  return undefined;
}

/**
 * Steps 2 through 5, against an already-parsed value.
 *
 * Exported as a seam so a test can drive validation with an **instrumented**
 * object and count property reads. Step 1 is skipped here by construction: a
 * value that is already a JavaScript value has, trivially, parsed.
 */
export function validateParsedEnvelope(
  value: unknown,
  options: ValidateOptions,
): EnvelopeValidationResult {
  // ---- Step 2: complete shape, correct JSON type, at every nesting level ----
  let inspected = 0;
  const at2 = (): EnvelopeExamination => examination(2, inspected, []);

  if (!isPlainObject(value)) {
    return reject('missing-or-wrong-required-field', 'envelope is not a JSON object', at2());
  }

  const missing = ENVELOPE_TOP_LEVEL_FIELDS.filter((field) => !(field in value));
  if (missing.length > 0) {
    return reject('missing-or-wrong-required-field', `missing top-level field(s) ${missing.join(', ')}`, at2());
  }
  const extraTop = Object.keys(value).filter(
    (key) => !(ENVELOPE_TOP_LEVEL_FIELDS as readonly string[]).includes(key),
  );
  if (extraTop.length > 0) {
    return reject(
      'missing-or-wrong-required-field',
      `unrecognized top-level field(s) ${extraTop.join(', ')}; exactly ${ENVELOPE_TOP_LEVEL_FIELDS.length} fields are defined`,
      at2(),
    );
  }

  if (typeof value['schemaVersion'] !== 'string') {
    return reject('missing-or-wrong-required-field', 'schemaVersion is not a string', at2());
  }
  if (typeof value['generatorVersion'] !== 'string') {
    return reject('missing-or-wrong-required-field', 'generatorVersion is not a string', at2());
  }
  if (typeof value['digest'] !== 'string') {
    return reject('missing-or-wrong-required-field', 'digest is not a string', at2());
  }

  const repository = value['repository'];
  if (!isPlainObject(repository)) {
    return reject('missing-or-wrong-required-field', 'repository is not an object', at2());
  }
  if (typeof repository['id'] !== 'string') {
    return reject('missing-or-wrong-required-field', 'repository.id is not a string', at2());
  }
  if (typeof repository['revision'] !== 'string') {
    return reject('missing-or-wrong-required-field', 'repository.revision is not a string', at2());
  }

  const globDialect = value['globDialect'];
  if (!isPlainObject(globDialect)) {
    return reject('missing-or-wrong-required-field', 'globDialect is not an object', at2());
  }
  if (typeof globDialect['engine'] !== 'string' || typeof globDialect['version'] !== 'string') {
    return reject(
      'missing-or-wrong-required-field',
      'globDialect.engine or globDialect.version is not a string',
      at2(),
    );
  }
  const globOptions = globDialect['options'];
  if (!isPlainObject(globOptions)) {
    return reject('missing-or-wrong-required-field', 'globDialect.options is not an object', at2());
  }
  for (const flag of ['dot', 'nocase', 'nonegate'] as const) {
    if (typeof globOptions[flag] !== 'boolean') {
      return reject('missing-or-wrong-required-field', `globDialect.options.${flag} is not a boolean`, at2());
    }
  }

  if (!isStringArray(value['capabilities'])) {
    return reject('missing-or-wrong-required-field', 'capabilities is not a string array', at2());
  }

  const completeness = value['completeness'];
  if (!isPlainObject(completeness)) {
    return reject('missing-or-wrong-required-field', 'completeness is not an object', at2());
  }
  for (const flag of ['wholeCatalog', 'identityOnly'] as const) {
    if (typeof completeness[flag] !== 'boolean') {
      return reject('missing-or-wrong-required-field', `completeness.${flag} is not a boolean`, at2());
    }
  }

  const sources = value['sources'];
  if (!Array.isArray(sources)) {
    return reject('missing-or-wrong-required-field', 'sources is not an array', at2());
  }
  for (let index = 0; index < sources.length; index += 1) {
    const detail = checkSourceEntry(sources[index], index);
    if (detail !== undefined) return reject('missing-or-wrong-required-field', detail, at2());
  }

  const entities = value['entities'];
  if (!Array.isArray(entities)) {
    return reject('missing-or-wrong-required-field', 'entities is not an array', at2());
  }
  for (let index = 0; index < entities.length; index += 1) {
    inspected += 1;
    const detail = checkEntityRecord(entities[index], index);
    if (detail !== undefined) return reject('missing-or-wrong-required-field', detail, at2());
  }

  // ---- Step 3: the frozen matcher contract, by exact value ----
  const at3 = (): EnvelopeExamination => examination(3, inspected, []);

  if (value['schemaVersion'] !== ENVELOPE_SCHEMA_VERSION) {
    return reject(
      'unrecognized-schema-or-dialect-or-capability',
      `schemaVersion is ${JSON.stringify(value['schemaVersion'])}, expected ${JSON.stringify(ENVELOPE_SCHEMA_VERSION)}`,
      at3(),
    );
  }
  if (globDialect['engine'] !== FROZEN_GLOB_DIALECT.engine) {
    return reject(
      'unrecognized-schema-or-dialect-or-capability',
      `globDialect.engine is ${JSON.stringify(globDialect['engine'])}, expected ${JSON.stringify(FROZEN_GLOB_DIALECT.engine)}`,
      at3(),
    );
  }
  if (globDialect['version'] !== FROZEN_GLOB_DIALECT.version) {
    return reject(
      'unrecognized-schema-or-dialect-or-capability',
      `globDialect.version is ${JSON.stringify(globDialect['version'])}, expected ${JSON.stringify(FROZEN_GLOB_DIALECT.version)}`,
      at3(),
    );
  }
  for (const flag of ['dot', 'nocase', 'nonegate'] as const) {
    if (globOptions[flag] !== FROZEN_GLOB_DIALECT.options[flag]) {
      return reject(
        'unrecognized-schema-or-dialect-or-capability',
        `globDialect.options.${flag} is ${String(globOptions[flag])}, expected ${String(FROZEN_GLOB_DIALECT.options[flag])}`,
        at3(),
      );
    }
  }

  const capabilities = value['capabilities'];
  const capabilitiesMatch =
    capabilities.length === FROZEN_CAPABILITIES.length &&
    FROZEN_CAPABILITIES.every((expected, index) => capabilities[index] === expected);
  if (!capabilitiesMatch) {
    return reject(
      'unrecognized-schema-or-dialect-or-capability',
      `capabilities is ${JSON.stringify(capabilities)}, expected exactly ${JSON.stringify(FROZEN_CAPABILITIES)}`,
      at3(),
    );
  }

  // ---- Step 4: every source digest present, correctly typed, matching bytes ----
  const verified: string[] = [];
  const at4 = (): EnvelopeExamination => examination(4, inspected, [...verified]);

  for (let index = 0; index < sources.length; index += 1) {
    const entry = sources[index] as Record<string, unknown>;
    const path = entry['path'] as string;
    const declared = entry['digest'];
    if (typeof declared !== 'string') {
      return reject('missing-source-digest', `sources[${index}] (${path}) declares no digest`, at4());
    }
    const algorithm = entry['digestAlgorithm'] as string;
    if (algorithm !== RECOGNIZED_DIGEST_ALGORITHM) {
      return reject(
        'missing-source-digest',
        `sources[${index}] (${path}) declares digestAlgorithm ${JSON.stringify(algorithm)}, which this consumer cannot verify; expected ${JSON.stringify(RECOGNIZED_DIGEST_ALGORITHM)}`,
        at4(),
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(options.sourceBaseDir, path));
    } catch (error) {
      return reject(
        'missing-source-digest',
        `sources[${index}] (${path}) could not be read from ${options.sourceBaseDir}, so its digest cannot be matched: ${String(error)}`,
        at4(),
      );
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    verified.push(path);
    if (actual !== declared) {
      return reject(
        'missing-source-digest',
        `sources[${index}] (${path}) declares digest ${declared} but its bytes hash to ${actual}`,
        at4(),
      );
    }
  }

  // ---- Step 5: completeness.identityOnly === false ----
  const at5 = (): EnvelopeExamination => examination(5, inspected, [...verified]);

  if (completeness['identityOnly'] !== false) {
    return reject(
      'identity-only-true',
      'completeness.identityOnly is true, so this envelope is partial/identity-only and unusable for path-ownership matching',
      at5(),
    );
  }

  return {
    outcome: 'valid',
    failedStep: undefined,
    reason: undefined,
    detail: undefined,
    examined: at5(),
    validated: { [VALIDATED]: true, envelope: value as unknown as SnapshotEnvelope },
  };
}

/**
 * The full five-step validation, from raw envelope text.
 *
 * Step 1 is here and nowhere else: an envelope that does not parse is rejected
 * before any structural claim is made about it.
 */
export function validateEnvelope(text: string, options: ValidateOptions): EnvelopeValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return reject('invalid-json', `envelope does not parse as JSON: ${String(error)}`, examination(1, 0, []));
  }
  return validateParsedEnvelope(parsed, options);
}
