/**
 * T098 — checks on the ADR-0020 clause-8 gate.
 *
 * The gate's value is entirely in its failing behaviour, so that is what is checked. Each
 * test below constructs an evidence tree that violates exactly one clause-5 requirement
 * and asserts the gate names that requirement — not merely that it failed.
 *
 * A gate that failed for the wrong reason would be indistinguishable, in CI, from one
 * that failed for the right one. Naming the requirement is what makes the failure
 * actionable and what makes this suite a check on the *mapping* from clause 5's sentences
 * to code, rather than on the exit code alone.
 *
 * The permanent negative cases — the gate run against real mutations of the real evidence
 * tree — are at `<EVIDENCE>/negative-cases/clause8-gate/`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ADR_0020, ASSERTION_ID, checkClause8Gate } from './check-clause8-gate.ts';

const REPO_ROOT = join(import.meta.dir, '..');
const EVIDENCE = 'specs/010-catalog-backstage/evidence';
const CORPUS = 'specs/010-catalog-backstage/corpus';

let sandbox: string;

/**
 * A copy of the real evidence tree, so mutations never touch the committed artifacts.
 *
 * Only what the gate reads is copied. `check:freeze-hashes` must stay green, and a test
 * that mutated the frozen tree in place would be the exact failure mode Barrier B exists
 * to prevent — so it is made structurally impossible here rather than remembered.
 */
beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'adrkit-clause8-'));

  for (const relative of [
    `${EVIDENCE}/frozen-expectations/audit-record.json`,
    `${EVIDENCE}/accept-corpus-freeze/adequacy-audit.json`,
    `${EVIDENCE}/accept-corpus-freeze/accept-corpus-freeze.json`,
    `${EVIDENCE}/comparison/step-b-record.json`,
    `${EVIDENCE}/comparison/expectations-unchanged.json`,
    `${CORPUS}/VENDOR-MANIFEST.json`,
    ADR_0020,
    'packages/adapters/catalog-backstage/package.json',
    'packages/catalog-envelope/package.json',
    'scripts/release-pack.ts',
  ]) {
    await cp(join(REPO_ROOT, relative), join(sandbox, relative), { recursive: true });
  }
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

async function mutateJson(
  relative: string,
  change: (value: Record<string, unknown>) => void,
): Promise<void> {
  const path = join(sandbox, relative);
  const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  change(value);
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

function requirements(findings: readonly { readonly requirement: string }[]): string[] {
  return findings.map((finding) => finding.requirement);
}

describe('the gate passes on the real evidence tree', () => {
  test('an unmutated copy yields no findings', () => {
    // If this ever fails, every negative test below is meaningless — they would all be
    // failing for a pre-existing reason rather than for the mutation.
    expect(checkClause8Gate(sandbox)).toEqual([]);
  });
});

describe('limb A — clause 5\u2019s evidence is complete and PASSing', () => {
  test('a non-zero false-negative count fails, naming the zero/zero requirement', async () => {
    await mutateJson(`${EVIDENCE}/comparison/step-b-record.json`, (value) => {
      (value['counts'] as Record<string, unknown>)['falseNegatives'] = 2;
    });
    const findings = checkClause8Gate(sandbox);
    expect(requirements(findings)).toContain('zero false positives and zero false negatives');
    expect(findings.some((finding) => finding.reason.includes('falseNegatives = 2'))).toBe(true);
  });

  test('a non-zero false-positive count fails the same way', async () => {
    await mutateJson(`${EVIDENCE}/comparison/step-b-record.json`, (value) => {
      (value['counts'] as Record<string, unknown>)['falsePositives'] = 1;
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'zero false positives and zero false negatives',
    );
  });

  test('step (b) inheriting step (a)\u2019s verdict fails the two-distinct-steps requirement', async () => {
    // FR-057 restating clause 5: "Neither may inherit the other's verdict."
    await mutateJson(`${EVIDENCE}/comparison/step-b-record.json`, (value) => {
      value['inheritsFromStepA'] = true;
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'two distinct steps, each recording its own hashes and its own PASS/FAIL',
    );
  });

  test('a FAILing step (a) audit fails, even with step (b) PASSing', async () => {
    // The direction that matters: step (b) passing does not rescue step (a).
    await mutateJson(`${EVIDENCE}/frozen-expectations/audit-record.json`, (value) => {
      value['overallVerdictThisRecord'] = 'FAIL';
    });
    const findings = checkClause8Gate(sandbox);
    expect(findings.some((finding) => finding.reason.startsWith('step (a):'))).toBe(true);
  });

  test('an empty envelope fails the populated-envelope requirement', async () => {
    await mutateJson(`${EVIDENCE}/comparison/step-b-record.json`, (value) => {
      (value['counts'] as Record<string, unknown>)['envelopeEntities'] = 0;
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'a populated, digest-verified SnapshotEnvelope',
    );
  });

  test('amended expectations fail, which is the circularity clause 5 forbids', async () => {
    await mutateJson(`${EVIDENCE}/comparison/expectations-unchanged.json`, (value) => {
      value['allUnchanged'] = false;
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'the expectations are never amended to fit the output',
    );
  });

  test('a recomputed frozen hash that does not match fails', async () => {
    await mutateJson(`${EVIDENCE}/comparison/step-b-record.json`, (value) => {
      const hashes = value['recomputedFrozenHashes'] as Record<string, Record<string, unknown>>;
      const first = Object.keys(hashes)[0] as string;
      (hashes[first] as Record<string, unknown>)['match'] = false;
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'the frozen artifacts still hash to what was frozen',
    );
  });

  test.each([
    ['absent', undefined],
    ['an empty object', {}],
    ['an array', []],
  ] as const)('recomputed frozen hashes %s fails rather than passing silently', async (_label, replacement) => {
    // The silent-absence class this gate exists to close. `Object.entries(undefined ?? {})`
    // iterates zero times, so a record that never recomputed anything would otherwise
    // satisfy this requirement identically to one that recomputed and matched.
    await mutateJson(`${EVIDENCE}/comparison/step-b-record.json`, (value) => {
      if (replacement === undefined) delete value['recomputedFrozenHashes'];
      else value['recomputedFrozenHashes'] = replacement;
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'the frozen artifacts still hash to what was frozen',
    );
  });

  test('recomputing only one of the two frozen artifacts fails', async () => {
    await mutateJson(`${EVIDENCE}/comparison/step-b-record.json`, (value) => {
      const hashes = value['recomputedFrozenHashes'] as Record<string, unknown>;
      delete hashes['accept-corpus-freeze/accept-corpus-freeze.json'];
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'the frozen artifacts still hash to what was frozen',
    );
  });

  test('a corpus at a different upstream ref than the freeze fails', async () => {
    await mutateJson(`${CORPUS}/VENDOR-MANIFEST.json`, (value) => {
      (value['corpusRef'] as Record<string, unknown>)['commit'] = '0'.repeat(40);
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'descriptors real and third-party-sourced, authored upstream and otherwise unmodified',
    );
  });

  test('BOTH sides missing an upstream ref fails, rather than trivially agreeing', async () => {
    // `undefined !== undefined` is false, so a comparison alone concludes the two agree on
    // a ref that neither records. Deleting it from one side was already caught; deleting
    // it from both was not.
    await mutateJson(`${CORPUS}/VENDOR-MANIFEST.json`, (value) => {
      delete value['corpusRef'];
    });
    await mutateJson(`${EVIDENCE}/accept-corpus-freeze/accept-corpus-freeze.json`, (value) => {
      delete value['corpusRef'];
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'descriptors real and third-party-sourced, authored upstream and otherwise unmodified',
    );
  });

  test('an all-annotation-absent corpus fails, per clause 5\u2019s own carve-out', async () => {
    // "A corpus in which every entity is annotation-absent does not satisfy it either,
    // because it yields a populated envelope while exercising none of the ownership
    // derivation."
    await mutateJson(`${EVIDENCE}/accept-corpus-freeze/accept-corpus-freeze.json`, (value) => {
      value['overlay'] = (value['overlay'] as Record<string, unknown>[]).map((entry) => ({
        ...entry,
        annotationValue: '[]',
      }));
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'at least one non-empty adrkit.io/owned-paths annotation',
    );
  });

  test('an audit that reaches integrity but not adequacy fails', async () => {
    // "an audit that passes on integrity without reaching adequacy does not satisfy this
    // clause."
    await mutateJson(`${EVIDENCE}/accept-corpus-freeze/adequacy-audit.json`, (value) => {
      delete value['requirement3_adequacyFinding'];
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'an explicit auditor finding that the corpus is adequate',
    );
  });

  test.each([
    ['an empty finding object', {}],
    ['a finding with no verdict', { reasoning: 'we looked at it' }],
    ['a finding that does not affirm adequacy', { finding: 'INADEQUATE for the claim' }],
  ] as const)('%s fails, because "not FAIL" is not the same as adequate', async (_label, replacement) => {
    // The clause requires a finding *that the corpus is adequate* — an affirmative
    // statement. A check that only rejected a literal FAIL would let `{}` through.
    await mutateJson(`${EVIDENCE}/accept-corpus-freeze/adequacy-audit.json`, (value) => {
      value['requirement3_adequacyFinding'] = replacement;
    });
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'an explicit auditor finding that the corpus is adequate',
    );
  });

  test('a missing evidence artifact fails rather than being treated as satisfied', async () => {
    // The silent-absence trap: nothing to read must not read as nothing wrong.
    await rm(join(sandbox, `${EVIDENCE}/comparison/step-b-record.json`));
    const findings = checkClause8Gate(sandbox);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((finding) => finding.reason.includes('absent'))).toBe(true);
  });
});

describe('limb B — nothing claims release or ADR-0014 rung 2 (clause 9)', () => {
  test('a real version on the adapter fails', async () => {
    await mutateJson('packages/adapters/catalog-backstage/package.json', (value) => {
      value['version'] = '0.1.0';
    });
    const findings = checkClause8Gate(sandbox);
    expect(findings.some((finding) => finding.reason.includes('0.1.0'))).toBe(true);
  });

  test('a real version on the consumer fails too', async () => {
    await mutateJson('packages/catalog-envelope/package.json', (value) => {
      value['version'] = '1.0.0';
    });
    const findings = checkClause8Gate(sandbox);
    expect(findings.some((finding) => finding.reason.includes('1.0.0'))).toBe(true);
  });

  test('adding either package to RELEASE_PACKAGES fails', async () => {
    const path = join(sandbox, 'scripts', 'release-pack.ts');
    const source = await readFile(path, 'utf8');
    await writeFile(
      path,
      source.replace(
        /RELEASE_PACKAGES([^=]*)=\s*\[/u,
        "RELEASE_PACKAGES$1= [\n  '@adrkit/catalog-backstage',",
      ),
      'utf8',
    );
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      'no release is scheduled, implied, or prepared (clause 9)',
    );
  });
});

describe('the gate does not cite the inert assertion as enforcement', () => {
  test('ADR-0020 still declares the assertion, and still declares it `engine: custom`', () => {
    // Clause 8: the assertion "records the rule; it does not enforce it." If an engine
    // were registered the assertion might become live, and this gate's description of it
    // as inert would be wrong — so the condition is checked, not assumed.
    expect(checkClause8Gate(sandbox)).toEqual([]);
  });

  test('a removed assertion fails, because the rule this gate compiles from would be gone', async () => {
    const path = join(sandbox, ADR_0020);
    const text = await readFile(path, 'utf8');
    await writeFile(path, text.replaceAll(ASSERTION_ID, 'some-other-assertion'), 'utf8');
    expect(requirements(checkClause8Gate(sandbox))).toContain('clause 8 compiles from ADR-0020');
  });

  test('an engine change fails, so "inert" is never claimed once it stops being true', async () => {
    const path = join(sandbox, ADR_0020);
    const text = await readFile(path, 'utf8');
    await writeFile(path, text.replace(/^(\s*)engine:\s*custom\s*$/mu, '$1engine: cel'), 'utf8');
    expect(requirements(checkClause8Gate(sandbox))).toContain(
      "clause 8's assertion is inert and this gate is the enforcement",
    );
  });
});
