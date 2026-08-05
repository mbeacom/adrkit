/**
 * The consumer's **own, independent** declaration of the snapshot envelope's
 * wire shape.
 *
 * **This duplicates the generator's declaration on purpose.** `spec.md` FR-005
 * and `contracts/package-boundary.md` §5 require it. A shared type module would
 * be an import edge between `@adrkit/catalog-backstage` and this package, and
 * §3 of that contract forbids an edge in either direction. More to the point:
 * if both sides derived their view of the envelope from one declaration, a
 * generator that changed the shape would change it on both sides at once, and
 * this package's structural validation would be comparing the generator against
 * itself rather than checking it.
 *
 * The cost is accepted and named: these two declarations can diverge, and
 * nothing but this package's validation failing will say so. That failure is
 * the intended signal — not drift to be refactored away.
 *
 * **Nothing here is derived from the generator.** Every constant below is
 * transcribed from a contract frozen in `specs/`:
 * `specs/009-catalog-binding-viability/contracts/snapshot-envelope.md` §1–§2
 * (carried forward unchanged by `specs/010-catalog-backstage/contracts/README.md`
 * §2) and `specs/010-catalog-backstage/data-model.md` §9–§10.
 */

/**
 * The only `schemaVersion` this consumer accepts, validated by **exact value**
 * (`snapshot-envelope.md` §2 step 3).
 */
export const ENVELOPE_SCHEMA_VERSION = '1';

/**
 * The frozen matcher contract, validated by **deep exact value** — never by
 * `version` alone. `snapshot-envelope.md` §2 step 3 states plainly that a
 * `globDialect.version`-only check is *insufficient*: an `engine` of
 * `"minimatch"`, or an `options` object with `dot: true` / `nocase: true` /
 * `nonegate: false`, each has to fail.
 */
export const FROZEN_GLOB_DIALECT = {
  engine: 'picomatch',
  version: '4.0.5',
  options: { dot: false, nocase: false, nonegate: true },
} as const;

/**
 * The exact capability tuple, validated by **deep equality on the whole tuple**.
 * `snapshot-envelope.md` §2 step 3: a per-entry-membership-only check is
 * *insufficient*, so an empty array, an extra element, or any other string each
 * has to fail.
 */
export const FROZEN_CAPABILITIES = ['pathOwnership'] as const;

/**
 * Exactly three ownership states; there is no fourth
 * (`data-model.md` §7.2).
 *
 * `explicit-empty` and `annotation-absent` both yield an empty `derivedPaths`
 * and are **not** equivalent. The discriminator is this field; the distinction
 * is never inferred from `derivedPaths`.
 */
export const RECOGNIZED_OWNERSHIP_STATES = [
  'explicit-paths',
  'explicit-empty',
  'annotation-absent',
] as const;

export type OwnershipState = (typeof RECOGNIZED_OWNERSHIP_STATES)[number];

/**
 * The one digest algorithm the envelope's `sources[]` may declare
 * (`snapshot-envelope.md` §1; `data-model.md` §9's `EnvelopeSource`).
 */
export const RECOGNIZED_DIGEST_ALGORITHM = 'sha256';

/**
 * **A genuine gap, marked rather than papered over.**
 *
 * `snapshot-envelope.md` §2 step 2 requires "a recognized `provenance`", but no
 * contract frozen under feature `010-catalog-backstage` enumerates what
 * `provenance` values are recognized. `data-model.md` §10 types the field as a
 * bare `string`, and `spec.md` FR-043 gives it a *semantic* requirement — it
 * must distinguish upstream-authored descriptor content from maintainer-authored
 * annotation overlay — without naming the values that carry the distinction.
 * Spike 009's `data-model.md` line 195 does enumerate three values
 * (`community-plugins-real`, `rhdh-plugins-real`, `synthetic`), but those name
 * that spike's three corpus *passes*, which is a different axis from FR-043's
 * authored-by distinction, so they cannot simply be adopted here.
 *
 * This consumer therefore recognizes any **non-empty string**, and rejects a
 * `provenance` that is missing, not a string, or empty. Inventing a closed
 * vocabulary here would be worse than this: it would make the consumer reject
 * conformant generator output on the strength of a value domain no contract
 * ever froze. The narrower check is adopted deliberately, and the gap is
 * reported rather than closed by guesswork.
 */
export function isRecognizedProvenance(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface EnvelopeRepository {
  readonly id: string;
  readonly revision: string;
}

export interface EnvelopeGlobOptions {
  readonly dot: boolean;
  readonly nocase: boolean;
  readonly nonegate: boolean;
}

export interface EnvelopeGlobDialect {
  readonly engine: string;
  readonly version: string;
  readonly options: EnvelopeGlobOptions;
}

export interface EnvelopeCompleteness {
  readonly wholeCatalog: boolean;
  readonly identityOnly: boolean;
}

export interface EnvelopeSource {
  readonly path: string;
  readonly digestAlgorithm: string;
  /**
   * Optional **in the declared type only**, because the whole point of step 4 is
   * that an envelope can arrive with this omitted. A `sources` entry that is
   * structurally well-formed but omits its digest passes step 2 and is rejected
   * at step 4 (`snapshot-envelope.md` §2). Typing it as required would move that
   * rejection to step 2 and collapse two distinct malformation kinds into one.
   */
  readonly digest?: string;
}

/**
 * The identity projection an envelope carries: `{ canonicalId, allRefs }` and
 * nothing else.
 *
 * `snapshot-envelope.md` §1 is explicit that the pre-lowercase authoring inputs
 * (`rawKind` / `rawNamespace` / `rawName` / `fixtureAuthoredAliasRefs`) are
 * deliberately **not** serialized — they are already fully captured by these two
 * fields.
 */
export interface SerializedEntityIdentity {
  readonly canonicalId: string;
  readonly allRefs: readonly string[];
}

export interface SerializedSourceDocument {
  readonly sourcePath: string;
  readonly documentIndexInFile: number;
}

/**
 * **Exactly five fields** (`data-model.md` §10; `snapshot-envelope.md` §1).
 *
 * A flatter `canonicalId` / `refs` / `paths` triple is forbidden, and so is the
 * generator's full internal record. The on-disk envelope and this declared type
 * are meant to be one shape, not two that drift.
 */
export interface SnapshotEntityRecord {
  readonly identity: SerializedEntityIdentity;
  readonly ownershipState: OwnershipState;
  readonly derivedPaths: readonly string[];
  readonly sourceDocument: SerializedSourceDocument;
  readonly provenance: string;
}

/**
 * **Nine top-level fields** (`data-model.md` §9).
 *
 * One envelope per generation pass, never merged, single-repository only.
 */
export interface SnapshotEnvelope {
  readonly schemaVersion: string;
  readonly repository: EnvelopeRepository;
  readonly generatorVersion: string;
  readonly globDialect: EnvelopeGlobDialect;
  readonly capabilities: readonly string[];
  readonly completeness: EnvelopeCompleteness;
  readonly sources: readonly EnvelopeSource[];
  readonly entities: readonly SnapshotEntityRecord[];
  /** SHA-256 over the canonical form of every field above, 64 lowercase hex. */
  readonly digest: string;
}

/**
 * The nine top-level field names, in the order `snapshot-envelope.md` §1
 * declares them. Exported so a test can assert a **specific observed list**
 * rather than assert an absence and call that coverage (ADR-0016 clause 3).
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

/** The five field names every `SnapshotEntityRecord` carries — no more, no fewer. */
export const ENTITY_RECORD_FIELDS = [
  'identity',
  'ownershipState',
  'derivedPaths',
  'sourceDocument',
  'provenance',
] as const;
