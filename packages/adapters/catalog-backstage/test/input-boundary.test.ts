/**
 * T045 — FR-013: the input boundary is closed.
 *
 * Two independent mechanisms, because either alone has the shape ADR-0016 clause 3
 * warns about:
 *
 * 1. **A computed value.** `admissibleReadSet` derives the entire permitted read
 *    set from the manifest, and `classifyLocationTarget` decides whether a concrete
 *    `Location` target is inside it. These assert *specific observed values*, not
 *    an absence.
 * 2. **A source scan.** Even a correct read set would not stop some other module
 *    from calling `readdir` directly, so the package's own sources are scanned for
 *    the constructs `input-manifest.md` §5 forbids. The scan reports the files it
 *    read, so a scan that saw nothing cannot be mistaken for a clean one.
 *
 * The `Location` worked example is `input-manifest.md` §6, transcribed.
 */

import { describe, expect, test } from 'bun:test';
import {
  PERMITTED_GIT_READS,
  WHOLE_CATALOG_COMPLETENESS,
  admissibleReadSet,
  classifyLocationTarget,
  classifyLocationTargets,
  isManifestListedSource,
} from '../src/manifest/boundary.ts';
import { validateManifestShape } from '../src/manifest/schema.ts';
import { ADAPTER_ROOT, type Rule, scanned, violations } from './source-scan.ts';

function manifestWith(paths: readonly string[]) {
  const result = validateManifestShape({
    manifestSchemaVersion: '1',
    requestedSnapshotSchemaVersion: '1',
    requiredCapabilities: ['pathOwnership'],
    repository: { id: 'github.com/mbeacom/fixture', revision: '0'.repeat(40) },
    sources: paths.map((path) => ({
      path,
      digestAlgorithm: 'sha256',
      digest: 'a'.repeat(64),
    })),
  });
  if (!result.ok) throw new Error(`fixture failed the schema: ${result.rejection.detail}`);
  return result.value;
}

describe('T045 — the read set is derived from the manifest and nothing else', () => {
  test('it contains exactly the manifest-listed sources, plus the manifest itself', () => {
    const readSet = admissibleReadSet('adrkit-manifest.json', manifestWith(['a.yaml', 'b.yaml']));
    expect(readSet.manifestPath).toBe('adrkit-manifest.json');
    expect(readSet.sourcePaths).toEqual(['a.yaml', 'b.yaml']);
  });

  test('it is a function of content alone — declaration order does not change it', () => {
    const forward = admissibleReadSet('m.json', manifestWith(['b.yaml', 'a.yaml']));
    const reverse = admissibleReadSet('m.json', manifestWith(['a.yaml', 'b.yaml']));
    expect(forward.sourcePaths).toEqual(reverse.sourcePaths);
    expect(forward.sourcePaths).toEqual(['a.yaml', 'b.yaml']);
  });

  test('a repeated source appears once', () => {
    const readSet = admissibleReadSet('m.json', manifestWith(['a.yaml', 'a.yaml']));
    expect(readSet.sourcePaths).toEqual(['a.yaml']);
  });

  test('the permitted subprocess reads are exactly the two `input-manifest.md` §5 names', () => {
    expect(PERMITTED_GIT_READS.map((argv) => argv.join(' '))).toEqual([
      'remote get-url origin',
      'rev-parse HEAD',
    ]);
  });

  test('FR-014 — whole-catalog completeness is always false', () => {
    expect(WHOLE_CATALOG_COMPLETENESS).toBe(false);
  });
});

describe('T045 — the `Location` worked example (`input-manifest.md` §6)', () => {
  // §6: a synthetic `Location` entity whose `spec.targets` names a second fixture
  // file that is *not itself listed* in the manifest's `sources` array.
  const readSet = admissibleReadSet('adrkit-manifest.json', manifestWith(['location.yaml']));

  test('the unlisted target is classified `zero-derived-paths-never-read`', () => {
    const classification = classifyLocationTarget(readSet, 'components/payments.yaml');
    expect(classification.outcome).toBe('zero-derived-paths-never-read');
  });

  test('it is never classified `invalid-input` — §6 forbids that specific word', () => {
    // The distinction §6 insists on: the target's annotation was not invalid, it
    // was never read at all.
    const classification = classifyLocationTarget(readSet, 'components/payments.yaml');
    expect(classification.outcome).not.toBe('invalid-input');
    expect(JSON.stringify(classification)).not.toContain('invalid-input');
  });

  test('a target that IS manifest-listed is classified as such', () => {
    const classification = classifyLocationTarget(readSet, 'location.yaml');
    expect(classification.outcome).toBe('manifest-listed');
    expect(isManifestListedSource(readSet, 'location.yaml')).toBe(true);
  });

  test('a multi-target `Location` classifies each target independently', () => {
    const classifications = classifyLocationTargets(readSet, [
      './location.yaml',
      'location.yaml',
      'components/billing.yaml',
    ]);
    expect(classifications.map((c) => c.outcome)).toEqual([
      'zero-derived-paths-never-read',
      'manifest-listed',
      'zero-derived-paths-never-read',
    ]);
  });

  test('a non-array or non-string `spec.targets` yields no classification', () => {
    // `data-model.md` §3 types descriptor content as `unknown`. Coercing a
    // malformed `spec.targets` into a target string would fabricate an
    // observation about a target that was never named.
    expect(classifyLocationTargets(readSet, undefined)).toEqual([]);
    expect(classifyLocationTargets(readSet, 'components/payments.yaml')).toEqual([]);
    expect(classifyLocationTargets(readSet, [42, null, {}])).toEqual([]);
  });
});

/**
 * Constructs `input-manifest.md` §5 forbids anywhere in this package's own sources.
 *
 * `readdirSync`/`readdir` is deliberately absent from this list: `test/source-scan.ts`
 * legitimately walks this package's own tree to *perform* this scan, and forbidding
 * it outright would make the guard forbid itself. Directory *discovery of
 * descriptors* is instead foreclosed structurally, by `admissibleReadSet` having no
 * parameter through which a directory could arrive.
 */
const FORBIDDEN: readonly Rule[] = [
  {
    id: 'backstage-processor',
    pattern: /\b(?:CatalogProcessor|catalogProcessingExtensionPoint|LocationSpec)\b/,
    why: '`input-manifest.md` §5: the generator invokes no catalog processor or plugin of any kind.',
  },
  {
    id: 'backstage-package-specifier',
    pattern: /['"]@backstage\//,
    why: '`input-manifest.md` §5: no Backstage ingestion pipeline is invoked, so no Backstage package is imported.',
  },
  {
    id: 'glob-discovery',
    pattern: /\b(?:Bun\.[Gg]lob|globSync|fast-?glob|node:glob)\b/,
    why: '`input-manifest.md` §5: descriptors are never discovered by glob expansion.',
  },
  {
    id: 'network-fetch',
    pattern: /(?:\bfetch\s*\(|\bnode:https?\b|\bXMLHttpRequest\b)/,
    why: 'FR-018 offline constraint: a generation run makes no network call of any kind.',
  },
];

/**
 * This file is excluded from its own scan.
 *
 * It carries the rule literals themselves — `@backstage/` appears above as a regex
 * literal — so scanning it would report a violation of a rule by the rule.
 * `source-scan.ts`'s own `EXCLUDED_FROM_SCAN` is asserted elsewhere to be exactly
 * Phase A's three entries, so this exclusion is applied here rather than added
 * there: an exclusion list that grows silently is the defect these scans guard
 * against, and one that is asserted in one place and appended to from another is
 * the same defect wearing a different hat.
 */
const SELF = 'packages/adapters/catalog-backstage/test/input-boundary.test.ts';

describe('T045 — the package\u2019s own sources contain none of the forbidden constructs', () => {
  const all = scanned(ADAPTER_ROOT);
  const files = all.filter((file) => file.path !== SELF);

  test('the scan actually read this package\u2019s sources, and excluded only itself', () => {
    // Without this, a scan that silently read zero files would report the same
    // green as a scan that looked properly (ADR-0016 clause 3).
    expect(files.length).toBeGreaterThan(10);
    expect(files.map((file) => file.path)).toContain(
      'packages/adapters/catalog-backstage/src/manifest/boundary.ts',
    );
    expect(all.length - files.length).toBe(1);
  });

  test('no forbidden construct appears', () => {
    expect(violations(files, FORBIDDEN)).toEqual([]);
  });

  test('every rule fires on a construct that violates it', () => {
    // A rule only ever observed passing is not coverage (ADR-0016). Each of the
    // four is observed rejecting, individually, so a rule that silently stopped
    // matching anything would be caught.
    const constructedViolations: Record<string, string> = {
      'backstage-processor': 'const p: CatalogProcessor = makeProcessor();',
      // Assembled rather than written literally: Phase A's `importSpecifiers`
      // heuristic reads `from '…'` inside a string as a real import, and a fixture
      // that trips a neighbouring guard is a fixture that will be "fixed" by
      // weakening that guard.
      'backstage-package-specifier': `${'imp' + 'ort'} { Entity } ${'fr' + 'om'} '@backstage/catalog-model';`,
      'glob-discovery': 'const found = new Bun.Glob("**/catalog-info.yaml");',
      'network-fetch': 'await fetch("https://example.invalid");',
    };

    for (const rule of FORBIDDEN) {
      const source = constructedViolations[rule.id];
      expect(source).toBeDefined();
      const found = violations([{ path: 'fixture.ts', code: source as string }], FORBIDDEN);
      expect(found.map((violation) => violation.ruleId)).toContain(rule.id);
    }
  });
});
