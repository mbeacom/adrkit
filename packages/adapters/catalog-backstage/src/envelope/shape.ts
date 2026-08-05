/**
 * T080 — the envelope's declared fields, and **exactly five** fields per `entities[]`
 * record. The flatter triple shape is forbidden.
 *
 * # The shape
 *
 * `data-model.md` §9 — **nine** top-level fields (counted from its type block, lines
 * 392–402, read in this worktree): `schemaVersion`, `repository`, `generatorVersion`,
 * `globDialect`, `capabilities`, `completeness`, `sources`, `entities`, `digest`.
 *
 * `data-model.md` §10 and `snapshot-envelope.md` §1 — **five** fields per entity
 * record: a nested `identity` of `{ canonicalId, allRefs }`, `ownershipState`,
 * `derivedPaths`, a serialized `sourceDocument` of
 * `{ sourcePath, documentIndexInFile }`, and `provenance`.
 *
 * # Why "exactly five" is a real constraint and not a restatement of the type
 *
 * §10: "A flatter shape is **forbidden**... never a flatter `canonicalId` / `refs` /
 * `paths` triple, and never the full internal objects — so that the on-disk envelope
 * and the declared type are one identical defined type rather than two
 * independently-drifting shapes for the same record."
 *
 * A TypeScript interface does not enforce this. Excess-property checking applies to
 * object literals, not to values that arrive through a variable, and it is erased
 * entirely at runtime — so a record built by spreading an internal object would
 * typecheck and would serialize with extra fields. {@link ENTITY_RECORD_FIELDS} exists
 * so the constraint can be checked against the **emitted JSON**, which is the only
 * place it is actually observable.
 *
 * The identity projection is `{ canonicalId, allRefs }` **only**. `snapshot-envelope.md`
 * §1 gives the reason: `rawKind`/`rawNamespace`/`rawName` are "pre-lowercase authoring
 * inputs already fully captured by `canonicalId` and `allRefs`". Serializing them would
 * put the authored casing back into an artifact whose whole point is the canonical
 * form.
 *
 * # This shape is declared here, and independently in the consumer, on purpose
 *
 * `package-boundary.md` §5: both packages declare the envelope's shape independently,
 * and that is "the single deliberate duplication in the design", because a shared type
 * module would be an import edge and "if both packages derived their view of the
 * envelope from one declaration, the consumer could not detect a generator that had
 * changed the shape — the shape would have changed on both sides at once."
 *
 * So this module must **not** import anything from `@adrkit/catalog-envelope`, and the
 * cost — that the two declarations can diverge — is accepted, with the consumer's
 * validation failing as the intended signal.
 *
 * # Field order in the emitted object
 *
 * Irrelevant to the digest, which sorts keys at every level
 * (`snapshot-envelope.md` §3), and irrelevant to a JSON reader. It is nonetheless
 * fixed here in the contract's own order, because `envelope/write.ts` serializes with
 * `JSON.stringify`, whose output follows insertion order — so a stable order is what
 * makes the **file** byte-identical across runs (FR-042), independently of the digest.
 *
 * @see `specs/010-catalog-backstage/data-model.md` §9, §10
 * @see `specs/009-catalog-binding-viability/contracts/snapshot-envelope.md` §1
 * @see `specs/010-catalog-backstage/spec.md` FR-039
 */

import type { GLOB_OPTIONS } from '../glob/dialect.ts';
import type { OwnershipState } from '../ownership/states.ts';
import type { EnvelopeCompleteness } from './completeness.ts';
import type { AnnotationProvenance } from './provenance.ts';

/** The only `schemaVersion` this generator emits. `snapshot-envelope.md` §1. */
export const ENVELOPE_SCHEMA_VERSION = '1';

/** The only capability tuple this generator emits. `snapshot-envelope.md` §2 step 3. */
export const ENVELOPE_CAPABILITIES = ['pathOwnership'] as const;

/** `data-model.md` §9's `repository`. */
export interface EnvelopeRepository {
  readonly id: string;
  readonly revision: string;
}

/** `data-model.md` §9's `globDialect`. */
export interface EnvelopeGlobDialect {
  readonly engine: string;
  readonly version: string;
  readonly options: typeof GLOB_OPTIONS;
}

/** `data-model.md` §9's `EnvelopeSource`. */
export interface EnvelopeSource {
  readonly path: string;
  readonly digestAlgorithm: 'sha256';
  readonly digest: string;
}

/** `data-model.md` §10's reduced identity projection. Two fields, never more. */
export interface SerializedEntityIdentity {
  readonly canonicalId: string;
  /** Non-empty. `canonicalId` is always a member. */
  readonly allRefs: readonly string[];
}

/** `data-model.md` §10's serialized source reference. */
export interface SerializedSourceDocument {
  readonly sourcePath: string;
  readonly documentIndexInFile: number;
}

/** `data-model.md` §10 — **exactly five** fields. */
export interface SnapshotEntityRecord {
  readonly identity: SerializedEntityIdentity;
  readonly ownershipState: OwnershipState;
  readonly derivedPaths: readonly string[];
  readonly sourceDocument: SerializedSourceDocument;
  readonly provenance: AnnotationProvenance;
}

/** `data-model.md` §9 — **nine** top-level fields. */
export interface SnapshotEnvelope {
  readonly schemaVersion: string;
  readonly repository: EnvelopeRepository;
  readonly generatorVersion: string;
  readonly globDialect: EnvelopeGlobDialect;
  readonly capabilities: readonly string[];
  readonly completeness: EnvelopeCompleteness;
  readonly sources: readonly EnvelopeSource[];
  readonly entities: readonly SnapshotEntityRecord[];
  /** SHA-256 over the canonical form of every other field. `envelope/digest.ts`. */
  readonly digest: string;
}

/**
 * The nine top-level field names, in `data-model.md` §9's order.
 *
 * Data rather than only a type, because a type union is erased at runtime and cannot be
 * counted — the same argument `src/diagnostics.ts` makes for `TRIGGER_CLASSES`.
 */
export const ENVELOPE_TOP_LEVEL_FIELDS = [
  'schemaVersion',
  'repository',
  'generatorVersion',
  'globDialect',
  'capabilities',
  'completeness',
  'sources',
  'entities',
  'digest',
] as const;

/** The five entity-record field names, in `data-model.md` §10's order. */
export const ENTITY_RECORD_FIELDS = [
  'identity',
  'ownershipState',
  'derivedPaths',
  'sourceDocument',
  'provenance',
] as const;

/** The two field names of the reduced identity projection. */
export const IDENTITY_PROJECTION_FIELDS = ['canonicalId', 'allRefs'] as const;

/**
 * The field names §10 forbids at the top level of an entity record.
 *
 * Enumerated so the check tests for the **specific** forbidden shape rather than
 * inferring it from a field count. A record carrying `canonicalId`, `refs` and `paths`
 * has three fields, so a count-only check would reject it for the wrong reason and
 * would keep passing if someone later added two more fields to reach five.
 */
export const FORBIDDEN_FLAT_ENTITY_FIELDS = [
  'canonicalId',
  'refs',
  'paths',
  'rawKind',
  'rawNamespace',
  'rawName',
] as const;

/** Everything the pipeline has determined by the time an entity record is built. */
export interface EntityRecordInput {
  readonly canonicalId: string;
  readonly allRefs: readonly string[];
  readonly ownershipState: OwnershipState;
  readonly derivedPaths: readonly string[];
  readonly sourcePath: string;
  readonly documentIndexInFile: number;
  readonly provenance: AnnotationProvenance;
}

/**
 * Project one entity onto the five-field record.
 *
 * Written field by field, never by spreading the pipeline's internal entity. A spread
 * would carry whatever the internal type happened to hold — including the pre-lowercase
 * authoring fields §1 excludes — and would keep doing so silently as that type grew.
 * Naming the five is what makes the projection a projection.
 */
export function entityRecord(input: EntityRecordInput): SnapshotEntityRecord {
  return {
    identity: { canonicalId: input.canonicalId, allRefs: input.allRefs },
    ownershipState: input.ownershipState,
    derivedPaths: input.derivedPaths,
    sourceDocument: {
      sourcePath: input.sourcePath,
      documentIndexInFile: input.documentIndexInFile,
    },
    provenance: input.provenance,
  };
}

/** Everything the pipeline has determined by the time the envelope is assembled. */
export interface EnvelopeInput {
  readonly repository: EnvelopeRepository;
  readonly generatorVersion: string;
  readonly globDialect: EnvelopeGlobDialect;
  readonly completeness: EnvelopeCompleteness;
  readonly sources: readonly EnvelopeSource[];
  readonly entities: readonly SnapshotEntityRecord[];
  readonly digest: string;
}

/**
 * Assemble the nine-field envelope.
 *
 * `schemaVersion` and `capabilities` are not parameters: `snapshot-envelope.md` §2
 * step 3 requires the consumer validate both "by **exact value**, not merely
 * 'recognized'", so a generator that could emit a different value would be a generator
 * that could emit an envelope its own consumer rejects. `capabilities` is spread into a
 * fresh array so the module-level tuple cannot be mutated through the envelope.
 */
export function assembleEnvelope(input: EnvelopeInput): SnapshotEnvelope {
  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    repository: input.repository,
    generatorVersion: input.generatorVersion,
    globDialect: input.globDialect,
    capabilities: [...ENVELOPE_CAPABILITIES],
    completeness: input.completeness,
    sources: input.sources,
    entities: input.entities,
    digest: input.digest,
  };
}
