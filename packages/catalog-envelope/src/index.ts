/**
 * `@adrkit/catalog-envelope` — the consumer's only public entry point.
 *
 * **What this package is.** An *integrity* validator. It reads a snapshot
 * envelope, checks that the envelope is structurally well-formed, internally
 * consistent, self-consistent with its declared digests, current, and about the
 * repository asking — and only then derives a `CatalogSnapshot`-shaped artifact
 * from it (`spec.md` FR-045 through FR-049).
 *
 * **What this package is not.** A correctness oracle. A populated,
 * digest-verified envelope proves integrity, not correctness: a semantically
 * wrong envelope can carry a perfectly valid self-digest (ADR-0020 clause 5).
 * Everything this package can conclude is a statement about whether an envelope
 * is intact and current — never a statement about whether its contents are
 * *right*.
 *
 * **The boundary.** This package neither imports from nor is imported by
 * `@adrkit/catalog-backstage` (`spec.md` FR-044). The envelope file on disk is
 * the entire interface between them, and each declares the envelope's shape
 * independently. That duplication is deliberate: were both sides to derive their
 * view of the envelope from one shared declaration, a generator that changed the
 * shape would change it on both sides at once, and this package's validation
 * would be comparing the generator against itself.
 *
 * **The ordering, which is the contract.** Five validation steps, then digest
 * recomputation, then staleness, then repository identity — and only then
 * derivation. {@link admitEnvelope} is the single entry that runs all of it, and
 * {@link deriveCatalogSnapshot} refuses anything it did not admit.
 *
 * @see {@link ../README.md}
 * @see `specs/010-catalog-backstage/contracts/package-boundary.md`
 * @see `specs/009-catalog-binding-viability/contracts/snapshot-envelope.md`
 */

/**
 * This package's own name.
 *
 * Exported so that a test can assert a *specific observed value* obtained by
 * statically importing this module, rather than asserting an absence and calling
 * that coverage (ADR-0016 clause 3).
 */
export const PACKAGE_NAME = '@adrkit/catalog-envelope';

export {
  ENTITY_RECORD_FIELDS,
  ENVELOPE_SCHEMA_VERSION,
  ENVELOPE_TOP_LEVEL_FIELDS,
  FROZEN_CAPABILITIES,
  FROZEN_GLOB_DIALECT,
  RECOGNIZED_DIGEST_ALGORITHM,
  RECOGNIZED_OWNERSHIP_STATES,
  isRecognizedProvenance,
  type EnvelopeCompleteness,
  type EnvelopeGlobDialect,
  type EnvelopeGlobOptions,
  type EnvelopeRepository,
  type EnvelopeSource,
  type OwnershipState,
  type SerializedEntityIdentity,
  type SerializedSourceDocument,
  type SnapshotEntityRecord,
  type SnapshotEnvelope,
} from './envelope-shape.ts';

export {
  REASON_STEP,
  envelopeOf,
  isStructurallyValidEnvelope,
  validateEnvelope,
  validateParsedEnvelope,
  type EnvelopeExamination,
  type EnvelopeRejectionReason,
  type EnvelopeValidationRejected,
  type EnvelopeValidationResult,
  type EnvelopeValidationValid,
  type StructurallyValidEnvelope,
  type ValidateOptions,
  type ValidationStep,
} from './validate/index.ts';

export {
  DIGEST_GUARANTEE_SCOPE,
  canonicalFormOf,
  checkEnvelopeDigest,
  recomputeEnvelopeDigest,
  type DigestCheckResult,
} from './digest/index.ts';

export {
  STALENESS_COMPARISON,
  checkStaleness,
  type StalenessCheckResult,
} from './identity/staleness.ts';

export {
  checkRepositoryIdentity,
  queryEntitiesForRepository,
  type RepositoryIdentityCheckResult,
  type RepositoryIsolationQueryResult,
} from './identity/repository.ts';

export {
  EnvelopeDerivationRefusedError,
  admitEnvelope,
  admittedEnvelopeOf,
  deriveCatalogSnapshot,
  isAdmittedEnvelope,
  type AdmissionAdmitted,
  type AdmissionRefused,
  type AdmissionResult,
  type AdmissionStage,
  type AdmitOptions,
  type AdmittedEnvelope,
  type DerivedCatalogSnapshot,
} from './snapshot/index.ts';
