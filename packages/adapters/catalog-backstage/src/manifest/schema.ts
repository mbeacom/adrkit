/**
 * T038 · T039 — the **closed** input-manifest schema.
 *
 * `input-manifest.md` §1 fixes the manifest shape and adds one rule that a
 * conventional schema validator would get backwards: *an unrecognized top-level
 * field is a rejection, not an ignored extra.* Most validators default to stripping
 * or passing through unknown keys; that default is exactly what this contract
 * forbids, because a forward-compatible passthrough field is an unreviewed input
 * reaching a generator that promises its input surface is closed.
 *
 * **Single-repository binding (T039, FR-007).** `repository` is one object. A
 * manifest naming more than one — a `repository` array, or a second top-level
 * `repositories` key — is rejected. ADR-0012's single-repository boundary is not
 * a convention this schema documents; it is a shape this schema cannot express.
 *
 * **Which trigger class the closed-schema rule maps to.** `input-manifest.md` §1
 * calls an unrecognized top-level field an *"unsupported manifest version"-class*
 * rejection. Spike 009's own `atomic-fail-closed.md` §4 then states the opposite
 * more specifically, defining `invalid-manifest-shape` as covering a manifest that
 * "contains an unrecognized top-level field (`contracts/input-manifest.md` §1's
 * closed-schema rule)" and distinguishing it from `unsupported-manifest-version`,
 * "which presumes the manifest parsed correctly and has the right shape but
 * declares an unsupported *value*". This module follows `atomic-fail-closed.md` §4,
 * the later and more specific of the two, and the discrepancy is reported rather
 * than silently resolved.
 *
 * Everything here is pure: it takes text or an already-parsed value and returns a
 * verdict. It opens no file and runs no subprocess.
 *
 * @see `specs/009-catalog-binding-viability/contracts/input-manifest.md` §1
 * @see `specs/010-catalog-backstage/data-model.md` §1
 */

import { type Validated, accepted, rejected } from '../diagnostics.ts';

/** `data-model.md` §1 — the repository this manifest binds the operation to. */
export interface ManifestRepository {
  /** Normalized `github.com/<owner>/<repo>`, lowercase. */
  readonly id: string;
  /** 40 lowercase hex characters. */
  readonly revision: string;
}

/** `data-model.md` §1 — one descriptor file the manifest names. */
export interface ManifestSource {
  /** Repo-relative POSIX. Validated separately, by `manifest/paths.ts` (T044). */
  readonly path: string;
  readonly digestAlgorithm: 'sha256';
  /** 64 lowercase hex characters. */
  readonly digest: string;
}

/** `data-model.md` §1 — the generator's sole declaration of what it may read. */
export interface InputManifest {
  readonly manifestSchemaVersion: string;
  readonly requestedSnapshotSchemaVersion: string;
  readonly requiredCapabilities: readonly string[];
  readonly repository: ManifestRepository;
  readonly sources: readonly ManifestSource[];
}

/**
 * Fine-grained schema rejection reasons.
 *
 * All map to the `invalid-manifest-shape` trigger class. They are kept distinct
 * from one another because ADR-0016 records the *exact emitted string*, and a
 * single `invalid-manifest-shape` for all seven conditions would make six of the
 * seven negative cases indistinguishable from one another in the evidence tree.
 */
export type ManifestSchemaReason =
  | 'manifest-not-json'
  | 'manifest-not-an-object'
  | 'unrecognized-top-level-field'
  | 'missing-required-field'
  | 'field-wrong-type'
  | 'multiple-repositories'
  | 'unrecognized-nested-field';

/**
 * The five top-level fields `data-model.md` §1 defines, and the only five a
 * manifest may carry. Order is the contract's own.
 */
export const MANIFEST_TOP_LEVEL_FIELDS = [
  'manifestSchemaVersion',
  'requestedSnapshotSchemaVersion',
  'requiredCapabilities',
  'repository',
  'sources',
] as const;

/** The only two fields a `repository` object may carry. */
export const MANIFEST_REPOSITORY_FIELDS = ['id', 'revision'] as const;

/** The only three fields a `sources[]` entry may carry. */
export const MANIFEST_SOURCE_FIELDS = ['path', 'digestAlgorithm', 'digest'] as const;

type SchemaResult<T> = Validated<T, ManifestSchemaReason>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The closed-schema check, applied at one nesting level.
 *
 * Returns the *first* unrecognized key in the object's own enumeration order, so a
 * manifest carrying two unknown fields reports one deterministically rather than
 * whichever a `Set` iteration happened to surface first.
 */
function firstUnrecognizedKey(
  object: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) return key;
  }
  return undefined;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function requireString(
  object: Record<string, unknown>,
  field: string,
  where: string,
): SchemaResult<string> {
  if (!(field in object)) {
    return rejected(
      'missing-required-field',
      'invalid-manifest-shape',
      `${where}.${field} is required and is absent`,
    );
  }
  const value = object[field];
  if (typeof value !== 'string') {
    return rejected(
      'field-wrong-type',
      'invalid-manifest-shape',
      `${where}.${field} must be a string; observed ${describeType(value)}`,
    );
  }
  return accepted(value);
}

function parseRepository(value: unknown): SchemaResult<ManifestRepository> {
  // T039 / FR-007. A sequence under `repository` is the shape a multi-repository
  // manifest takes, so it is named rather than folded into `field-wrong-type`.
  if (Array.isArray(value)) {
    return rejected(
      'multiple-repositories',
      'invalid-manifest-shape',
      `repository must name exactly one repository; observed an array of ${value.length}`,
    );
  }
  if (!isPlainObject(value)) {
    return rejected(
      'field-wrong-type',
      'invalid-manifest-shape',
      `repository must be an object; observed ${describeType(value)}`,
    );
  }
  const unknownKey = firstUnrecognizedKey(value, MANIFEST_REPOSITORY_FIELDS);
  if (unknownKey !== undefined) {
    return rejected(
      'unrecognized-nested-field',
      'invalid-manifest-shape',
      `repository.${unknownKey} is not a recognized field`,
    );
  }
  const id = requireString(value, 'id', 'repository');
  if (!id.ok) return id;
  const revision = requireString(value, 'revision', 'repository');
  if (!revision.ok) return revision;
  return accepted({ id: id.value, revision: revision.value });
}

function parseSource(value: unknown, index: number): SchemaResult<ManifestSource> {
  const where = `sources[${index}]`;
  if (!isPlainObject(value)) {
    return rejected(
      'field-wrong-type',
      'invalid-manifest-shape',
      `${where} must be an object; observed ${describeType(value)}`,
    );
  }
  const unknownKey = firstUnrecognizedKey(value, MANIFEST_SOURCE_FIELDS);
  if (unknownKey !== undefined) {
    return rejected(
      'unrecognized-nested-field',
      'invalid-manifest-shape',
      `${where}.${unknownKey} is not a recognized field`,
    );
  }
  const path = requireString(value, 'path', where);
  if (!path.ok) return path;
  const digestAlgorithm = requireString(value, 'digestAlgorithm', where);
  if (!digestAlgorithm.ok) return digestAlgorithm;
  if (digestAlgorithm.value !== 'sha256') {
    return rejected(
      'field-wrong-type',
      'invalid-manifest-shape',
      `${where}.digestAlgorithm must be "sha256"; observed ${JSON.stringify(digestAlgorithm.value)}`,
    );
  }
  const digest = requireString(value, 'digest', where);
  if (!digest.ok) return digest;
  return accepted({
    path: path.value,
    digestAlgorithm: 'sha256',
    digest: digest.value,
  });
}

/**
 * Validate an already-decoded JSON value against the closed schema.
 *
 * Separate from {@link parseManifestText} so a caller holding a value rather than
 * text — a test, most of all — does not have to round-trip through JSON to reach
 * the schema rules.
 */
export function validateManifestShape(value: unknown): SchemaResult<InputManifest> {
  if (!isPlainObject(value)) {
    return rejected(
      'manifest-not-an-object',
      'invalid-manifest-shape',
      `the manifest must be a JSON object; observed ${describeType(value)}`,
    );
  }

  // The closed-schema rule runs first. An unrecognized field is a rejection even
  // when every recognized field is present and well-typed — that is the whole
  // content of "closed".
  const unknownKey = firstUnrecognizedKey(value, MANIFEST_TOP_LEVEL_FIELDS);
  if (unknownKey !== undefined) {
    return rejected(
      'unrecognized-top-level-field',
      'invalid-manifest-shape',
      `${unknownKey} is not a recognized top-level manifest field`,
    );
  }

  const manifestSchemaVersion = requireString(value, 'manifestSchemaVersion', 'manifest');
  if (!manifestSchemaVersion.ok) return manifestSchemaVersion;

  const requestedSnapshotSchemaVersion = requireString(
    value,
    'requestedSnapshotSchemaVersion',
    'manifest',
  );
  if (!requestedSnapshotSchemaVersion.ok) return requestedSnapshotSchemaVersion;

  if (!('requiredCapabilities' in value)) {
    return rejected(
      'missing-required-field',
      'invalid-manifest-shape',
      'manifest.requiredCapabilities is required and is absent',
    );
  }
  const rawCapabilities = value['requiredCapabilities'];
  if (!Array.isArray(rawCapabilities)) {
    return rejected(
      'field-wrong-type',
      'invalid-manifest-shape',
      `manifest.requiredCapabilities must be an array; observed ${describeType(rawCapabilities)}`,
    );
  }
  const capabilities: string[] = [];
  for (const [index, capability] of rawCapabilities.entries()) {
    if (typeof capability !== 'string') {
      return rejected(
        'field-wrong-type',
        'invalid-manifest-shape',
        `manifest.requiredCapabilities[${index}] must be a string; observed ${describeType(capability)}`,
      );
    }
    capabilities.push(capability);
  }

  if (!('repository' in value)) {
    return rejected(
      'missing-required-field',
      'invalid-manifest-shape',
      'manifest.repository is required and is absent',
    );
  }
  const repository = parseRepository(value['repository']);
  if (!repository.ok) return repository;

  if (!('sources' in value)) {
    return rejected(
      'missing-required-field',
      'invalid-manifest-shape',
      'manifest.sources is required and is absent',
    );
  }
  const rawSources = value['sources'];
  if (!Array.isArray(rawSources)) {
    return rejected(
      'field-wrong-type',
      'invalid-manifest-shape',
      `manifest.sources must be an array; observed ${describeType(rawSources)}`,
    );
  }
  const sources: ManifestSource[] = [];
  for (const [index, rawSource] of rawSources.entries()) {
    const source = parseSource(rawSource, index);
    if (!source.ok) return source;
    sources.push(source.value);
  }

  return accepted({
    manifestSchemaVersion: manifestSchemaVersion.value,
    requestedSnapshotSchemaVersion: requestedSnapshotSchemaVersion.value,
    requiredCapabilities: capabilities,
    repository: repository.value,
    sources,
  });
}

/** Decode manifest JSON text, then apply {@link validateManifestShape}. */
export function parseManifestText(text: string): SchemaResult<InputManifest> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch (error) {
    return rejected(
      'manifest-not-json',
      'invalid-manifest-shape',
      `the manifest is not valid JSON: ${(error as Error).message}`,
    );
  }
  return validateManifestShape(decoded);
}
