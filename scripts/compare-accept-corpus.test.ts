/**
 * T087 / T089 / T092 — checks on the clause-5 step (b) comparison harness.
 *
 * Three jobs:
 *
 * 1. **T087 — the harness exists, and its provenance is recorded.** R5 mechanism 3 is an
 *    *ordering* requirement: this harness had to be authored after the freeze and its
 *    audit. That cannot be asserted by a passing test, so what is checked here is that
 *    the record which carries it exists and says what it must.
 * 2. **T089 — the gate has been observed failing.** The mutate → FAIL → restore → PASS
 *    cycle runs in-suite against the real corpus, and the retained negative case is
 *    checked for the verbatim strings the run emitted.
 * 3. **T092 — no Phase F artifact claims correctness from a digest.** A populated,
 *    digest-verified envelope establishes integrity. This comparison establishes
 *    agreement with a maintainer-authored expectation set. Neither establishes that the
 *    adapter is correct, and every artifact this phase writes is scanned for that.
 *
 * The comparison kernel is pure, so every FAIL mode below is reachable without touching
 * anything on disk — which is what lets the failure modes be *driven* rather than merely
 * described. Nothing in this file writes to `evidence/frozen-expectations/` or
 * `evidence/accept-corpus-freeze/`; `scripts/check-freeze-hashes.test.ts` re-asserts that
 * independently (T091).
 */

import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ExpectedEntity,
  type ObservedEntity,
  OBSERVE_FAILING_FLAG,
  OverlayAbort,
  REASON_ENTITY_MISSING,
  REASON_FREEZE_DISAGREEMENT,
  REASON_OWNERSHIP_STATE,
  REASON_PATH_NOT_DERIVED,
  REASON_PATH_NOT_EXPECTED,
  REASON_PATH_ORDER,
  REASON_PATTERN_UNION,
  REASON_SOURCE_DOCUMENT,
  REASON_UNEXPECTED_OWNERSHIP,
  T089_MUTATION,
  applyOverlay,
  compare,
  compareAcceptCorpus,
  documentLineRanges,
  readFrozenSide,
  readOverlay,
} from './compare-accept-corpus.ts';

const REPO_ROOT = process.cwd();
const EVIDENCE = join(REPO_ROOT, 'specs/010-catalog-backstage/evidence');
const COMPARISON = join(EVIDENCE, 'comparison');
const NEGATIVE_CASE = join(EVIDENCE, 'negative-cases/comparison-mismatch');
const CORPUS = join(REPO_ROOT, 'specs/010-catalog-backstage/corpus');

// ── T087: the harness, its provenance, and the ordering it must respect ───────────────

describe('T087 — the comparison harness was authored after the freeze and its audit', () => {
  test('the provenance record exists and names T024\u2019s confirmation', async () => {
    const record = await readFile(join(COMPARISON, 'harness-provenance.md'), 'utf8');
    // R5 mechanism 3 cannot be proven by a passing assertion; the record is the only
    // artifact that carries it, so what is checkable is that the record is present and
    // cites the checkpoint that confirmed the absence.
    expect(record).toContain('barrier-b-checkpoint.json');
    expect(record).toContain('mechanism3_ordering');
    expect(record).toContain('T024');
  });

  test('the checkpoint it cites really does record that no harness existed', async () => {
    const checkpoint = (await Bun.file(join(EVIDENCE, 'barrier-b-checkpoint.json')).json()) as {
      BARRIER_B_CLEARED: boolean;
      confirmations: { mechanism3_ordering: { cleared: boolean; claim: string } };
    };
    expect(checkpoint.BARRIER_B_CLEARED).toBe(true);
    expect(checkpoint.confirmations.mechanism3_ordering.cleared).toBe(true);
    expect(checkpoint.confirmations.mechanism3_ordering.claim).toContain(
      'No comparison harness exists anywhere in the repository',
    );
  });

  test('the two frozen artifacts still agree with each other, or the harness refuses to run', async () => {
    // The freeze itself: "a divergence between them is a freeze failure, not a
    // discrepancy to be reconciled". So the harness reads BOTH and cross-checks.
    const frozen = readFrozenSide(
      JSON.parse(await readFile(join(EVIDENCE, 'accept-corpus-freeze/accept-corpus-freeze.json'), 'utf8')),
      JSON.parse(await readFile(join(EVIDENCE, 'frozen-expectations/frozen-expectation-set.json'), 'utf8')),
    );
    expect(frozen.entities.length).toBe(24);
    expect(frozen.derivedPathPatterns.length).toBe(25);
    expect(frozen.repository).toBe('github.com/backstage/community-plugins');
  });

  test('a disagreement between the two frozen artifacts is refused, not reconciled', () => {
    const freeze = {
      corpusRef: { repository: 'github.com/x/y', commit: 'a'.repeat(40) },
      contentHash: 'f'.repeat(64),
      expectedPaths: [
        {
          canonicalId: 'component:default/one',
          ownershipState: 'explicit-paths',
          sourcePath: 'a/catalog-info.yaml',
          documentIndexInFile: 0,
          expectedPaths: ['a/**'],
        },
      ],
    };
    const oracle = {
      contentHash: 'e'.repeat(64),
      derivedPathPatterns: ['a/**'],
      expectedByEntity: [
        { canonicalId: 'component:default/one', ownershipState: 'explicit-paths', expectedPaths: ['b/**'] },
      ],
    };
    expect(() => readFrozenSide(freeze, oracle)).toThrow(REASON_FREEZE_DISAGREEMENT);
    // And the agreeing pair is accepted, so the check is not always-fail.
    oracle.expectedByEntity[0]!.expectedPaths = ['a/**'];
    expect(readFrozenSide(freeze, oracle).entities.length).toBe(1);
  });
});

// ── The overlay: applied in memory, never onto the vendored tree ──────────────────────

describe('T088 — the overlay is applied at generation time, and the vendored tree is pristine', () => {
  test('no vendored descriptor carries the annotation, before or after a full run', async () => {
    // Ordered deliberately: read, run the whole comparison, read again. If the harness
    // ever wrote an overlaid descriptor back, this is where it would show.
    const files = (await readdir(CORPUS, { recursive: true }))
      .map(String)
      .filter((entry) => entry.endsWith('catalog-info.yaml'));
    expect(files.length).toBe(24);

    const before = await Promise.all(files.map((file) => readFile(join(CORPUS, file), 'utf8')));
    expect(before.every((text) => !text.includes('adrkit.io/owned-paths'))).toBe(true);

    await compareAcceptCorpus(REPO_ROOT);

    const after = await Promise.all(files.map((file) => readFile(join(CORPUS, file), 'utf8')));
    expect(after).toEqual(before);
  });

  test('the overlay artifact carries 23 entries \u2014 one fewer than the corpus size', async () => {
    // 24 selected entities, 23 overlay entries: the freeze exercises one
    // `annotation-absent` entity, which by definition has no annotation to overlay.
    // Read from accept-corpus-freeze.json's overlayProvenance.entries.
    const overlay = readOverlay(
      JSON.parse(await readFile(join(EVIDENCE, 'accept-corpus-freeze/overlay.json'), 'utf8')),
    );
    expect(overlay.length).toBe(23);
    expect(overlay.every((entry) => entry.documentIndexInFile === 0)).toBe(true);
  });

  test('injection into a descriptor with no annotations block adds exactly one annotation', () => {
    const pristine = ['apiVersion: backstage.io/v1alpha1', 'kind: Component', 'metadata:', '  name: one', 'spec:', '  type: website', ''].join(
      '\n',
    );
    const overlaid = applyOverlay('a/catalog-info.yaml', pristine, 0, '["a/**"]');
    expect(overlaid).toContain("    adrkit.io/owned-paths: '[\"a/**\"]'");
    expect(overlaid).toContain('  annotations:');
    // Every pristine line survives, in order.
    for (const line of pristine.split('\n')) expect(overlaid).toContain(line);
  });

  test('injection into a descriptor that already has annotations reuses the existing block', () => {
    const pristine = [
      'apiVersion: backstage.io/v1alpha1',
      'kind: Component',
      'metadata:',
      '  name: one',
      '  annotations:',
      '    backstage.io/view-url: https://example.invalid',
      'spec:',
      '  type: website',
      '',
    ].join('\n');
    const overlaid = applyOverlay('a/catalog-info.yaml', pristine, 0, '["a/**"]');
    expect(overlaid.match(/annotations:/g)?.length).toBe(1);
    expect(overlaid).toContain('    backstage.io/view-url: https://example.invalid');
  });

  test('a commented-out `# annotations:` is not mistaken for a real one', () => {
    // Two corpus descriptors carry exactly this as a documentation example, and treating
    // it as a mapping key would produce a descriptor whose annotation is inside a comment.
    const pristine = [
      'apiVersion: backstage.io/v1alpha1',
      'kind: Component',
      'metadata:',
      '  name: one',
      '  # Example for optional annotations',
      '  # annotations:',
      '  #   github.com/project-slug: backstage/backstage',
      'spec:',
      '  type: website',
      '',
    ].join('\n');
    const overlaid = applyOverlay('a/catalog-info.yaml', pristine, 0, '["a/**"]');
    expect(overlaid).toContain('  annotations:\n    adrkit.io/owned-paths:');
    expect(overlaid).toContain('  # annotations:');
  });

  test('the value is emitted as a string scalar, not a flow sequence', () => {
    // `owned-paths-annotation.md` §1 step 2 requires a YAML *string* scalar. An unquoted
    // `["a/**"]` parses as a sequence and is rejected at step 2 — a different case.
    const pristine = 'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: one\n';
    const overlaid = applyOverlay('a/catalog-info.yaml', pristine, 0, '["a/**"]');
    expect(overlaid).toContain(`adrkit.io/owned-paths: '["a/**"]'`);
  });

  test('an overlay targeting a document the file does not hold aborts', () => {
    const pristine = 'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: one\n';
    expect(() => applyOverlay('a/catalog-info.yaml', pristine, 3, '["a/**"]')).toThrow(OverlayAbort);
  });

  test('a document with no top-level `metadata:` aborts rather than being patched blindly', () => {
    expect(() => applyOverlay('a/catalog-info.yaml', 'kind: Component\n', 0, '["a/**"]')).toThrow(
      OverlayAbort,
    );
  });

  test('document ranges split a multi-document file the way the generator reads it', () => {
    const lines = ['# c', 'kind: A', '---', 'kind: B', ''];
    expect(documentLineRanges(lines)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
    // A leading `---` does not create an empty document before it.
    expect(documentLineRanges(['---', 'kind: A'])).toEqual([{ start: 1, end: 2 }]);
  });

  test('the real multi-document corpus file is overlaid on document 0 only', async () => {
    const path = 'workspaces/acr/plugins/acr/catalog-info.yaml';
    const pristine = await readFile(join(CORPUS, path), 'utf8');
    const overlaid = applyOverlay(path, pristine, 0, '["a/**"]');
    const [first = '', second = ''] = overlaid.split('\n---\n');
    expect(first).toContain('adrkit.io/owned-paths');
    expect(second).not.toContain('adrkit.io/owned-paths');
  });
});

// ── The comparison kernel: PASS on the corpus, and every FAIL mode driven ─────────────

const BASE_EXPECTED: readonly ExpectedEntity[] = [
  {
    canonicalId: 'component:default/one',
    ownershipState: 'explicit-paths',
    expectedPaths: ['a/**', 'b/**'],
    sourcePath: 'one/catalog-info.yaml',
    documentIndexInFile: 0,
  },
];

const BASE_OBSERVED: readonly ObservedEntity[] = [
  {
    canonicalId: 'component:default/one',
    ownershipState: 'explicit-paths',
    derivedPaths: ['a/**', 'b/**'],
    sourcePath: 'one/catalog-info.yaml',
    documentIndexInFile: 0,
  },
];

const BASE_UNION = ['a/**', 'b/**'];

describe('T088 — the comparison kernel discriminates, in both directions', () => {
  test('the baseline passes, so every failure below is a real discrimination', () => {
    const outcome = compare(BASE_EXPECTED, BASE_OBSERVED, BASE_UNION);
    expect(outcome.pass).toBe(true);
    expect(outcome.falsePositives).toEqual([]);
    expect(outcome.falseNegatives).toEqual([]);
    expect(outcome.otherMismatches).toEqual([]);
  });

  test('a missing entity is a false negative', () => {
    const outcome = compare(BASE_EXPECTED, [], []);
    expect(outcome.pass).toBe(false);
    expect(outcome.falseNegatives[0]?.reason).toBe(REASON_ENTITY_MISSING);
  });

  test('an expected path that was not derived is a false negative', () => {
    const observed = [{ ...BASE_OBSERVED[0]!, derivedPaths: ['a/**'] }];
    const outcome = compare(BASE_EXPECTED, observed, ['a/**']);
    expect(outcome.pass).toBe(false);
    expect(outcome.falseNegatives.map((f) => f.reason)).toContain(REASON_PATH_NOT_DERIVED);
  });

  test('a derived path that was not expected is a false positive', () => {
    const observed = [{ ...BASE_OBSERVED[0]!, derivedPaths: ['a/**', 'b/**', 'c/**'] }];
    const outcome = compare(BASE_EXPECTED, observed, ['a/**', 'b/**', 'c/**']);
    expect(outcome.pass).toBe(false);
    expect(outcome.falsePositives.map((f) => f.reason)).toContain(REASON_PATH_NOT_EXPECTED);
  });

  test('a wrong ownershipState is a mismatch, and is not reported as a path defect', () => {
    // `explicit-empty` and `annotation-absent` both yield an empty array;
    // `owned-paths-annotation.md` §3 forbids inferring the distinction from the paths.
    const expected = [{ ...BASE_EXPECTED[0]!, ownershipState: 'explicit-empty', expectedPaths: [] }];
    const observed = [{ ...BASE_OBSERVED[0]!, ownershipState: 'annotation-absent', derivedPaths: [] }];
    const outcome = compare(expected, observed, []);
    expect(outcome.pass).toBe(false);
    expect(outcome.otherMismatches.map((f) => f.reason)).toContain(REASON_OWNERSHIP_STATE);
    expect(outcome.falsePositives).toEqual([]);
    expect(outcome.falseNegatives).toEqual([]);
  });

  test('the right members in the wrong order is a mismatch', () => {
    // The whole ADR-0020 clause-6 re-freeze exists because the spike's oracle recorded
    // input order. Same members, wrong order, must not pass.
    const observed = [{ ...BASE_OBSERVED[0]!, derivedPaths: ['b/**', 'a/**'] }];
    const outcome = compare(BASE_EXPECTED, observed, BASE_UNION);
    expect(outcome.pass).toBe(false);
    expect(outcome.otherMismatches.map((f) => f.reason)).toContain(REASON_PATH_ORDER);
    expect(outcome.falsePositives).toEqual([]);
    expect(outcome.falseNegatives).toEqual([]);
  });

  test('a different source document for the same canonical id is a mismatch', () => {
    const observed = [{ ...BASE_OBSERVED[0]!, documentIndexInFile: 1 }];
    const outcome = compare(BASE_EXPECTED, observed, BASE_UNION);
    expect(outcome.pass).toBe(false);
    expect(outcome.otherMismatches.map((f) => f.reason)).toContain(REASON_SOURCE_DOCUMENT);
  });

  test('a pattern union that disagrees with the oracle is a mismatch', () => {
    const outcome = compare(BASE_EXPECTED, BASE_OBSERVED, ['a/**', 'b/**', 'c/**']);
    expect(outcome.pass).toBe(false);
    expect(outcome.otherMismatches.map((f) => f.reason)).toContain(REASON_PATTERN_UNION);
  });

  test('an entity outside the expectation set that derives NOTHING is not a finding', () => {
    // The descriptor-file / entity-document counting trap. A manifest names files; the
    // envelope carries one entity per admissible document in them. An unselected sibling
    // carries no overlay, derives nothing, and asserts no ownership.
    const sibling: ObservedEntity = {
      canonicalId: 'component:default/sibling',
      ownershipState: 'annotation-absent',
      derivedPaths: [],
      sourcePath: 'one/catalog-info.yaml',
      documentIndexInFile: 1,
    };
    const outcome = compare(BASE_EXPECTED, [...BASE_OBSERVED, sibling], BASE_UNION);
    expect(outcome.pass).toBe(true);
    expect(outcome.entitiesOutsideTheExpectationSet.map((e) => e.canonicalId)).toEqual([
      'component:default/sibling',
    ]);
  });

  test('an entity outside the expectation set that DOES derive paths is a false positive', () => {
    const sibling: ObservedEntity = {
      canonicalId: 'component:default/sibling',
      ownershipState: 'explicit-paths',
      derivedPaths: ['z/**'],
      sourcePath: 'one/catalog-info.yaml',
      documentIndexInFile: 1,
    };
    const outcome = compare(BASE_EXPECTED, [...BASE_OBSERVED, sibling], BASE_UNION);
    expect(outcome.pass).toBe(false);
    expect(outcome.falsePositives.map((f) => f.reason)).toContain(REASON_UNEXPECTED_OWNERSHIP);
  });
});

// ── T088: the real run, and the report it wrote ───────────────────────────────────────

describe('T088 / SC-011 \u2014 the real comparison over the frozen accept corpus', () => {
  test('zero false positives and zero false negatives over all 24 annotated entities', async () => {
    const report = await compareAcceptCorpus(REPO_ROOT);
    expect(report.verdict).toBe('PASS');
    expect(report.outcome.falsePositives).toEqual([]);
    expect(report.outcome.falseNegatives).toEqual([]);
    expect(report.outcome.otherMismatches).toEqual([]);
    expect(report.frozen.entities.length).toBe(24);
  });

  test('the envelope is populated, and carries MORE entities than the corpus has files', async () => {
    const report = await compareAcceptCorpus(REPO_ROOT);
    expect(report.run.envelope.entities.length).toBeGreaterThan(24);
    expect(report.run.envelope.entities.some((entity) => entity.derivedPaths.length > 0)).toBe(true);
    // Every entity, selected or not, is a maintainer overlay: no third-party descriptor
    // in the pinned corpus carries the annotation (accept-corpus-freeze overlayProvenance).
    expect(report.run.envelope.entities.every((entity) => entity.provenance === 'maintainer-overlay')).toBe(
      true,
    );
  });

  test('all three ownership states are exercised, in the proportions the freeze records', async () => {
    const report = await compareAcceptCorpus(REPO_ROOT);
    const byId = new Map(report.run.observed.map((entity) => [entity.canonicalId, entity] as const));
    const states = report.frozen.entities.map((entity) => byId.get(entity.canonicalId)?.ownershipState);
    expect(states.filter((state) => state === 'explicit-paths').length).toBe(22);
    expect(states.filter((state) => state === 'explicit-empty').length).toBe(1);
    expect(states.filter((state) => state === 'annotation-absent').length).toBe(1);
  });

  test('the run is deterministic \u2014 two comparisons agree exactly', async () => {
    const [first, second] = await Promise.all([
      compareAcceptCorpus(REPO_ROOT),
      compareAcceptCorpus(REPO_ROOT),
    ]);
    expect(JSON.stringify(second.run.envelope)).toBe(JSON.stringify(first.run.envelope));
    expect(second.run.overlaidDigests).toEqual(first.run.overlaidDigests);
  });

  test('the committed diff report records the PASS and the counts it was run at', async () => {
    const report = (await Bun.file(join(COMPARISON, 'diff-report.json')).json()) as {
      verdict: string;
      counts: Record<string, number | string>;
      findings: Record<string, unknown[]>;
    };
    expect(report.verdict).toBe('PASS');
    expect(report.counts['expectedEntities']).toBe(24);
    expect(report.counts['falsePositives']).toBe(0);
    expect(report.counts['falseNegatives']).toBe(0);
    expect(report.counts['otherMismatches']).toBe(0);
    expect(report.findings['falsePositives']).toEqual([]);
    expect(report.findings['falseNegatives']).toEqual([]);
  });
});

// ── T089: observed failing ────────────────────────────────────────────────────────────

describe('T089 \u2014 observed failing: a mutated comparison input fails the gate', () => {
  test('mutate \u2192 FAIL with one false positive and one false negative \u2192 restore \u2192 PASS', async () => {
    const mutated = await compareAcceptCorpus(REPO_ROOT, T089_MUTATION);
    expect(mutated.verdict).toBe('FAIL');
    expect(mutated.outcome.falseNegatives.length).toBe(1);
    expect(mutated.outcome.falsePositives.length).toBe(1);
    expect(mutated.outcome.falseNegatives[0]?.reason).toBe(REASON_PATH_NOT_DERIVED);
    expect(mutated.outcome.falsePositives[0]?.reason).toBe(REASON_PATH_NOT_EXPECTED);
    expect(mutated.outcome.falseNegatives[0]?.canonicalId).toBe(
      'component:default/backstage-plugin-adr-backend',
    );
    // And the corpus-wide union moves with it: 26 patterns where the oracle records 25.
    expect(mutated.outcome.otherMismatches.map((f) => f.reason)).toContain(REASON_PATTERN_UNION);

    const restored = await compareAcceptCorpus(REPO_ROOT);
    expect(restored.verdict).toBe('PASS');
  });

  test('the mutation touches the corpus side only \u2014 the frozen expectations are identical', async () => {
    // The prohibition, made checkable: the same frozen bytes are read on both runs.
    const before = await readFile(
      join(EVIDENCE, 'frozen-expectations/frozen-expectation-set.json'),
      'utf8',
    );
    await compareAcceptCorpus(REPO_ROOT, T089_MUTATION);
    const after = await readFile(
      join(EVIDENCE, 'frozen-expectations/frozen-expectation-set.json'),
      'utf8',
    );
    expect(after).toBe(before);
  });

  test('the retained negative case holds the verbatim FAIL output and the restored PASS', async () => {
    const failed = await readFile(join(NEGATIVE_CASE, 'observed-fail.txt'), 'utf8');
    expect(failed).toContain('compare-accept-corpus: FAIL');
    expect(failed).toContain('1 false positive(s), 1 false negative(s)');
    expect(failed).toContain(REASON_PATH_NOT_DERIVED);
    expect(failed).toContain(REASON_PATH_NOT_EXPECTED);
    expect(failed).toContain('exit=1');

    const restored = await readFile(join(NEGATIVE_CASE, 'restored.observed.txt'), 'utf8');
    expect(restored).toContain('compare-accept-corpus: PASS');
    expect(restored).toContain('0 false positive(s), 0 false negative(s)');
    expect(restored).toContain('exit=0');
  });

  test('the negative case README names the command that produced the failure', async () => {
    // negative-cases/README.md: "Always record which command produced the failure."
    const readme = await readFile(join(NEGATIVE_CASE, 'README.md'), 'utf8');
    expect(readme).toContain(OBSERVE_FAILING_FLAG);
    expect(readme).toContain('scripts/compare-accept-corpus.ts');
    expect(readme).toContain(T089_MUTATION.sourcePath);
  });

  test('the observe-failing flag is off by default, so the committed report is unmutated', async () => {
    const report = await compareAcceptCorpus(REPO_ROOT);
    expect(report.verdict).toBe('PASS');
    const committed = (await Bun.file(join(COMPARISON, 'diff-report.json')).json()) as {
      verdict: string;
    };
    expect(committed.verdict).toBe('PASS');
  });
});

// ── T090: step (b)'s own record ───────────────────────────────────────────────────────

describe('T090 \u2014 step (b) records its own hashes and its own verdict', () => {
  test('the record recomputes the frozen hashes rather than transcribing them', async () => {
    const record = (await Bun.file(join(COMPARISON, 'step-b-record.json')).json()) as {
      verdict: string;
      inheritsFromStepA: boolean;
      recomputedFrozenHashes: Record<string, { recorded: string; recomputed: string; match: boolean }>;
      ownHashes: Record<string, unknown>;
    };
    expect(record.verdict).toBe('PASS');
    expect(record.inheritsFromStepA).toBe(false);
    for (const entry of Object.values(record.recomputedFrozenHashes)) {
      expect(entry.match).toBe(true);
      expect(entry.recomputed).toBe(entry.recorded);
    }
    expect(Object.keys(record.ownHashes).length).toBeGreaterThan(0);
  });

  test('step (b)\u2019s own hashes cover the corpus, the overlaid inputs and the envelope', async () => {
    const record = (await Bun.file(join(COMPARISON, 'step-b-record.json')).json()) as {
      ownHashes: {
        envelopeDigest: string;
        overlaidSourceDigests: Record<string, string>;
        vendoredCorpusSha256: Record<string, string>;
      };
    };
    expect(record.ownHashes.envelopeDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(record.ownHashes.overlaidSourceDigests).length).toBe(24);
    expect(Object.keys(record.ownHashes.vendoredCorpusSha256).length).toBe(24);
  });

  test('the recorded envelope digest is the digest a fresh run actually produces', async () => {
    const record = (await Bun.file(join(COMPARISON, 'step-b-record.json')).json()) as {
      ownHashes: { envelopeDigest: string; overlaidSourceDigests: Record<string, string> };
    };
    const report = await compareAcceptCorpus(REPO_ROOT);
    expect(report.run.envelope.digest).toBe(record.ownHashes.envelopeDigest);
    expect(report.run.overlaidDigests).toEqual(record.ownHashes.overlaidSourceDigests);
  });
});

// ── T092: reporting honesty ───────────────────────────────────────────────────────────

describe('T092 \u2014 no Phase F artifact presents a digest as evidence of correctness', () => {
  /**
   * Every artifact this phase writes, plus the two scripts that write them.
   *
   * The scan reads whole files, prose included, because the claim being guarded is a
   * claim in prose. This test file is excluded for the reason `test/source-scan.ts`
   * names: it must contain the forbidden phrases in order to forbid them.
   */
  const SCANNED = [
    'specs/010-catalog-backstage/evidence/comparison/harness-provenance.md',
    'specs/010-catalog-backstage/evidence/comparison/reporting-honesty.md',
    'specs/010-catalog-backstage/evidence/comparison/diff-report.json',
    'specs/010-catalog-backstage/evidence/comparison/step-b-record.json',
    'specs/010-catalog-backstage/evidence/comparison/expectations-unchanged.json',
    'specs/010-catalog-backstage/evidence/negative-cases/comparison-mismatch/README.md',
    'scripts/compare-accept-corpus.ts',
    'scripts/vendor-accept-corpus.ts',
    'specs/010-catalog-backstage/corpus/README.md',
    'specs/010-catalog-backstage/corpus/VENDOR-MANIFEST.json',
  ] as const;

  /**
   * Affirmative overclaims. Each is chosen so it cannot occur inside a correct
   * disclaimer — "does not establish correctness" contains neither "establishes
   * correctness" nor "proves correctness", so a truthful artifact never trips these.
   */
  const FORBIDDEN = [
    'proves correctness',
    'proves the derived ownership is correct',
    'establishes correctness',
    'demonstrates correctness',
    'proof of correctness',
    'evidence of correctness',
    'is reference-verified',
    'is externally validated',
    'ready for release',
    'ready to release',
    'rung 2 evidence',
    'rung 3 evidence',
  ] as const;

  test('every scanned artifact exists, so an empty finding set is not an empty scan', async () => {
    for (const path of SCANNED) {
      expect(await Bun.file(join(REPO_ROOT, path)).exists()).toBe(true);
    }
  });

  test('no scanned artifact contains an affirmative correctness or rung overclaim', async () => {
    const offences: string[] = [];
    for (const path of SCANNED) {
      const text = (await readFile(join(REPO_ROOT, path), 'utf8')).toLowerCase();
      for (const phrase of FORBIDDEN) {
        if (text.includes(phrase)) offences.push(`${path}: ${phrase}`);
      }
    }
    expect(offences).toEqual([]);
  });

  test('the scan can see an offence, so a clean result means it looked', () => {
    const fixture = 'The populated envelope proves correctness of the derived ownership.';
    expect(FORBIDDEN.some((phrase) => fixture.toLowerCase().includes(phrase))).toBe(true);
    const honest = 'A digest establishes integrity; it does not establish correctness.';
    expect(FORBIDDEN.some((phrase) => honest.toLowerCase().includes(phrase))).toBe(false);
  });

  test('the two documents that carry the framing say integrity is not correctness', async () => {
    for (const path of [
      'specs/010-catalog-backstage/evidence/comparison/reporting-honesty.md',
      'specs/010-catalog-backstage/evidence/comparison/harness-provenance.md',
    ]) {
      const text = await readFile(join(REPO_ROOT, path), 'utf8');
      expect(text.toLowerCase()).toContain('integrity');
      expect(text.toLowerCase()).toContain('correctness');
      expect(text).toContain('rung 1');
    }
  });

  test('the diff report scopes what it establishes and lists what it does not', async () => {
    const report = (await Bun.file(join(COMPARISON, 'diff-report.json')).json()) as {
      whatThisDoesAndDoesNotEstablish: { establishes: string; doesNotEstablish: string[] };
    };
    const section = report.whatThisDoesAndDoesNotEstablish;
    expect(section.establishes).toContain('maintainer-authored expectation set');
    expect(section.doesNotEstablish.length).toBeGreaterThanOrEqual(4);
    expect(section.doesNotEstablish.join(' ')).toContain('INTEGRITY, not correctness');
    expect(section.doesNotEstablish.join(' ')).toContain('rung 1 only');
  });

  test('no Phase F artifact describes maintainer verification as external or third-party', async () => {
    // ADR-0014's honesty rule: only the corpus DATA is third-party, never the validation.
    // The phrases below are affirmative constructions only. A negated disclaimer — "which
    // is not external, third-party, or community validation" — is the correct thing to
    // write and must not trip this, which is the mistake the first draft of this check
    // made and which `negative-cases/README.md` makes verbatim.
    const AFFIRMATIVE_ADOPTION_CLAIMS = [
      'externally validated by',
      'third-party validation of',
      'validated by the community',
      'community-validated',
      'was independently validated',
    ] as const;

    const offences: string[] = [];
    for (const path of SCANNED) {
      const text = (await readFile(join(REPO_ROOT, path), 'utf8')).toLowerCase();
      for (const phrase of AFFIRMATIVE_ADOPTION_CLAIMS) {
        if (text.includes(phrase)) offences.push(`${path}: ${phrase}`);
      }
    }
    expect(offences).toEqual([]);

    // Driven, so a clean result means the scan looked.
    const overclaim = 'the adapter was externally validated by two downstream teams.';
    expect(AFFIRMATIVE_ADOPTION_CLAIMS.some((phrase) => overclaim.includes(phrase))).toBe(true);
    const disclaimer = 'this observation is maintainer-owned, which is not community validation.';
    expect(AFFIRMATIVE_ADOPTION_CLAIMS.some((phrase) => disclaimer.includes(phrase))).toBe(false);
  });
});
