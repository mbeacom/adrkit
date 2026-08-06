/**
 * T097 — checks on the no-spike-heuristics guard.
 *
 * Two things need proving, and they are different:
 *
 * 1. **The guard fires** on each option's characteristic construct. A guard never watched
 *    failing is not evidence of anything (ADR-0016), and the permanent negative cases at
 *    `<EVIDENCE>/negative-cases/spike-heuristic/` record it firing on the real tree.
 * 2. **The guard does not fire on prose.** This is the failure mode that would actually
 *    bite: both packages document the prohibition at length, and a scanner that matched
 *    documentation would have to be silenced by deleting the documentation. The stripper
 *    is what prevents that, and it is tested directly.
 *
 * The behavioural half — that no annotation yields no paths, rather than a
 * parent-directory glob or `**` — is asserted at the end, because a structural claim
 * about what the code *can* express is worth more when the runtime agrees.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  EXCLUDED_FROM_SCAN,
  RULES,
  SCANNED_PACKAGES,
  checkNoSpikeHeuristics,
  lexicalViolations,
  scanFiles,
  stripComments,
  structuralViolations,
} from './check-no-spike-heuristics.ts';
import { deriveOwnership } from '../packages/adapters/catalog-backstage/src/ownership/derive.ts';

const REPO_ROOT = join(import.meta.dir, '..');

function violate(source: string) {
  return lexicalViolations([{ path: 'fixture.ts', code: stripComments(source) }]);
}

describe('the repository is clean, and the scan actually looked', () => {
  test('no violation anywhere in either package', () => {
    expect(checkNoSpikeHeuristics(REPO_ROOT)).toEqual([]);
  });

  test('the scan read a substantial number of modules', () => {
    // A scan that read nothing reports the same green as one that read everything. The
    // count is asserted so "could not look" is distinguishable from "looked and found
    // nothing" — the defect `test/source-scan.ts` exists to avoid.
    const files = scanFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(80);
    for (const packageDirectory of SCANNED_PACKAGES) {
      expect(files.some((file) => file.path.startsWith(packageDirectory))).toBe(true);
    }
  });

  test('the exclusion list is exactly what it is declared to be', () => {
    // An exclusion list that can grow without anyone noticing is the same defect the
    // scan is guarding against. It is empty today, and that is asserted rather than
    // assumed.
    expect(EXCLUDED_FROM_SCAN).toEqual([]);
  });
});

describe('every rule fires on the construct it names', () => {
  const FIXTURES: readonly { readonly ruleId: string; readonly source: string }[] = [
    { ruleId: 'option-bcd-identifier', source: 'const optionB = candidatePaths();' },
    { ruleId: 'non-authoritative-label', source: 'const label = "non-authoritative";' },
    { ruleId: 'descriptor-parent-heuristic', source: 'const descriptorParent = dir + "/**";' },
    { ruleId: 'repository-root-heuristic', source: 'const repositoryRootGlob = "**";' },
    { ruleId: 'identity-only-comparison-mode', source: 'const identityOnlyMode = true;' },
    { ruleId: 'heuristic-opt-in', source: 'const options = { heuristics: true };' },
  ];

  for (const { ruleId, source } of FIXTURES) {
    test(`${ruleId} fires on: ${source}`, () => {
      expect(violate(source).map((violation) => violation.ruleId)).toContain(ruleId);
    });
  }

  test('every declared rule has a fixture, so none is untested', () => {
    // Without this, adding a rule and forgetting its fixture would leave an unexercised
    // rule in the passing column — exactly what T099 has to report as a gap.
    expect(FIXTURES.map((fixture) => fixture.ruleId).sort()).toEqual(
      RULES.map((rule) => rule.id).sort(),
    );
  });

  test('each rule names the option it belongs to', () => {
    for (const rule of RULES) {
      expect(['B', 'C', 'D', 'apparatus']).toContain(rule.option);
      expect(rule.why.length).toBeGreaterThan(0);
    }
  });
});

describe('the guard does not fire on documentation of the rule it enforces', () => {
  test('a doc comment describing option B is not a violation', () => {
    const source = `
/**
 * Option B (descriptor-parent) derives candidate paths from the descriptor file's own
 * parent directory: descriptorParent = dirname(sourcePath) + '/**'. It is forbidden here,
 * and was labelled "non-authoritative" by its own contract.
 */
export const NOTHING = 1;
`;
    expect(violate(source)).toEqual([]);
  });

  test('a line comment naming the forbidden identifiers is not a violation', () => {
    expect(violate('// optionC and repositoryRootGlob are forbidden\nconst x = 1;')).toEqual([]);
  });

  test('but the same identifier in real code IS a violation', () => {
    // The pair that shows the stripper discriminates rather than merely being lenient.
    expect(violate('const repositoryRootGlob = "**";').length).toBeGreaterThan(0);
  });

  test('a string literal still counts, because a label is a claim', () => {
    // Strings survive stripping deliberately: `"non-authoritative"` in a string is the
    // report label itself, not a description of it.
    expect(violate('const l = "non-authoritative";').length).toBeGreaterThan(0);
  });
});

describe('options B and C are structurally inexpressible at the derivation boundary', () => {
  test('deriveOwnership is handed the annotation and nothing else', async () => {
    // The claim FR-061 actually rests on. Without a path, B and C are not values this
    // function could compute, whatever anyone later wanted.
    const derive = await Bun.file(
      join(REPO_ROOT, 'packages/adapters/catalog-backstage/src/ownership/derive.ts'),
    ).text();
    const signature = /export function deriveOwnership\(([\s\S]*?)\)\s*:/u.exec(derive)?.[1] ?? '';

    expect(signature.length).toBeGreaterThan(0);
    for (const forbidden of ['sourcePath', 'descriptorPath', 'checkoutRoot', 'repositoryRoot']) {
      expect(signature).not.toContain(forbidden);
    }
    expect(structuralViolations(REPO_ROOT)).toEqual([]);
  });
});

describe('the runtime agrees with the structural claim', () => {
  test('an absent annotation derives NOTHING — not a parent glob, not `**`', () => {
    const derivation = deriveOwnership(false, undefined);
    expect(derivation.ok).toBe(true);
    if (!derivation.ok) return;
    expect(derivation.value.ownershipState).toBe('annotation-absent');
    expect(derivation.value.derivedPaths).toEqual([]);
    // Named explicitly, because these are the two values options B and C would put here.
    expect(derivation.value.derivedPaths).not.toContain('**');
  });

  test('an explicit-empty annotation derives NOTHING either', () => {
    const derivation = deriveOwnership(true, '[]');
    expect(derivation.ok).toBe(true);
    if (!derivation.ok) return;
    expect(derivation.value.ownershipState).toBe('explicit-empty');
    expect(derivation.value.derivedPaths).toEqual([]);
  });

  test('an annotated entity derives EXACTLY its annotation, never augmented', () => {
    // Options B and C would show up here as extra members: a parent-directory glob or a
    // `**` appended to what the annotation actually said. The order is the FR-033
    // `compareCodeUnits` sort, not the authored order — so the assertion is on the set
    // as sorted, and the count is what rules out augmentation.
    const derivation = deriveOwnership(true, '["packages/one/**","docs/**"]');
    expect(derivation.ok).toBe(true);
    if (!derivation.ok) return;
    expect(derivation.value.derivedPaths).toEqual(['docs/**', 'packages/one/**']);
    expect(derivation.value.derivedPaths).toHaveLength(2);
    expect(derivation.value.derivedPaths).not.toContain('**');
  });
});
