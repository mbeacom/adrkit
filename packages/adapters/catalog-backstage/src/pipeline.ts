/**
 * T069 — the assembled generator: Phase D's units composed in one fixed stage order.
 *
 * # Composition only
 *
 * Every verdict below is reached by a Phase D validator. This module decides **when**
 * each runs and **what happens next**; it decides nothing about what is valid. Where a
 * reading looked like it needed new logic it was resolved by reaching for the existing
 * pure function instead — see the note on double-reading source bytes in
 * {@link STAGE_DIGESTS} below, which is the one place that took an argument to keep.
 *
 * # The stage order, and why it is data
 *
 * `tasks.md` T069 fixes it: manifest → repository → digests → descriptor read →
 * admissibility → canonicalization → ownership → glob → envelope.
 *
 * {@link PIPELINE_STAGES} declares it, and every run records the stages it actually
 * entered, in order, on both the success and the failure branch. That makes the
 * ordering **observable** rather than asserted: a check compares the recorded trace
 * against the declared list, so a reordering that happened to produce the same verdicts
 * still fails. A comment saying "these run in order" would not have that property.
 *
 * Three of the orderings are load-bearing rather than tidy:
 *
 * - **Repository and digests before descriptor read.** The four manifest-request-level
 *   rejections "abort **before any entity's paths are derived**"
 *   (`atomic-fail-closed.md` §6). A pipeline that parsed descriptors first would still
 *   reject, but it would have derived ownership on the way — which R4's definition of
 *   generator output counts even when nothing is written.
 * - **Admissibility before canonicalization.** ADR-0015's ordering rule, and the reason
 *   `admissibility/index.ts` brands its output: an inadmissible descriptor must never
 *   acquire a canonical id, or it could be reported under `duplicate-canonical-id`
 *   instead of its own class, with the reported trigger depending on document order.
 * - **Ownership before glob.** `owned-paths-annotation.md` §1: "Only after steps 1–4
 *   succeed does each string element proceed to `glob-dialect.md`'s validator."
 *
 * # Whole-operation atomicity
 *
 * Every stage that can reject does so by returning, immediately, through
 * {@link aborted}. There is no `continue`, no accumulating error list, and no branch
 * anywhere that drops one entity and proceeds — the shape `atomic-fail-closed.md` §1
 * names as "the single most likely implementation mistake this contract exists to
 * foreclose". The envelope is assembled only after every stage has succeeded, and
 * writing is a **separate call** ({@link generateAndWriteEnvelope}), so an abort cannot
 * reach a filesystem write even by mistake.
 *
 * @see `specs/010-catalog-backstage/contracts/atomic-fail-closed.md` §1, §6
 * @see `specs/010-catalog-backstage/data-model.md` §9, §10
 */

import { compareCodeUnits } from '@adrkit/core';
import { collectAdmitted } from './admissibility/index.ts';
import { readDescriptorDocuments, readAnnotationNode } from './descriptor/read.ts';
import type { DescriptorDocument } from './descriptor/read.ts';
import type { Rejection } from './diagnostics.ts';
import {
  type AtomicFailureRecord,
  type FailureLocation,
  type GenerationOutcome,
} from './failure/abort.ts';
import { classifyAbort } from './failure/classify.ts';
import { readGlobDialect } from './glob/dialect.ts';
import { createGlobCompiler } from './glob/dialect.ts';
import { canonicalize } from './identity/canonicalize.ts';
import { checkGlobalUniqueness } from './identity/uniqueness.ts';
import { admissibleReadSet } from './manifest/boundary.ts';
import { verifySourceBytes, verifySourceDigests } from './manifest/digests.ts';
import { validatePathConfined, validatePathLexically } from './manifest/paths.ts';
import { parseManifestText } from './manifest/schema.ts';
import type { InputManifest, ManifestSource } from './manifest/schema.ts';
import { checkManifestVersions } from './manifest/version.ts';
import { deriveOwnership } from './ownership/derive.ts';
import { OWNED_PATHS_ANNOTATION } from './ownership/annotation.ts';
import {
  type ObservedRepositoryState,
  compareRepositoryIdentity,
  normalizeRepositoryId,
  readObservedRepositoryState,
} from './repository/identity.ts';
import { completeness } from './envelope/completeness.ts';
import { computeEnvelopeDigest } from './envelope/digest.ts';
import {
  type EnvelopeSource,
  type SnapshotEntityRecord,
  type SnapshotEnvelope,
  assembleEnvelope,
  entityRecord,
} from './envelope/shape.ts';
import {
  type ProvenanceDeclaration,
  checkProvenanceDeclaration,
  provenanceFor,
} from './envelope/provenance.ts';
import { type WriteResult, writeEnvelope } from './envelope/write.ts';

/** The manifest is read, parsed, shape-checked, version-checked; paths pass stage 1. */
export const STAGE_MANIFEST = 'manifest';
/** The checkout's own identity and revision are compared with the manifest's. */
export const STAGE_REPOSITORY = 'repository';
/** Source paths pass stage 2 (confinement) and every declared digest is verified. */
export const STAGE_DIGESTS = 'digests';
/** Each verified source is parsed into YAML documents. */
export const STAGE_DESCRIPTOR_READ = 'descriptor-read';
/** ADR-0015's four validators, all-or-nothing over the batch. */
export const STAGE_ADMISSIBILITY = 'admissibility';
/** Canonical identity, then global uniqueness over every ref. */
export const STAGE_CANONICALIZATION = 'canonicalization';
/** The annotation's decode steps 1–4. */
export const STAGE_OWNERSHIP = 'ownership';
/** The annotation's step 5 — per-pattern validation against the frozen dialect. */
export const STAGE_GLOB = 'glob';
/** The envelope is assembled and its digest computed. */
export const STAGE_ENVELOPE = 'envelope';

/** T069's fixed stage order. */
export const PIPELINE_STAGES = [
  STAGE_MANIFEST,
  STAGE_REPOSITORY,
  STAGE_DIGESTS,
  STAGE_DESCRIPTOR_READ,
  STAGE_ADMISSIBILITY,
  STAGE_CANONICALIZATION,
  STAGE_OWNERSHIP,
  STAGE_GLOB,
  STAGE_ENVELOPE,
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** One generation request. */
export interface GenerationRequest {
  /** Path to the input manifest. The only path this run is given. */
  readonly manifestPath: string;
  /** The checkout the manifest's source paths are resolved against and confined to. */
  readonly checkoutRoot: string;
  /**
   * One {@link ProvenanceDeclaration} entry per manifest source path.
   *
   * Required and exhaustive. `envelope/provenance.ts` explains why there is no default:
   * an omission would otherwise emit a claim about a third party that nobody made.
   */
  readonly provenance: ProvenanceDeclaration;
  /**
   * The checkout's observed identity, when the caller has already read it.
   *
   * Omitted in ordinary use, in which case this pipeline reads it with the two git
   * subprocess calls `input-manifest.md` §5 permits. It is a **value**, never a
   * function: an injectable reader would be a seam through which a test could supply
   * behaviour, whereas a value can only supply data.
   */
  readonly observedRepositoryState?: ObservedRepositoryState | undefined;
  /**
   * `completeness.identityOnly`. Defaults to `false`.
   *
   * `completeness.wholeCatalog` is deliberately **not** here — it is `false`
   * unconditionally and has no input that can change it (FR-014).
   */
  readonly identityOnly?: boolean | undefined;
}

/** What a successful run produced, before anything is written. */
export type GenerationResult = GenerationOutcome<SnapshotEnvelope>;

interface Trace {
  readonly stages: string[];
}

/**
 * Record that `stage` was entered.
 *
 * Each stage appears **once**, at its first entry, in first-entry order. The
 * per-entity stages (`ownership` and `glob`) are entered once per entity, and
 * recording every visit would make the trace's length a function of how many entities
 * a run happened to contain — which says nothing about ordering, the property the
 * trace exists to make observable. Every stage listed was genuinely entered, and the
 * order listed is the order they were first entered in.
 *
 * `failure.stage` on an {@link AtomicFailureRecord} is what says where a run stopped;
 * it is a separate field precisely so this one does not have to serve both jobs.
 */
function enter(trace: Trace, stage: PipelineStage): void {
  if (!trace.stages.includes(stage)) trace.stages.push(stage);
}

function aborted(
  trace: Trace,
  rejection: Rejection,
  stage: PipelineStage,
  location: FailureLocation = {},
): GenerationResult {
  return { ok: false, failure: classifyAbort(rejection, stage, location), stages: [...trace.stages] };
}

/**
 * This package's own version, read from its installed manifest.
 *
 * Read rather than transcribed, for the same reason `glob/dialect.ts` reads
 * `picomatch`'s: a version literal in source can drift from the package it claims to
 * describe, and an envelope recording a version nothing verified is a claim rather than
 * an observation.
 *
 * `package-boundary.md` §6 settles that a filesystem read of a `package.json` is not
 * loader behaviour — "it invokes no resolver, imports no module, and cannot load code".
 * That section is written about a *dependency's* manifest; this reads the package's
 * own, which engages the same distinction and none of the resolution the guard forbids.
 *
 * `input-manifest.md` §5's read boundary is about what a run may read **from the
 * repository under generation** — the manifest, its listed sources, and two git values.
 * The generator's own installed manifest is part of the tool, not part of the input,
 * exactly as `node_modules/picomatch/package.json` is. Stated rather than assumed,
 * because the two readings are close enough to be worth separating in writing.
 */
async function readGeneratorVersion(): Promise<string> {
  const manifestPath = `${import.meta.dir}/../package.json`;
  const manifest = (await Bun.file(manifestPath).json()) as {
    name?: unknown;
    version?: unknown;
  };
  const { name, version } = manifest;
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new Error(
      `could not read name and version from ${manifestPath}. Refusing to record a ` +
        'generatorVersion this package has not verified.',
    );
  }
  return `${name}@${version}`;
}

interface VerifiedSourceText {
  readonly source: ManifestSource;
  readonly resolvedPath: string;
  readonly text: string;
}

/**
 * Run the generator. Returns the envelope, or exactly one
 * {@link AtomicFailureRecord} — never both, and never a partial envelope.
 */
export async function runGeneration(request: GenerationRequest): Promise<GenerationResult> {
  const trace: Trace = { stages: [] };

  // ── Stage 1: manifest ──────────────────────────────────────────────────────────
  enter(trace, STAGE_MANIFEST);

  const manifestFile = Bun.file(request.manifestPath);
  if (!(await manifestFile.exists())) {
    return aborted(
      trace,
      {
        reason: 'manifest-unreadable',
        triggerClass: 'invalid-manifest-shape',
        detail: `no manifest at ${JSON.stringify(request.manifestPath)}`,
      },
      STAGE_MANIFEST,
    );
  }

  const shape = parseManifestText(await manifestFile.text());
  if (!shape.ok) return aborted(trace, shape.rejection, STAGE_MANIFEST);

  const manifest: InputManifest = shape.value;

  const versions = checkManifestVersions(manifest);
  if (!versions.ok) return aborted(trace, versions.rejection, STAGE_MANIFEST);

  // Path validation stage 1 — lexical, before any filesystem access
  // (`input-manifest.md` §4.1). Stage 2 is deferred to STAGE_DIGESTS because it
  // touches the filesystem and carries a different trigger class.
  for (const source of manifest.sources) {
    const lexical = validatePathLexically(source.path);
    if (!lexical.ok) {
      return aborted(trace, lexical.rejection, STAGE_MANIFEST, { sourcePath: source.path });
    }
  }

  const readSet = admissibleReadSet(request.manifestPath, manifest);

  const provenance = checkProvenanceDeclaration(request.provenance, readSet.sourcePaths);
  if (!provenance.ok) return aborted(trace, provenance.rejection, STAGE_MANIFEST);

  // ── Stage 2: repository ────────────────────────────────────────────────────────
  enter(trace, STAGE_REPOSITORY);

  const observed =
    request.observedRepositoryState ?? (await readObservedRepositoryState(request.checkoutRoot));
  const identity = compareRepositoryIdentity(manifest.repository, observed);
  if (!identity.ok) return aborted(trace, identity.rejection, STAGE_REPOSITORY);

  // ── Stage 3: digests ───────────────────────────────────────────────────────────
  enter(trace, STAGE_DIGESTS);

  const resolvedByDeclaredPath = new Map<string, string>();
  for (const source of manifest.sources) {
    const confined = await validatePathConfined(request.checkoutRoot, source.path);
    if (!confined.ok) {
      return aborted(trace, confined.rejection, STAGE_DIGESTS, { sourcePath: source.path });
    }
    resolvedByDeclaredPath.set(source.path, confined.value.resolved);
  }

  const digests = await verifySourceDigests(manifest.sources, (path) => {
    const resolved = resolvedByDeclaredPath.get(path);
    if (resolved === undefined) {
      throw new Error(`source ${JSON.stringify(path)} was not confined before digest verification`);
    }
    return resolved;
  });
  if (!digests.ok) return aborted(trace, digests.rejection, STAGE_DIGESTS);

  // The bytes verified above were read by `verifySourceDigests`. These are the bytes
  // that will actually be parsed, so they are re-verified through the same pure
  // Phase D function: two reads, one authority. A file changed between the two reads
  // reports `digest-mismatch` from `manifest/digests.ts`, never from a second
  // comparison written here. `input-manifest.md` §4 requires sources be
  // "digest-verified before trust", and the bytes that are trusted are these.
  const verified: VerifiedSourceText[] = [];
  for (const source of manifest.sources) {
    const resolvedPath = resolvedByDeclaredPath.get(source.path) as string;
    const bytes = new Uint8Array(await Bun.file(resolvedPath).arrayBuffer());

    const reverified = verifySourceBytes(source, bytes);
    if (!reverified.ok) {
      return aborted(trace, reverified.rejection, STAGE_DIGESTS, { sourcePath: source.path });
    }

    verified.push({ source, resolvedPath, text: new TextDecoder().decode(bytes) });
  }

  // ── Stage 4: descriptor read ───────────────────────────────────────────────────
  enter(trace, STAGE_DESCRIPTOR_READ);

  const documents: DescriptorDocument[] = [];
  for (const { source, text } of verified) {
    for (const document of readDescriptorDocuments(source.path, text)) {
      if (document.rejection !== undefined) {
        return aborted(trace, document.rejection, STAGE_DESCRIPTOR_READ, {
          sourcePath: document.sourcePath,
          documentIndex: document.documentIndexInFile,
        });
      }
      documents.push(document);
    }
  }

  // ── Stage 5: admissibility ─────────────────────────────────────────────────────
  enter(trace, STAGE_ADMISSIBILITY);

  const admission = collectAdmitted(documents);
  if (!admission.ok) {
    const [first] = admission.result.attributions;
    return aborted(trace, admission.rejection, STAGE_ADMISSIBILITY, {
      sourcePath: first?.sourcePath,
      documentIndex: first?.documentIndexInFile,
    });
  }

  // ── Stage 6: canonicalization ──────────────────────────────────────────────────
  enter(trace, STAGE_CANONICALIZATION);

  const identities = admission.admitted.map((admitted) => canonicalize(admitted));

  const uniqueness = checkGlobalUniqueness(identities);
  if (!uniqueness.ok) {
    const { second } = uniqueness.collision;
    const document = documents[second.entityIndex];
    return aborted(trace, uniqueness.rejection, STAGE_CANONICALIZATION, {
      sourcePath: document?.sourcePath,
      documentIndex: document?.documentIndexInFile,
    });
  }

  // ── Stages 7 and 8: ownership, then glob ───────────────────────────────────────
  // One compiler for the whole run (FR-032: once per run, never once per entity), so
  // the matcher that validated a pattern is the matcher that would later match it.
  const compiler = createGlobCompiler();
  const entities: SnapshotEntityRecord[] = [];

  for (const [index, admitted] of admission.admitted.entries()) {
    const document = admitted.document;
    const identity = identities[index];
    if (identity === undefined) {
      throw new Error('canonicalization produced fewer identities than admitted descriptors');
    }

    enter(trace, STAGE_OWNERSHIP);

    const annotation = readAnnotationNode(document, OWNED_PATHS_ANNOTATION);
    const derived = deriveOwnership(annotation.present, annotation.value, compiler);

    // Step 5 is the glob stage. It is reached only when steps 1–4 produced patterns to
    // validate, which is exactly `explicit-paths`. The trace records it from what the
    // derivation actually returned rather than from an assumption about which branch
    // ran: a step-5 rejection carries the offending pattern, and a success that
    // reached step 5 carries every pattern's verdict.
    const reachedGlob = derived.ok
      ? derived.value.ownershipState === 'explicit-paths'
      : derived.pattern !== undefined;
    if (reachedGlob) enter(trace, STAGE_GLOB);

    if (!derived.ok) {
      return aborted(trace, derived.rejection, reachedGlob ? STAGE_GLOB : STAGE_OWNERSHIP, {
        sourcePath: document.sourcePath,
        documentIndex: document.documentIndexInFile,
      });
    }

    entities.push(
      entityRecord({
        canonicalId: identity.canonicalId,
        allRefs: identity.allRefs,
        ownershipState: derived.value.ownershipState,
        derivedPaths: derived.value.derivedPaths,
        sourcePath: document.sourcePath,
        documentIndexInFile: document.documentIndexInFile,
        provenance: provenanceFor(provenance.declaration, document.sourcePath),
      }),
    );
  }

  // ── Stage 9: envelope ──────────────────────────────────────────────────────────
  enter(trace, STAGE_ENVELOPE);

  const sources: readonly EnvelopeSource[] = [...manifest.sources]
    .map((source) => ({
      path: source.path,
      digestAlgorithm: source.digestAlgorithm,
      digest: source.digest,
    }))
    .sort((a, b) => compareCodeUnits(a.path, b.path));

  const unsigned = {
    schemaVersion: '1',
    repository: {
      // The normalized form, so the envelope records the identity that was actually
      // compared rather than whichever spelling the manifest happened to use.
      id: normalizeRepositoryId(manifest.repository.id),
      // The observed head, not the declared revision. They are equal — the identity
      // check rejects otherwise — and recording the observation keeps the envelope a
      // report of what was seen rather than a copy of what was asked for.
      revision: observed.head,
    },
    generatorVersion: await readGeneratorVersion(),
    globDialect: await readGlobDialect(),
    capabilities: ['pathOwnership'],
    completeness: completeness(request.identityOnly ?? false),
    sources,
    entities,
  } satisfies Omit<SnapshotEnvelope, 'digest'>;

  const envelope = assembleEnvelope({
    repository: unsigned.repository,
    generatorVersion: unsigned.generatorVersion,
    globDialect: unsigned.globDialect,
    completeness: unsigned.completeness,
    sources: unsigned.sources,
    entities: unsigned.entities,
    digest: computeEnvelopeDigest(unsigned),
  });

  return { ok: true, envelope, stages: [...trace.stages] };
}

/**
 * Run the generator and, **only** on success, write the envelope.
 *
 * The write is unreachable from the failure branch: `outcome.ok` is checked before
 * `writeEnvelope` is named, and the failure arm of {@link GenerationResult} carries no
 * envelope to write. That is `atomic-fail-closed.md` §1's "no usable partial snapshot"
 * expressed as control flow rather than as a promise.
 */
export async function generateAndWriteEnvelope(
  request: GenerationRequest,
  destination: string,
): Promise<
  | { readonly ok: true; readonly envelope: SnapshotEnvelope; readonly write: WriteResult }
  | { readonly ok: false; readonly failure: AtomicFailureRecord }
> {
  const outcome = await runGeneration(request);
  if (!outcome.ok) return { ok: false, failure: outcome.failure };
  return { ok: true, envelope: outcome.envelope, write: await writeEnvelope(outcome.envelope, destination) };
}
