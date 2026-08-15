/**
 * T099 / FR-059 — checks on the observed-failing register.
 *
 * # A register nobody checks is worse than no register
 *
 * `evidence/observed-failing-register.md` reads as an audit: it claims that every check
 * feature 010 introduced was observed failing, and names where each observation lives. If
 * it drifted from the tree — a directory deleted, a row referring to nothing, a case added
 * with no row — it would keep making that claim while it stopped being true, and a reader
 * would have no way to tell.
 *
 * So the mapping is asserted **in both directions**:
 *
 * - every row names a directory that exists (no phantom evidence);
 * - every directory has a row (no unlisted evidence, and therefore no check quietly
 *   sitting in the passing column).
 *
 * The second direction is the one that discharges FR-059. The first only catches rot.
 *
 * # And every case is checked for being a real one
 *
 * A directory that exists but contains no failing output would satisfy the mapping while
 * evidencing nothing. Each is therefore checked for a retained input, captured output, and
 * a recorded reason string — in whichever of the two sanctioned shapes it uses.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');
const EVIDENCE = join(REPO_ROOT, 'specs', '010-catalog-backstage', 'evidence');
const CASES_DIR = join(EVIDENCE, 'negative-cases');
const REGISTER = join(EVIDENCE, 'observed-failing-register.md');

const register = readFileSync(REGISTER, 'utf8');

/** Every negative-case subdirectory on disk. */
const directories = readdirSync(CASES_DIR)
  .filter((entry) => statSync(join(CASES_DIR, entry)).isDirectory())
  .sort();

/**
 * Cases that retain an **isolated broken artifact** rather than a patch of live source.
 *
 * These have no `restored.observed.txt` and correctly should not: nothing was ever mutated
 * in place, so there is nothing to restore. Listed explicitly rather than inferred from
 * the absence of a file, because "no restored file" would otherwise be indistinguishable
 * from "forgot to record the restore".
 */
const ISOLATED_ARTIFACT_CASES: readonly string[] = [
  'audit-integrity-only',
  'freeze-drift',
  'oracle-input-order',
];

/** Cases whose failing output is recorded inline in the README rather than as a file. */
const INLINE_OUTPUT_CASES: readonly string[] = [
  'audit-integrity-only',
  'freeze-drift',
  'oracle-input-order',
];

/**
 * Cases whose retained failing input is a **named constant in source** rather than a file.
 *
 * `comparison-mismatch/` is the one: the mutation lives as `T089_MUTATION` in
 * `scripts/compare-accept-corpus.ts`, so the retained artifact is a line of code that the
 * test suite drives on every run. That is a stronger retention than a patch — a patch can
 * rot silently, a constant the suite exercises cannot — but it means the directory holds
 * no input file, and the checker has to know that rather than fail on it.
 */
const CODE_CONSTANT_CASES: readonly string[] = ['comparison-mismatch'];

/** Where each code-constant case's retained mutation actually lives. */
const CODE_CONSTANT_SOURCES: Readonly<Record<string, { readonly file: string; readonly symbol: string }>> = {
  'comparison-mismatch': { file: 'scripts/compare-accept-corpus.ts', symbol: 'T089_MUTATION' },
};

/**
 * Captures that deliberately record a **pass** rather than a failure.
 *
 * Normally a case's non-restored capture must show a failure, or the directory would
 * satisfy every structural check while evidencing nothing. `honesty-close-out/` case 2 is
 * the one deliberate exception: its entire point is that the *same vocabulary* which fails
 * as a claim stays **green** as a denial. A pass is the evidence there, and demanding a
 * failure would force the case to be written dishonestly.
 *
 * Named explicitly, with its file, so the exception cannot silently widen.
 */
const DELIBERATE_PASS_CAPTURES: Readonly<Record<string, readonly string[]>> = {
  'honesty-close-out': ['case-2-the-same-terms-as-denials.observed.txt'],
  // T093's positive verification: a full clean-clone run, all green. It is the
  // evidence FOR the claim, not a failing observation, and lives beside the three
  // failing cases in the same directory.
  'clean-clone-offline': ['clean-clone-verification.observed.txt'],
};

function files(directory: string): string[] {
  return readdirSync(join(CASES_DIR, directory), { recursive: true }).map(String);
}

/**
 * The negative-case directory named by each **table row** of the register.
 *
 * Rows, not the whole document. `register.includes('`name/`')` was satisfied by any
 * mention anywhere — so deleting a row left the directory "covered" by a narrative
 * sentence such as "see `spike-heuristic/`", and §3 and §4 are full of exactly those.
 * The register's claim is that every case is *accounted for in the table*; prose is not
 * that, and a check that accepted prose was not checking the claim.
 */
const registerRowDirectories: readonly string[] = [
  ...new Set(
    register
      .split('\n')
      .filter((line) => line.trimStart().startsWith('|'))
      .flatMap((row) => [...row.matchAll(/`([a-z0-9-]+)\/`/gu)].map((match) => match[1] as string)),
  ),
].sort();

describe('the register maps to the tree, in both directions', () => {
  test('there are negative cases to enumerate at all', () => {
    // A guard on the guard: if the tree were empty, every assertion below would pass
    // vacuously and this file would report green on nothing.
    expect(directories.length).toBeGreaterThan(30);
  });

  test('the rows parse at all, so neither direction below is vacuous', () => {
    // If the table format changed and nothing matched, "every row exists" would pass on an
    // empty set and "every directory has a row" would fail confusingly. Fail here instead.
    expect(registerRowDirectories.length).toBeGreaterThan(30);
  });

  test('every directory on disk is named by a register ROW, not merely mentioned', () => {
    // The FR-059 direction. An unlisted case means a check whose observation exists but
    // that the close-out does not account for — or, read the other way, a check the
    // register has silently left in the passing column.
    const missing = directories.filter((directory) => !registerRowDirectories.includes(directory));
    expect(missing).toEqual([]);
  });

  test('every directory the register names exists on disk', () => {
    const named = [...register.matchAll(/`([a-z0-9-]+)\/`/gu)].map((match) => match[1] as string);
    expect(named.length).toBeGreaterThan(0);

    const phantom = [...new Set(named)].filter((name) => !directories.includes(name));
    expect(phantom).toEqual([]);
  });
});

describe('every retained case is a real one', () => {
  test.each(directories)('%s carries a README', (directory) => {
    expect(files(directory)).toContain('README.md');
  });

  test.each(directories)('%s retains the failing input', (directory) => {
    const entries = files(directory);

    if (CODE_CONSTANT_CASES.includes(directory)) {
      // Shape 3: the mutation is a named constant the suite drives. Assert it is really
      // there, so "retained in code" cannot become a way of retaining nothing.
      const where = CODE_CONSTANT_SOURCES[directory];
      expect(where).toBeDefined();
      if (where === undefined) return;
      const source = readFileSync(join(REPO_ROOT, where.file), 'utf8');
      expect(source).toContain(where.symbol);
      return;
    }

    // Shape 1: a patch of live source. Shape 2: a committed broken artifact — which may
    // be a directory, a `.json`, or a `.txt`, and whose name may itself contain
    // "observed" (`freeze-drift/observed-fail.json`). Only `*.observed.txt` is captured
    // *output* rather than retained *input*, so that is the only suffix excluded here.
    const patches = entries.filter((entry) => entry.endsWith('.patch'));
    const artifacts = entries.filter(
      (entry) =>
        entry !== 'README.md' && !entry.endsWith('.patch') && !entry.endsWith('.observed.txt'),
    );
    expect(patches.length + artifacts.length).toBeGreaterThan(0);
  });

  test.each(directories)('%s records the output that was observed', (directory) => {
    const entries = files(directory);
    const captured = entries.filter((entry) => entry.includes('observed'));

    if (INLINE_OUTPUT_CASES.includes(directory)) {
      // Recorded verbatim in the README, inside a fenced block.
      const readme = readFileSync(join(CASES_DIR, directory, 'README.md'), 'utf8');
      expect(readme).toContain('```');
      expect(readme).toMatch(/verbatim|Observed reason string/iu);
      return;
    }
    expect(captured.length).toBeGreaterThan(0);
  });

  test.each(directories)('%s shows the restored pass, or is an isolated artifact', (directory) => {
    const entries = files(directory);
    if (ISOLATED_ARTIFACT_CASES.includes(directory)) {
      // Nothing was mutated in place; a restored capture would have to be fabricated.
      expect(entries).not.toContain('restored.observed.txt');
      return;
    }
    expect(entries).toContain('restored.observed.txt');
  });

  test.each(directories.filter((one) => !INLINE_OUTPUT_CASES.includes(one)))(
    '%s captured an output that actually records a failure',
    (directory) => {
      // A directory whose captured output shows only passes would satisfy every
      // structural check above while evidencing nothing.
      const deliberatePasses = DELIBERATE_PASS_CAPTURES[directory] ?? [];
      const failing = files(directory)
        .filter(
          (entry) =>
            entry.includes('observed') &&
            entry !== 'restored.observed.txt' &&
            !deliberatePasses.includes(entry),
        )
        .map((entry) => readFileSync(join(CASES_DIR, directory, entry), 'utf8'));

      expect(failing.length).toBeGreaterThan(0);
      expect(
        failing.some(
          (text) =>
            text.includes('(fail)') ||
            text.includes('FAIL') ||
            text.includes('error:') ||
            /exit=[1-9]/u.test(text),
        ),
      ).toBe(true);
    },
  );

  test('every deliberate pass-capture really exists, and really records a pass', () => {
    // The exception must not become a way to list a file that is missing or that
    // quietly started failing.
    for (const [directory, captures] of Object.entries(DELIBERATE_PASS_CAPTURES)) {
      expect(directories).toContain(directory);
      for (const capture of captures) {
        expect(files(directory)).toContain(capture);
        const text = readFileSync(join(CASES_DIR, directory, capture), 'utf8');
        expect(text).not.toContain('(fail)');
        // Anchored on the count, not on a substring: `toContain('0 fail')` is satisfied by
        // `10 fail`, so a capture recording ten or more failures was accepted as evidence
        // of a pass by the guard whose whole job is to reject exactly that.
        expect(text, `${directory}/${capture}`).toMatch(/(^|\s)0 fail\b/mu);
        expect(text, `${directory}/${capture}`).not.toMatch(/(^|\s)(?!0\b)\d+ fail\b/mu);
      }
    }
  });

  test.each(directories.filter((one) => !ISOLATED_ARTIFACT_CASES.includes(one)))(
    '%s restored capture shows a pass',
    (directory) => {
      const text = readFileSync(join(CASES_DIR, directory, 'restored.observed.txt'), 'utf8');
      expect(text).not.toContain('(fail)');
      // `\b1 fail\b|\b[2-9] fail\b` did not match `10 fail` — there is no word boundary
      // between `1` and `0` — so a double-digit failure count read as a restored pass.
      expect(text, `${directory}/restored.observed.txt`).not.toMatch(/(^|\s)(?!0\b)\d+ fail\b/mu);
    },
  );
});

describe('the register records the two ADR-0012 gate outcomes as required', () => {
  // Matched against whitespace-normalized text. The register is hard-wrapped, so the line
  // breaks fall mid-sentence; matching literal newlines would fail on a reflow that
  // changed no words. Same lesson as `sc-016.test.ts`'s citation check.
  const flat = register.replaceAll(/\s+/gu, ' ');

  test('gate 3 is recorded as observed, never claimed in advance', () => {
    expect(flat).toContain('recorded as observed, never claimed in advance');
    expect(flat).toContain('possible outcome');
    // It must not declare the gate closed — that is ADR-0012's to do, on its own record.
    expect(flat).toContain('does **not** declare gate 3 closed');
    expect(flat).not.toMatch(/\bgate 3 is (?:now )?(?:closed|satisfied|met)\b/iu);
  });

  test('gate 4 is recorded unmet and not yet testable, never passed and never failed', () => {
    expect(flat).toContain('unmet and not yet testable');
    expect(flat).toContain('never as passed, and never as failed');
    // The carried clarification is named, not silently resolved.
    expect(flat).toContain('NEEDS CLARIFICATION');
    expect(flat).toContain('carried forward unresolved');
    expect(flat).not.toMatch(/\bgate 4 (?:is|has been) (?:passed|met|satisfied)\b/iu);
  });
});

describe('the register reports gaps rather than hiding them', () => {
  const flat = register.replaceAll(/\s+/gu, ' ');

  test('it carries a gaps section', () => {
    expect(flat).toContain('Gaps, reported rather than closed');
  });

  test('T096 having no directory is stated, not omitted', () => {
    // The one check with no retained directory. Left unstated, a reader counting
    // directories against tasks would conclude one had been lost.
    expect(flat).toContain('T096 has no negative-case directory');
    expect(flat).toContain('cross-package-envelope.test.ts');
  });

  test('the Linux denial path records how it was settled, not merely that it was', () => {
    // This assertion previously required the register to state the path as *unobserved*,
    // which was true when written and is no longer. It is replaced rather than deleted,
    // and deliberately not weakened to "mentions Linux": the register has to name the run
    // that settled it, so the claim stays checkable against something outside this repo.
    expect(flat).toContain('observed succeeding on the CI runner itself');
    expect(flat).toMatch(/actions\/runs\/\d+/u);
    // And it must still say the prediction failed five times, so the resolution cannot be
    // written up as though it had gone smoothly.
    expect(flat).toContain('failed on every run of this branch');
  });

  test('the host-provenance gap is reported rather than backfilled', () => {
    // The generalisation of the defect that caused all of the above: an observed failure
    // is evidence about the environment it was observed in. Most cases do not record one.
    // Stating that is the honest move; inventing host strings for unrepeatable runs is not.
    expect(flat).toContain('2 name the host');
    expect(flat).toContain('manufacture provenance');
  });

  test('all three retention shapes are documented, not just the two that are common', () => {
    // The checker knows about a code-constant shape; the register must say so, or the
    // two would drift and the exception would look like an oversight.
    expect(flat).toContain('T089_MUTATION');
  });
});

describe('the register claims no rung it has not earned', () => {
  const flat = register.replaceAll(/\s+/gu, ' ');

  test('ADR-0014 rung 1 only, stated', () => {
    expect(flat).toContain('ADR-0014 rung 1 only');
  });

  test('no release is claimed, scheduled, or prepared', () => {
    expect(flat).toContain('No release is scheduled, implied, or prepared');
  });
});
