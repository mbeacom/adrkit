/**
 * T087 / T088 / T092 — ADR-0020 clause 5 **step (b)**: the post-output comparison.
 *
 * # What step (b) is for, and why it is a separate step
 *
 * Step (a) — the pre-output freeze and its independent audit — is Barrier B, and it is
 * done. It fixed, in advance, what ownership derivation over the accept corpus is
 * *expected* to produce. It did not show that anything produces it.
 *
 * ADR-0020 clause 5 is explicit about why that is not enough:
 *
 * > Freezing the expected paths is not enough; the output must be compared against
 * > them. A populated, digest-verified envelope proves integrity, not correctness — a
 * > semantically wrong envelope can carry a perfectly valid self-digest.
 *
 * So this harness runs the assembled generator over the frozen accept corpus and diffs
 * the ownership it derived against the frozen expectations, requiring **zero false
 * positives and zero false negatives** (FR-056, SC-011).
 *
 * # The one rule that governs everything here
 *
 * **The expectations are never amended to fit the output.** If the two disagree, either
 * the output is wrong or the expectation is wrong, and the answer is to report it. A
 * comparison that passes because the expectations moved is not a passing comparison —
 * `scripts/check-freeze-hashes.ts` fails the build on any drift in the frozen trees, and
 * `check-freeze-hashes.test.ts` re-asserts the Phase B hashes across the whole of E and F
 * (T091). A mismatch is a finding, not an obstacle.
 *
 * # R5 mechanism 3 — this file was authored *after* the freeze and its audit
 *
 * `plan.md`'s third enforcement mechanism is an ordering requirement: the harness that
 * reads both generator output *and* the frozen expectations is written after the freeze,
 * never before, because a harness authored first collapses clause 5's two distinct steps
 * into one and step (b)'s PASS then inherits from step (a) instead of standing alone.
 *
 * T024's checkpoint (`evidence/barrier-b-checkpoint.json`, `mechanism3_ordering`) records
 * that no comparison harness existed anywhere in the repository at that point. The
 * provenance record at `evidence/comparison/harness-provenance.md` carries the rest.
 *
 * # What the corpus is, and where the overlay lives
 *
 * `specs/010-catalog-backstage/corpus/` holds the 24 selected descriptors as **pristine
 * upstream bytes**, vendored by `scripts/vendor-accept-corpus.ts` (T086a) and verified
 * against the content address the pinned commit fixes. The maintainer-authored
 * `adrkit.io/owned-paths` overlay is **not** in those files. It stays in
 * `evidence/accept-corpus-freeze/overlay.json` and is applied here, at generation time,
 * into a temporary run directory that is deleted afterwards.
 *
 * The vendored tree is never written to. That is what keeps ADR-0020 clause 5's
 * "authored upstream and otherwise unmodified" provable by digest, and what keeps
 * `data-model.md` §10's upstream/maintainer boundary legible by inspection rather than by
 * assertion.
 *
 * # Integrity is not correctness (FR-058, SC-012), and this harness does not blur it
 *
 * The envelope this harness generates carries a self-digest. That digest establishes
 * **integrity** — the bytes were not accidentally corrupted or naively mutated. It
 * establishes nothing about whether the derived ownership is semantically right.
 *
 * What this comparison establishes is narrower than "the adapter is correct": it
 * establishes **agreement with a maintainer-authored expectation set** over one frozen
 * corpus. The expectations were written by hand from frozen contracts, by the maintainer.
 * Agreement between our generator and our expectations is evidence that the
 * implementation matches the specification we wrote; it is not independent evidence that
 * either is right, and it says nothing about Backstage as a running system.
 *
 * `evidence/comparison/reporting-honesty.md` states this at length, and
 * `scripts/compare-accept-corpus.test.ts` asserts that no Phase F artifact says otherwise.
 *
 * @see `docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md` clause 5
 * @see `specs/010-catalog-backstage/spec.md` FR-056, FR-057, FR-058, SC-011, SC-012
 * @see `specs/010-catalog-backstage/plan.md` — Barrier B, R5 mechanism 3
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// `compareCodeUnits` is imported by path rather than through `@adrkit/core`'s package
// name. Bun's isolated linker installs workspace dependencies under the *depending*
// package, so `@adrkit/core` is not resolvable from `scripts/`; and this is the exact
// module the freeze cites as the definition of its ordering
// (`accept-corpus-freeze/expected-paths.json`: "compareCodeUnits — whose entire
// definition is `a < b ? -1 : a > b ? 1 : 0` … packages/core/src/ordering/index.ts").
// One comparator, named at its source, rather than a second one written here.
import { compareCodeUnits } from '../packages/core/src/ordering/index.ts';
import { canonicalHash } from './audit-oracle-freeze.ts';
import { sha256Hex } from '../packages/adapters/catalog-backstage/src/manifest/digests.ts';
import { readDescriptorDocuments } from '../packages/adapters/catalog-backstage/src/descriptor/read.ts';
import { allMaintainerOverlay } from '../packages/adapters/catalog-backstage/src/envelope/provenance.ts';
import type { SnapshotEnvelope } from '../packages/adapters/catalog-backstage/src/envelope/shape.ts';
import { runGeneration } from '../packages/adapters/catalog-backstage/src/pipeline.ts';

/** The annotation key the overlay writes. `owned-paths-annotation.md` §1. */
export const OWNED_PATHS_ANNOTATION = 'adrkit.io/owned-paths';

/** Repository-relative paths this harness reads. None of them is ever written. */
export const CORPUS_DIR = 'specs/010-catalog-backstage/corpus';
export const EVIDENCE_DIR = 'specs/010-catalog-backstage/evidence';
export const FREEZE_PATH = `${EVIDENCE_DIR}/accept-corpus-freeze/accept-corpus-freeze.json`;
export const OVERLAY_PATH = `${EVIDENCE_DIR}/accept-corpus-freeze/overlay.json`;
export const ORACLE_PATH = `${EVIDENCE_DIR}/frozen-expectations/frozen-expectation-set.json`;

/** Where the diff report is written. */
export const DIFF_REPORT_PATH = `${EVIDENCE_DIR}/comparison/diff-report.json`;

/** Where step (b)'s own record and the prohibition guard's record are written. */
export const STEP_B_RECORD_PATH = `${EVIDENCE_DIR}/comparison/step-b-record.json`;
export const EXPECTATIONS_UNCHANGED_PATH = `${EVIDENCE_DIR}/comparison/expectations-unchanged.json`;

/** The Barrier B checkpoint, which is where Phase B's hash values were independently recorded. */
export const CHECKPOINT_PATH = `${EVIDENCE_DIR}/barrier-b-checkpoint.json`;

/** The two frozen artifacts, relative to the evidence directory. */
export const FROZEN_ARTIFACTS = [
  'frozen-expectations/frozen-expectation-set.json',
  'accept-corpus-freeze/accept-corpus-freeze.json',
] as const;

// ── Finding kinds ─────────────────────────────────────────────────────────────────────

/**
 * The three ways output and expectation can disagree.
 *
 * FR-056 fixes two of them by name and then says "**any** mismatch fails the gate", so
 * the third is carried explicitly rather than folded into one of the first two. Folding a
 * wrong `ownershipState` into "false positive" would report a path defect that did not
 * happen; dropping it would let a real mismatch through.
 */
export type FindingKind = 'false-positive' | 'false-negative' | 'other-mismatch';

export interface Finding {
  readonly kind: FindingKind;
  /** A stable, greppable reason. Asserted verbatim by the tests and the negative case. */
  readonly reason: string;
  readonly canonicalId: string;
  readonly detail: string;
}

/** Reasons, as constants, so a test and an evidence file cannot drift from the code. */
export const REASON_ENTITY_MISSING = 'expected entity absent from generator output';
export const REASON_PATH_NOT_DERIVED = 'expected path was not derived';
export const REASON_PATH_NOT_EXPECTED = 'derived path is not in the frozen expectation';
export const REASON_UNEXPECTED_OWNERSHIP =
  'entity outside the frozen expectation set derived a non-empty path set';
export const REASON_OWNERSHIP_STATE = 'ownershipState does not match the frozen expectation';
export const REASON_PATH_ORDER =
  'derivedPaths carry the expected members in a different order than the frozen expectation';
export const REASON_SOURCE_DOCUMENT =
  'sourceDocument does not match the (sourcePath, documentIndexInFile) the freeze records';
export const REASON_PATTERN_UNION =
  'the union of derived patterns does not match the oracle derivedPathPatterns';
export const REASON_FREEZE_DISAGREEMENT =
  'accept-corpus-freeze and frozen-expectation-set disagree, which is a freeze failure rather than a comparison finding';

// ── The frozen side ───────────────────────────────────────────────────────────────────

/** One frozen expectation, assembled from both frozen artifacts. */
export interface ExpectedEntity {
  readonly canonicalId: string;
  readonly ownershipState: string;
  readonly expectedPaths: readonly string[];
  readonly sourcePath: string;
  readonly documentIndexInFile: number;
}

/** One entity as the generator actually emitted it. */
export interface ObservedEntity {
  readonly canonicalId: string;
  readonly ownershipState: string;
  readonly derivedPaths: readonly string[];
  readonly sourcePath: string;
  readonly documentIndexInFile: number;
}

export interface FrozenSide {
  readonly repository: string;
  readonly commit: string;
  readonly entities: readonly ExpectedEntity[];
  /** The oracle's 25-element deduplicated pattern union, in `compareCodeUnits` order. */
  readonly derivedPathPatterns: readonly string[];
  readonly freezeContentHash: string;
  readonly oracleContentHash: string;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
    throw new Error(`${what} is not an array of strings`);
  }
  return value as readonly string[];
}

/**
 * Assemble the frozen side from **both** frozen artifacts, and cross-check them.
 *
 * `accept-corpus-freeze.json` records `(canonicalId, ownershipState, sourcePath,
 * documentIndexInFile, expectedPaths)`; `frozen-expectation-set.json` records
 * `(canonicalId, ownershipState, expectedPaths)` plus the pattern union. The freeze
 * itself says the two "are two views of one freeze, and a divergence between them is a
 * freeze failure, not a discrepancy to be reconciled" — so this reads both and refuses to
 * proceed if they disagree, rather than silently preferring one.
 */
export function readFrozenSide(freezeJson: unknown, oracleJson: unknown): FrozenSide {
  const freeze = asRecord(freezeJson, 'accept-corpus-freeze.json');
  const oracle = asRecord(oracleJson, 'frozen-expectation-set.json');

  const corpusRef = asRecord(freeze['corpusRef'], 'corpusRef');
  const repository = corpusRef['repository'];
  const commit = corpusRef['commit'];
  if (typeof repository !== 'string' || typeof commit !== 'string') {
    throw new Error('corpusRef.repository / corpusRef.commit are missing or not strings');
  }

  const freezeEntries = freeze['expectedPaths'];
  if (!Array.isArray(freezeEntries)) throw new Error('freeze expectedPaths is not an array');
  const oracleEntries = oracle['expectedByEntity'];
  if (!Array.isArray(oracleEntries)) throw new Error('oracle expectedByEntity is not an array');

  if (freezeEntries.length !== oracleEntries.length) {
    throw new Error(
      `${REASON_FREEZE_DISAGREEMENT}: freeze carries ${freezeEntries.length} entries, oracle carries ${oracleEntries.length}`,
    );
  }

  const entities: ExpectedEntity[] = [];
  for (const [index, raw] of freezeEntries.entries()) {
    const entry = asRecord(raw, `freeze expectedPaths[${index}]`);
    const mirror = asRecord(oracleEntries[index], `oracle expectedByEntity[${index}]`);

    const canonicalId = entry['canonicalId'];
    const ownershipState = entry['ownershipState'];
    const sourcePath = entry['sourcePath'];
    const documentIndexInFile = entry['documentIndexInFile'];
    if (
      typeof canonicalId !== 'string' ||
      typeof ownershipState !== 'string' ||
      typeof sourcePath !== 'string' ||
      typeof documentIndexInFile !== 'number'
    ) {
      throw new Error(`freeze expectedPaths[${index}] is malformed`);
    }
    const expectedPaths = asStringArray(entry['expectedPaths'], `freeze expectedPaths[${index}]`);

    // The cross-check. Field-by-field, in the order the two artifacts share.
    if (mirror['canonicalId'] !== canonicalId) {
      throw new Error(
        `${REASON_FREEZE_DISAGREEMENT}: entry ${index} is ${String(canonicalId)} in the freeze and ${String(mirror['canonicalId'])} in the oracle`,
      );
    }
    if (mirror['ownershipState'] !== ownershipState) {
      throw new Error(
        `${REASON_FREEZE_DISAGREEMENT}: ${canonicalId} ownershipState is ${ownershipState} in the freeze and ${String(mirror['ownershipState'])} in the oracle`,
      );
    }
    const mirrorPaths = asStringArray(mirror['expectedPaths'], `oracle expectedByEntity[${index}]`);
    if (mirrorPaths.length !== expectedPaths.length || mirrorPaths.some((p, i) => p !== expectedPaths[i])) {
      throw new Error(
        `${REASON_FREEZE_DISAGREEMENT}: ${canonicalId} expectedPaths differ between the two frozen artifacts`,
      );
    }

    entities.push({ canonicalId, ownershipState, expectedPaths, sourcePath, documentIndexInFile });
  }

  const freezeContentHash = freeze['contentHash'];
  const oracleContentHash = oracle['contentHash'];
  if (typeof freezeContentHash !== 'string' || typeof oracleContentHash !== 'string') {
    throw new Error('a frozen artifact carries no contentHash');
  }

  return {
    repository,
    commit,
    entities,
    derivedPathPatterns: asStringArray(oracle['derivedPathPatterns'], 'oracle derivedPathPatterns'),
    freezeContentHash,
    oracleContentHash,
  };
}

/** One `(sourcePath, documentIndexInFile) -> annotationValue` overlay entry. */
export interface OverlayEntry {
  readonly sourcePath: string;
  readonly documentIndexInFile: number;
  readonly annotationValue: string;
}

export function readOverlay(overlayJson: unknown): readonly OverlayEntry[] {
  const overlay = asRecord(overlayJson, 'overlay.json');
  const entries = overlay['overlay'];
  if (!Array.isArray(entries)) throw new Error('overlay.overlay is not an array');
  return entries.map((raw, index) => {
    const entry = asRecord(raw, `overlay[${index}]`);
    const sourcePath = entry['sourcePath'];
    const documentIndexInFile = entry['documentIndexInFile'];
    const annotationValue = entry['annotationValue'];
    if (
      typeof sourcePath !== 'string' ||
      typeof documentIndexInFile !== 'number' ||
      typeof annotationValue !== 'string'
    ) {
      throw new Error(`overlay[${index}] is malformed`);
    }
    return { sourcePath, documentIndexInFile, annotationValue };
  });
}

// ── Overlay application (in memory, never onto the vendored tree) ─────────────────────

/** Raised when a descriptor's shape defeats textual overlay application. */
export class OverlayAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverlayAbort';
  }
}

/**
 * Line ranges of each YAML document in `text`, in document order.
 *
 * A `---` at column 0 starts a document; a leading one does not create an empty document
 * before it. This is deliberately simple, and it is not trusted: {@link applyOverlay}
 * re-parses its own output with the generator's own reader and refuses to return text
 * whose decoded documents differ from the pristine ones by anything other than the single
 * injected annotation. A mis-split therefore fails loudly rather than producing a
 * plausible-looking corpus.
 */
export function documentLineRanges(lines: readonly string[]): readonly { start: number; end: number }[] {
  const boundaries: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (/^---(\s|$)/.test(line)) boundaries.push(index);
  }

  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    if (boundary === 0) {
      start = 1;
      continue;
    }
    ranges.push({ start, end: boundary });
    start = boundary + 1;
  }
  ranges.push({ start, end: lines.length });
  return ranges;
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Inject one `adrkit.io/owned-paths` annotation into one document of `text`.
 *
 * Textual rather than a YAML round-trip, and for a reason: re-emitting the document would
 * rewrite formatting, comments and scalar styles throughout, and clause 5's whole purpose
 * is to exercise derivation against **real descriptor structure and real field shapes**. A
 * re-serialized descriptor is no longer the shape upstream published. So every byte
 * outside the inserted lines is carried through untouched.
 *
 * The value is emitted as a **single-quoted scalar**. `owned-paths-annotation.md` §1 step
 * 2 requires a YAML *string* scalar, and an unquoted `["a/**"]` would parse as a flow
 * sequence and be rejected at step 2 — a different case from the one the overlay means.
 */
export function applyOverlay(
  sourcePath: string,
  text: string,
  documentIndexInFile: number,
  annotationValue: string,
): string {
  const lines = text.split('\n');
  const ranges = documentLineRanges(lines);
  const range = ranges[documentIndexInFile];
  if (range === undefined) {
    throw new OverlayAbort(
      `${sourcePath}: overlay targets document ${documentIndexInFile}, but the file holds ${ranges.length}`,
    );
  }

  let metadataLine = -1;
  for (let index = range.start; index < range.end; index += 1) {
    if (/^metadata:\s*$/.test(lines[index] as string)) {
      metadataLine = index;
      break;
    }
  }
  if (metadataLine === -1) {
    throw new OverlayAbort(
      `${sourcePath}[${documentIndexInFile}]: no top-level \`metadata:\` mapping key to overlay onto`,
    );
  }

  // The indent metadata's own children use, read from the document rather than assumed.
  let childIndent = -1;
  for (let index = metadataLine + 1; index < range.end; index += 1) {
    const line = lines[index] as string;
    if (line.trim() === '') continue;
    const indent = leadingSpaces(line);
    if (indent === 0) break;
    childIndent = indent;
    break;
  }
  if (childIndent <= 0) {
    throw new OverlayAbort(
      `${sourcePath}[${documentIndexInFile}]: \`metadata:\` has no indented children, so its child indent cannot be read`,
    );
  }

  const quoted = `'${annotationValue.replaceAll("'", "''")}'`;

  // An existing `annotations:` mapping at metadata's child indent, if there is one.
  // Commented-out lines (`# annotations:`) do not match, which is the point: two corpus
  // descriptors carry exactly that as a documentation example.
  const annotationsPattern = new RegExp(`^ {${childIndent}}annotations:\\s*$`);
  let annotationsLine = -1;
  for (let index = metadataLine + 1; index < range.end; index += 1) {
    const line = lines[index] as string;
    if (line.trim() === '') continue;
    if (leadingSpaces(line) === 0) break;
    if (leadingSpaces(line) === childIndent && annotationsPattern.test(line)) {
      annotationsLine = index;
      break;
    }
  }

  const inserted =
    annotationsLine === -1
      ? {
          at: metadataLine + 1,
          lines: [
            `${' '.repeat(childIndent)}annotations:`,
            `${' '.repeat(childIndent * 2)}${OWNED_PATHS_ANNOTATION}: ${quoted}`,
          ],
        }
      : {
          at: annotationsLine + 1,
          lines: [`${' '.repeat(childIndent * 2)}${OWNED_PATHS_ANNOTATION}: ${quoted}`],
        };

  const overlaid = [
    ...lines.slice(0, inserted.at),
    ...inserted.lines,
    ...lines.slice(inserted.at),
  ].join('\n');

  assertOverlayIsAdditiveOnly(sourcePath, text, overlaid, documentIndexInFile, annotationValue);
  return overlaid;
}

/**
 * Confirm the overlay added exactly one annotation and changed nothing else.
 *
 * Checked with the **generator's own** descriptor reader rather than a second parser, so
 * the thing that validates the overlay is the thing that will consume it. A second
 * notion of "same document" could disagree with the one that matters.
 */
function assertOverlayIsAdditiveOnly(
  sourcePath: string,
  pristine: string,
  overlaid: string,
  documentIndexInFile: number,
  annotationValue: string,
): void {
  const before = readDescriptorDocuments(sourcePath, pristine);
  const after = readDescriptorDocuments(sourcePath, overlaid);

  if (after.length !== before.length) {
    throw new OverlayAbort(
      `${sourcePath}: overlay changed the document count from ${before.length} to ${after.length}`,
    );
  }
  for (const [index, document] of after.entries()) {
    if (document.rejection !== undefined) {
      throw new OverlayAbort(
        `${sourcePath}[${index}]: the overlaid text no longer reads cleanly — ${document.rejection.detail}`,
      );
    }
    const pristineRaw = structuredClone((before[index]?.raw ?? null) as unknown) as Record<
      string,
      unknown
    > | null;
    const overlaidRaw = structuredClone(document.raw as unknown) as Record<string, unknown> | null;

    if (index === documentIndexInFile) {
      const metadata = (overlaidRaw?.['metadata'] ?? {}) as Record<string, unknown>;
      const annotations = (metadata['annotations'] ?? {}) as Record<string, unknown>;
      if (annotations[OWNED_PATHS_ANNOTATION] !== annotationValue) {
        throw new OverlayAbort(
          `${sourcePath}[${index}]: the injected annotation did not decode back to the overlay value`,
        );
      }
      // Remove exactly the injected key (and the annotations map, when the overlay
      // created it) and require the remainder to be identical to the pristine document.
      delete annotations[OWNED_PATHS_ANNOTATION];
      const pristineMetadata = (pristineRaw?.['metadata'] ?? {}) as Record<string, unknown>;
      if (!Object.hasOwn(pristineMetadata, 'annotations') && Object.keys(annotations).length === 0) {
        delete metadata['annotations'];
      }
    }

    if (JSON.stringify(overlaidRaw) !== JSON.stringify(pristineRaw)) {
      throw new OverlayAbort(
        `${sourcePath}[${index}]: the overlay changed the document beyond adding one annotation`,
      );
    }
  }
}

// ── The comparison kernel — pure, and the part that renders the verdict ───────────────

export interface ComparisonOutcome {
  readonly pass: boolean;
  readonly falsePositives: readonly Finding[];
  readonly falseNegatives: readonly Finding[];
  readonly otherMismatches: readonly Finding[];
  /** Entities the generator emitted that the expectation set does not cover. */
  readonly entitiesOutsideTheExpectationSet: readonly ObservedEntity[];
}

/**
 * Diff derived ownership against the frozen expectations.
 *
 * Pure: it takes the two sides as data and returns the verdict. Nothing here reads a
 * file, so the FAIL path is reachable in a test without mutating anything on disk — which
 * is what makes ADR-0016's "observed failing" requirement satisfiable for this gate.
 *
 * **Entities outside the expectation set are not automatically findings.** The 24 selected
 * documents do not exhaust their files: one selected file holds a second, unselected
 * document, which the generator reads because a manifest names the *file*. Such an entity
 * carries no overlay, so it must derive nothing. It is a false positive **only** if it
 * derives a non-empty path set — an ownership claim no frozen expectation licenses. This
 * distinction is the descriptor-file-count / entity-document-count trap, and collapsing it
 * either way would be wrong: failing on the sibling's mere existence would report a defect
 * that did not happen, and ignoring it entirely would let an unlicensed claim through.
 */
export function compare(
  expected: readonly ExpectedEntity[],
  observed: readonly ObservedEntity[],
  derivedPathPatterns: readonly string[],
): ComparisonOutcome {
  const falsePositives: Finding[] = [];
  const falseNegatives: Finding[] = [];
  const otherMismatches: Finding[] = [];

  const observedById = new Map(observed.map((entity) => [entity.canonicalId, entity] as const));
  const expectedIds = new Set(expected.map((entity) => entity.canonicalId));

  for (const entity of expected) {
    const actual = observedById.get(entity.canonicalId);
    if (actual === undefined) {
      falseNegatives.push({
        kind: 'false-negative',
        reason: REASON_ENTITY_MISSING,
        canonicalId: entity.canonicalId,
        detail: `expected ${entity.expectedPaths.length} derived path(s) from ${entity.sourcePath}[${entity.documentIndexInFile}]; the generator emitted no entity with this canonical id`,
      });
      continue;
    }

    const derived = new Set(actual.derivedPaths);
    for (const path of entity.expectedPaths) {
      if (!derived.has(path)) {
        falseNegatives.push({
          kind: 'false-negative',
          reason: REASON_PATH_NOT_DERIVED,
          canonicalId: entity.canonicalId,
          detail: `expected ${JSON.stringify(path)}; derivedPaths = ${JSON.stringify(actual.derivedPaths)}`,
        });
      }
    }

    const expectedSet = new Set(entity.expectedPaths);
    for (const path of actual.derivedPaths) {
      if (!expectedSet.has(path)) {
        falsePositives.push({
          kind: 'false-positive',
          reason: REASON_PATH_NOT_EXPECTED,
          canonicalId: entity.canonicalId,
          detail: `derived ${JSON.stringify(path)}; expectedPaths = ${JSON.stringify(entity.expectedPaths)}`,
        });
      }
    }

    if (actual.ownershipState !== entity.ownershipState) {
      otherMismatches.push({
        kind: 'other-mismatch',
        reason: REASON_OWNERSHIP_STATE,
        canonicalId: entity.canonicalId,
        detail: `expected ${entity.ownershipState}, derived ${actual.ownershipState}`,
      });
    }

    // Order is part of the expectation, not decoration: `owned-paths-annotation.md` §3
    // requires an `explicit-paths` derivation to be `compareCodeUnits`-sorted, and the
    // whole ADR-0020 clause-6 re-freeze exists because the spike's oracle recorded input
    // order. Same members in the wrong order is a mismatch and fails the gate.
    const sameMembers =
      actual.derivedPaths.length === entity.expectedPaths.length &&
      [...derived].every((path) => expectedSet.has(path));
    const sameOrder =
      actual.derivedPaths.length === entity.expectedPaths.length &&
      entity.expectedPaths.every((path, index) => actual.derivedPaths[index] === path);
    if (sameMembers && !sameOrder) {
      otherMismatches.push({
        kind: 'other-mismatch',
        reason: REASON_PATH_ORDER,
        canonicalId: entity.canonicalId,
        detail: `expected ${JSON.stringify(entity.expectedPaths)}, derived ${JSON.stringify(actual.derivedPaths)}`,
      });
    }

    if (
      actual.sourcePath !== entity.sourcePath ||
      actual.documentIndexInFile !== entity.documentIndexInFile
    ) {
      otherMismatches.push({
        kind: 'other-mismatch',
        reason: REASON_SOURCE_DOCUMENT,
        canonicalId: entity.canonicalId,
        detail: `freeze records ${entity.sourcePath}[${entity.documentIndexInFile}], envelope records ${actual.sourcePath}[${actual.documentIndexInFile}]`,
      });
    }
  }

  const outside = observed.filter((entity) => !expectedIds.has(entity.canonicalId));
  for (const entity of outside) {
    if (entity.derivedPaths.length > 0) {
      falsePositives.push({
        kind: 'false-positive',
        reason: REASON_UNEXPECTED_OWNERSHIP,
        canonicalId: entity.canonicalId,
        detail: `${entity.sourcePath}[${entity.documentIndexInFile}] carries no frozen expectation yet derived ${JSON.stringify(entity.derivedPaths)}`,
      });
    }
  }

  // The oracle's 25-element pattern union, re-derived from what was actually produced.
  const union = [
    ...new Set(
      expected.flatMap((entity) => observedById.get(entity.canonicalId)?.derivedPaths ?? []),
    ),
  ].sort(compareCodeUnits);
  if (
    union.length !== derivedPathPatterns.length ||
    union.some((pattern, index) => pattern !== derivedPathPatterns[index])
  ) {
    otherMismatches.push({
      kind: 'other-mismatch',
      reason: REASON_PATTERN_UNION,
      canonicalId: '(corpus-wide)',
      detail: `oracle records ${derivedPathPatterns.length} patterns, output yields ${union.length}: ${JSON.stringify(union)}`,
    });
  }

  return {
    pass: falsePositives.length === 0 && falseNegatives.length === 0 && otherMismatches.length === 0,
    falsePositives,
    falseNegatives,
    otherMismatches,
    entitiesOutsideTheExpectationSet: outside,
  };
}

// ── Running the generator over the corpus ─────────────────────────────────────────────

/** A deliberate corruption of the comparison input. Used only by T089's negative case. */
export interface OverlayMutation {
  readonly sourcePath: string;
  readonly documentIndexInFile: number;
  readonly annotationValue: string;
}

/**
 * T089's retained failing input, as a named constant rather than free-form CLI text.
 *
 * ADR-0016 clause 2 requires the failing input be kept "as a permanent negative case, not
 * a throwaway. The artifact that proves the check works is the case that makes it fail."
 * A `--mutate <anything>` flag would make the retained artifact a shell invocation
 * somebody has to reproduce exactly; a fixed constant makes it a line of code.
 *
 * **What it changes, and what it cannot.** It replaces one overlay annotation *value* —
 * the corpus side of the comparison — with a plausible-looking near-miss: the two frozen
 * patterns for `backstage-plugin-adr-backend` become one right and one wrong. It cannot
 * touch the frozen expectations; nothing in this file writes to `evidence/`, and
 * `scripts/check-freeze-hashes.ts` would fail the build if anything did.
 *
 * The near-miss is deliberate. A wholesale replacement would fail on everything at once
 * and would not show that the comparison discriminates; this yields exactly one false
 * negative (`packages/cli/**` expected, not derived) and exactly one false positive
 * (`packages/clx/**` derived, not expected) from a single altered character.
 */
export const T089_MUTATION: OverlayMutation = {
  sourcePath: 'workspaces/adr/plugins/adr-backend/catalog-info.yaml',
  documentIndexInFile: 0,
  annotationValue: '["packages/core/**","packages/clx/**"]',
};

export interface RunResult {
  readonly envelope: SnapshotEnvelope;
  readonly observed: readonly ObservedEntity[];
  /** sha256 of each overlaid descriptor, as fed to the generator. Step (b)'s own hashes. */
  readonly overlaidDigests: Readonly<Record<string, string>>;
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...Bun.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  return stdout.trim();
}

/**
 * Generate over the frozen accept corpus, with the overlay applied into a temporary run
 * directory that is removed before this function returns.
 *
 * # Why the run directory declares the corpus's identity
 *
 * `repository/identity.ts` compares the manifest's declared `{id, revision}` against the
 * checkout's observed identity. The descriptors here came from
 * `github.com/backstage/community-plugins` at the pinned commit, and their bytes were
 * verified against the content address that commit fixes (`scripts/vendor-accept-corpus.ts`),
 * so that pair *is* their true identity and declaring anything else would be the false
 * statement.
 *
 * A temporary git checkout cannot be made to report a foreign commit as its `HEAD`, so the
 * identity is supplied through `GenerationRequest.observedRepositoryState` — which
 * `pipeline.ts` documents as "the checkout's observed identity, when the caller has already
 * read it… a **value**, never a function", precisely so a caller can supply data without
 * supplying behaviour. Every other stage runs exactly as it does in production.
 *
 * # Nothing is written into the vendored corpus
 *
 * The pristine tree is read and never written. The overlaid bytes exist only inside the
 * temporary directory, which is deleted in a `finally`.
 */
export async function generateOverCorpus(
  repoRoot: string,
  frozen: FrozenSide,
  overlay: readonly OverlayEntry[],
  mutation?: OverlayMutation,
): Promise<RunResult> {
  const sourcePaths = [...new Set(frozen.entities.map((entity) => entity.sourcePath))].sort(
    compareCodeUnits,
  );

  const effectiveOverlay = [...overlay];
  if (mutation !== undefined) {
    const index = effectiveOverlay.findIndex(
      (entry) =>
        entry.sourcePath === mutation.sourcePath &&
        entry.documentIndexInFile === mutation.documentIndexInFile,
    );
    if (index === -1) {
      throw new Error(`mutation targets ${mutation.sourcePath}, which the overlay does not cover`);
    }
    effectiveOverlay[index] = { ...mutation };
  }

  const run = await mkdtemp(join(tmpdir(), 'adrkit-clause5-step-b-'));
  try {
    await git(['init', '-q', '-b', 'main'], run);
    await git(['remote', 'add', 'origin', `https://${frozen.repository}.git`], run);

    const overlaidDigests: Record<string, string> = {};
    const sources: { path: string; digestAlgorithm: 'sha256'; digest: string }[] = [];

    for (const sourcePath of sourcePaths) {
      const pristine = await readFile(join(repoRoot, CORPUS_DIR, sourcePath), 'utf8');
      let text = pristine;
      for (const entry of effectiveOverlay.filter((one) => one.sourcePath === sourcePath)) {
        text = applyOverlay(sourcePath, text, entry.documentIndexInFile, entry.annotationValue);
      }

      const destination = join(run, sourcePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, text, 'utf8');

      const digest = sha256Hex(new TextEncoder().encode(text));
      overlaidDigests[sourcePath] = digest;
      sources.push({ path: sourcePath, digestAlgorithm: 'sha256', digest });
    }

    const manifestPath = join(run, 'input-manifest.json');
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          manifestSchemaVersion: '1',
          requestedSnapshotSchemaVersion: '1',
          requiredCapabilities: ['pathOwnership'],
          repository: { id: frozen.repository, revision: frozen.commit },
          sources,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const outcome = await runGeneration({
      manifestPath,
      checkoutRoot: run,
      provenance: allMaintainerOverlay(sources.map((source) => source.path)),
      observedRepositoryState: {
        remoteRaw: `https://${frozen.repository}.git`,
        head: frozen.commit,
      },
    });

    if (!outcome.ok) {
      throw new Error(
        `the generator rejected the frozen accept corpus: ${outcome.failure.triggerClass} — ${outcome.failure.detail}`,
      );
    }

    return {
      envelope: outcome.envelope,
      observed: outcome.envelope.entities.map((entity) => ({
        canonicalId: entity.identity.canonicalId,
        ownershipState: entity.ownershipState,
        derivedPaths: entity.derivedPaths,
        sourcePath: entity.sourceDocument.sourcePath,
        documentIndexInFile: entity.sourceDocument.documentIndexInFile,
      })),
      overlaidDigests,
    };
  } finally {
    await rm(run, { recursive: true, force: true });
  }
}

// ── The report ────────────────────────────────────────────────────────────────────────

export interface ComparisonReport {
  readonly verdict: 'PASS' | 'FAIL';
  readonly outcome: ComparisonOutcome;
  readonly run: RunResult;
  readonly frozen: FrozenSide;
}

export async function compareAcceptCorpus(
  repoRoot: string,
  mutation?: OverlayMutation,
): Promise<ComparisonReport> {
  const frozen = readFrozenSide(
    JSON.parse(await readFile(join(repoRoot, FREEZE_PATH), 'utf8')) as unknown,
    JSON.parse(await readFile(join(repoRoot, ORACLE_PATH), 'utf8')) as unknown,
  );
  const overlay = readOverlay(
    JSON.parse(await readFile(join(repoRoot, OVERLAY_PATH), 'utf8')) as unknown,
  );

  const run = await generateOverCorpus(repoRoot, frozen, overlay, mutation);
  const outcome = compare(frozen.entities, run.observed, frozen.derivedPathPatterns);

  return { verdict: outcome.pass ? 'PASS' : 'FAIL', outcome, run, frozen };
}

/** The diff report, as written to `evidence/comparison/diff-report.json`. */
export function renderDiffReport(report: ComparisonReport): Record<string, unknown> {
  const { frozen, outcome, run } = report;
  return {
    '//':
      'T088 — ADR-0020 clause 5 step (b): the post-output comparison. Derived ownership for every ' +
      'annotated entity in the frozen accept corpus, diffed against the frozen expectations at zero ' +
      'false positives and zero false negatives. Written by scripts/compare-accept-corpus.ts. The ' +
      'expectations were NOT amended to fit this output, and could not have been: ' +
      'scripts/check-freeze-hashes.ts fails the build on any drift in the frozen trees.',
    task: 'T088',
    barrierSide: 'BEHIND',
    discharges: ['FR-056', 'SC-011'],
    verdict: report.verdict,
    corpusRef: { repository: frozen.repository, commit: frozen.commit },
    frozenInputs: {
      'accept-corpus-freeze/accept-corpus-freeze.json': frozen.freezeContentHash,
      'frozen-expectations/frozen-expectation-set.json': frozen.oracleContentHash,
      note:
        'Read, cross-checked against each other, and never written. The freeze itself states that ' +
        'the two artifacts are two views of one freeze and that a divergence between them is a ' +
        'freeze failure; this harness refuses to run if they disagree.',
    },
    counts: {
      expectedEntities: frozen.entities.length,
      envelopeEntities: run.observed.length,
      entitiesOutsideTheExpectationSet: outcome.entitiesOutsideTheExpectationSet.length,
      falsePositives: outcome.falsePositives.length,
      falseNegatives: outcome.falseNegatives.length,
      otherMismatches: outcome.otherMismatches.length,
      countingNote:
        'Descriptor FILE count and entity DOCUMENT count are different numbers. 24 files are named ' +
        'by the manifest; the envelope carries one entity per admissible YAML document in them, ' +
        'which is more. An entity outside the expectation set is a finding only if it derived a ' +
        'non-empty path set.',
    },
    findings: {
      falsePositives: outcome.falsePositives,
      falseNegatives: outcome.falseNegatives,
      otherMismatches: outcome.otherMismatches,
    },
    entitiesOutsideTheExpectationSet: outcome.entitiesOutsideTheExpectationSet.map((entity) => ({
      canonicalId: entity.canonicalId,
      ownershipState: entity.ownershipState,
      derivedPaths: entity.derivedPaths,
      sourcePath: entity.sourcePath,
      documentIndexInFile: entity.documentIndexInFile,
    })),
    derivedOwnership: [...run.observed]
      .filter((entity) =>
        frozen.entities.some((expected) => expected.canonicalId === entity.canonicalId),
      )
      .sort((a, b) => compareCodeUnits(a.canonicalId, b.canonicalId))
      .map((entity) => ({
        canonicalId: entity.canonicalId,
        ownershipState: entity.ownershipState,
        derivedPaths: entity.derivedPaths,
        sourcePath: entity.sourcePath,
        documentIndexInFile: entity.documentIndexInFile,
      })),
    whatThisDoesAndDoesNotEstablish: {
      establishes:
        'That the generator\u2019s derived ownership over this frozen corpus agrees, exactly and in ' +
        'order, with a maintainer-authored expectation set frozen before any generator output existed.',
      doesNotEstablish: [
        'It does not establish correctness in any absolute sense. The expectations are the maintainer\u2019s own, hand-derived from frozen contracts; agreement between our implementation and our specification is not independent evidence that either is right.',
        'The envelope\u2019s self-digest establishes INTEGRITY, not correctness. A semantically wrong envelope can carry a perfectly valid self-digest (ADR-0020 clause 5, FR-058, SC-012).',
        'It says nothing about Backstage as a running system. The admissibility warrant is exactly what the four pinned validator predicates return at Backstage commit 1121a4facd9e321179d0402c3f355e4a649e84d9.',
        'It does not evidence that the mapping reflects anyone\u2019s actual ownership, that anyone else wants the annotation, or that adoption risk has fallen.',
        'ADR-0014 rung 1 only \u2014 not reference-verified, not externally validated, and no release is scheduled, prepared, or implied.',
      ],
    },
  };
}

/**
 * The only CLI flag, and it exists solely so the FAIL path is observable from a shell.
 *
 * ADR-0016 will not accept a gate that has only ever been seen green. Passing this
 * applies {@link T089_MUTATION} to the comparison **input** and writes no report — the
 * report on disk always describes an unmutated run.
 */
export const OBSERVE_FAILING_FLAG = '--observe-failing';

/**
 * T090 — step (b)'s **own** record: its own hashes, its own verdict.
 *
 * ADR-0020 clause 5 requires the pre-output freeze/audit and the post-output comparison to
 * be "two distinct steps, each recording its own hashes and its own PASS/FAIL", and
 * `spec.md` FR-057 adds that "neither may inherit the other's verdict".
 *
 * So this record does three things and inherits nothing:
 *
 * - It **recomputes** each frozen artifact's canonical content hash from the artifact and
 *   compares it to the recorded value. `data-model.md` §16: "an audit that transcribes the
 *   author's declared hash has verified nothing." The same applies here.
 * - It records hashes that are step (b)'s **own** — of the vendored corpus bytes, of the
 *   overlaid bytes actually fed to the generator, and of the envelope that came out. None
 *   of these existed at step (a), which is what makes this a second step rather than a
 *   restatement of the first.
 * - It renders its own verdict from its own comparison.
 */
export function renderStepBRecord(
  report: ComparisonReport,
  recomputedFrozenHashes: Readonly<Record<string, { recorded: string; recomputed: string; match: boolean }>>,
  vendoredCorpusSha256: Readonly<Record<string, string>>,
): Record<string, unknown> {
  return {
    '//':
      'T090 — ADR-0020 clause 5 step (b)\u2019s own record. Step (b) inherits nothing from step (a): ' +
      'it recomputes the frozen hashes rather than trusting them, records hashes of its own that did ' +
      'not exist at step (a), and renders its own verdict. Written by scripts/compare-accept-corpus.ts.',
    task: 'T090',
    barrierSide: 'BEHIND',
    discharges: ['FR-057 (step (b) half)'],
    step: 'ADR-0020 clause 5 step (b) — post-output comparison',
    verdict: report.verdict,
    inheritsFromStepA: false,
    whyItInheritsNothing:
      'FR-057: "The pre-output freeze/audit (FR-053, FR-054) and the post-output comparison (FR-056) ' +
      'MUST be recorded as two distinct steps, each recording its own hashes and its own PASS/FAIL. ' +
      'Neither may inherit the other\u2019s verdict." Step (a)\u2019s PASS is not evidence for this one, and ' +
      'this one\u2019s PASS is not evidence that step (a) was right \u2014 it is evidence that the generator ' +
      'agrees with what step (a) froze.',
    recomputedFrozenHashes,
    recomputationNote:
      'Recorded values are read from the artifacts; recomputed values are derived with the canonical ' +
      'form of evidence/README.md §3 (contentHash key removed, keys ascending by compareCodeUnits, ' +
      'array order preserved, no insignificant whitespace, UTF-8, no trailing newline). A `match: false` ' +
      'here is a freeze failure and fails this record\u2019s verdict.',
    ownHashes: {
      note:
        'Hashes that belong to step (b) and did not exist at step (a). The corpus was not vendored, no ' +
        'overlaid input existed, and no envelope existed when the freeze was written.',
      vendoredCorpusSha256,
      overlaidSourceDigests: report.run.overlaidDigests,
      envelopeDigest: report.run.envelope.digest,
      envelopeDigestMeans:
        'INTEGRITY, not correctness. A semantically wrong envelope can carry a perfectly valid ' +
        'self-digest (ADR-0020 clause 5, FR-058, SC-012). What speaks to the derivation is the ' +
        'comparison, and what the comparison speaks to is agreement with a maintainer-authored ' +
        'expectation set \u2014 not correctness in any absolute sense.',
    },
    counts: {
      expectedEntities: report.frozen.entities.length,
      envelopeEntities: report.run.envelope.entities.length,
      falsePositives: report.outcome.falsePositives.length,
      falseNegatives: report.outcome.falseNegatives.length,
      otherMismatches: report.outcome.otherMismatches.length,
    },
    honesty: {
      rung: 'ADR-0014 rung 1 only. Maintainer-owned verification, which is not external, third-party, or community adoption. Only the corpus DATA is third-party.',
      release: 'No release is scheduled, prepared, or implied. ADR-0020 clause 9 defers both the vehicle and the decision to release at all to a later record.',
      backstage:
        'No claim is made about Backstage as a running system. The admissibility warrant is exactly what the four pinned validator predicates return at Backstage commit 1121a4facd9e321179d0402c3f355e4a649e84d9.',
    },
  };
}

/**
 * T091 — the prohibition guard's record: the expectations were never amended.
 *
 * ADR-0020 clause 5: "the expectations are never amended to fit the output". A comparison
 * that passes because the expectations moved is not a passing comparison, and prose cannot
 * distinguish the two — so the values Phase B independently recorded are compared against
 * the values recomputed now, across the whole of Phase E and Phase F.
 *
 * Phase B's values are read from `barrier-b-checkpoint.json`, which was written by the
 * independent auditor session rather than by the freeze's author, so the baseline is not a
 * value this phase could have chosen.
 */
export function renderExpectationsUnchanged(
  phaseBHashes: Readonly<Record<string, string>>,
  recomputed: Readonly<Record<string, { recorded: string; recomputed: string; match: boolean }>>,
): Record<string, unknown> {
  const comparisons = FROZEN_ARTIFACTS.map((artifact) => {
    const phaseB = phaseBHashes[artifact];
    const now = recomputed[artifact];
    return {
      artifact,
      phaseBRecordedHash: phaseB ?? null,
      recomputedNow: now?.recomputed ?? null,
      recordedInArtifactNow: now?.recorded ?? null,
      unchangedSincePhaseB: phaseB !== undefined && now !== undefined && now.recomputed === phaseB,
      selfConsistentNow: now?.match === true,
    };
  });

  return {
    '//':
      'T091 — the clause-5 prohibition, enforced rather than asserted: the frozen expectations were ' +
      'never amended to fit the output. Phase B\u2019s hash values are read from barrier-b-checkpoint.json ' +
      '(written by the independent auditor session, not by the freeze\u2019s author) and compared against ' +
      'values recomputed from the live artifacts now, after all of Phase E and Phase F.',
    task: 'T091',
    barrierSide: 'BEHIND',
    discharges: [],
    enforces: 'ADR-0020 clause 5 — "the expectations are never amended to fit the output"',
    phaseBSource: `${CHECKPOINT_PATH} \u2192 confirmations.mechanism2_hashMatch.recordedHashes`,
    alsoRecordedAt:
      'accept-corpus-freeze/selection-basis.md §8.4 carries the same two values in a table, independently written.',
    comparisons,
    allUnchanged: comparisons.every((entry) => entry.unchangedSincePhaseB && entry.selfConsistentNow),
    whyThisIsNotCircular:
      'The recomputation derives each hash from the artifact\u2019s bytes; the baseline comes from a ' +
      'record written before any generator existed. An artifact edited to fit output would recompute ' +
      'to a different value than the one Phase B recorded, whatever its own contentHash field says. ' +
      'scripts/check-freeze-hashes.ts catches the narrower case where the bytes moved but the recorded ' +
      'hash did not, and has been observed genuinely failing on a one-byte mutation ' +
      '(negative-cases/freeze-drift/).',
    honesty: {
      rung: 'ADR-0014 rung 1 only.',
      scope:
        'This shows the expectations did not move. It does not show they were right \u2014 that is not a ' +
        'property any hash can carry.',
    },
  };
}

/** Recompute every frozen artifact's canonical content hash, and compare to its recorded value. */
async function recomputeFrozenHashes(
  repoRoot: string,
): Promise<Record<string, { recorded: string; recomputed: string; match: boolean }>> {
  const out: Record<string, { recorded: string; recomputed: string; match: boolean }> = {};
  for (const artifact of FROZEN_ARTIFACTS) {
    const parsed = JSON.parse(
      await readFile(join(repoRoot, EVIDENCE_DIR, artifact), 'utf8'),
    ) as Record<string, unknown>;
    const recorded = parsed['contentHash'];
    if (typeof recorded !== 'string') throw new Error(`${artifact} carries no contentHash`);
    const recomputed = canonicalHash(parsed);
    out[artifact] = { recorded, recomputed, match: recorded === recomputed };
  }
  return out;
}

/** sha256 of every vendored descriptor, read from the pristine tree this run consumed. */
async function vendoredCorpusHashes(
  repoRoot: string,
  sourcePaths: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const sourcePath of sourcePaths) {
    const bytes = new Uint8Array(
      await Bun.file(join(repoRoot, CORPUS_DIR, sourcePath)).arrayBuffer(),
    );
    out[sourcePath] = sha256Hex(bytes);
  }
  return out;
}

/** Phase B's independently-recorded hash values, from the Barrier B checkpoint. */
async function phaseBHashes(repoRoot: string): Promise<Record<string, string>> {
  const checkpoint = JSON.parse(await readFile(join(repoRoot, CHECKPOINT_PATH), 'utf8')) as {
    confirmations?: { mechanism2_hashMatch?: { recordedHashes?: Record<string, string> } };
  };
  const recorded = checkpoint.confirmations?.mechanism2_hashMatch?.recordedHashes;
  if (recorded === undefined) {
    throw new Error(
      `${CHECKPOINT_PATH} carries no confirmations.mechanism2_hashMatch.recordedHashes, so the ` +
        'Phase B baseline cannot be read. Refusing to substitute the current values for it.',
    );
  }
  return recorded;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main(repoRoot: string, argv: readonly string[]): Promise<void> {
  const observeFailing = argv.includes(OBSERVE_FAILING_FLAG);
  const report = await compareAcceptCorpus(repoRoot, observeFailing ? T089_MUTATION : undefined);

  if (observeFailing) {
    console.log(
      `compare-accept-corpus: ${OBSERVE_FAILING_FLAG} — the comparison INPUT was deliberately ` +
        `mutated at ${T089_MUTATION.sourcePath}[${T089_MUTATION.documentIndexInFile}]. ` +
        'The frozen expectations were not touched, and nothing was written.',
    );
  } else {
    // The whole of step (b)'s evidence comes out of this one run. Hand-writing any of it
    // would make the record a claim about a run rather than a product of one.
    const recomputed = await recomputeFrozenHashes(repoRoot);
    const corpusHashes = await vendoredCorpusHashes(
      repoRoot,
      [...new Set(report.frozen.entities.map((entity) => entity.sourcePath))].sort(compareCodeUnits),
    );

    await writeJson(join(repoRoot, DIFF_REPORT_PATH), renderDiffReport(report));
    await writeJson(
      join(repoRoot, STEP_B_RECORD_PATH),
      renderStepBRecord(report, recomputed, corpusHashes),
    );
    await writeJson(
      join(repoRoot, EXPECTATIONS_UNCHANGED_PATH),
      renderExpectationsUnchanged(await phaseBHashes(repoRoot), recomputed),
    );
  }

  const { falsePositives, falseNegatives, otherMismatches } = report.outcome;
  console.log(
    `compare-accept-corpus: ${report.verdict} — ${report.frozen.entities.length} expected entities, ` +
      `${falsePositives.length} false positive(s), ${falseNegatives.length} false negative(s), ` +
      `${otherMismatches.length} other mismatch(es)`,
  );
  for (const finding of [...falseNegatives, ...falsePositives, ...otherMismatches]) {
    console.error(`  ${finding.kind} ${finding.canonicalId}: ${finding.reason} — ${finding.detail}`);
  }
  if (report.verdict === 'FAIL') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.cwd(), process.argv.slice(2));
}
