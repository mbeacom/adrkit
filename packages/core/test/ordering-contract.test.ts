/**
 * #115 — `CheckOutcome` promises "identical `(lint, changedFiles, snapshots,
 * markerScans)` produces identical output", and the arrays it carries serialize
 * into `adr check --json`, which `@adrkit/ci` consumes. `localeCompare` orders
 * by the runtime's ICU locale, so two environments could produce different
 * bytes from identical inputs. Every sort on that path must therefore use
 * `compareCodeUnits` (`packages/core/src/ordering/index.ts:12`).
 *
 * The expected orderings below are derived from the comparator's definition —
 * `a < b ? -1 : a > b ? 1 : 0` over UTF-16 code units.
 *
 * ## What this file deliberately does not scan
 *
 * `packages/core/src/affects/**` still contains three `localeCompare` sorts
 * that reach `CheckOutcome` (`compareFiredMatcher`, the match `recordId` sort,
 * and the changed-dependency sort in `matchers/package.ts`). That tree is
 * pinned byte-identical by feature 010's FR-004 guard
 * (`packages/catalog-envelope/test/no-core-schema-change.test.ts`), which names
 * any change there a violation and routes legitimate changes to
 * separately-authorized later work. Those sites stay recorded on #115 until the
 * freeze lifts; scanning them here would only force one guard to break another.
 *
 * That exclusion is load-bearing for how this suite's name should be read:
 * `affects/index.ts`'s `matches.sort((a, b) => a.recordId.localeCompare(...))`
 * is a *total* re-sort of the resolver's output, so for distinct record ids it
 * is the frozen sort — not any scanned module — that fixes `governedBy` order.
 * A clean run of this file therefore means "no scanned module reaches for
 * `localeCompare`", not "`check --json` is locale-independent end to end".
 * The second claim is only true once #115's `affects/**` remainder lands.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkChanges, type CheckLintResult } from '../src/check/index.ts';
import {
  discoverAdrFiles,
  discoverSkippedMarkdownFiles,
  expandRecordInputs,
} from '../src/load/corpus.ts';
import { compareCodeUnits } from '../src/ordering/index.ts';
import { lintCorpus } from '../src/validate/index.ts';
import { sortFindings, type Finding } from '../src/validate/findings.ts';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from './helpers.ts';

const emptyLint = (findings: Finding[] = []): CheckLintResult => ({ records: [], findings, checked: 0 });

/** The #115 repro set: names a locale-aware comparison interleaves differently. */
const HOSTILE_FILES = ['src/a_b.ts', 'src/a-b.ts', 'src/a.ts', 'src/A.ts', 'src/ab.ts', 'src/aB.ts'];
const CODE_UNIT_ORDER = ['src/A.ts', 'src/a-b.ts', 'src/a.ts', 'src/aB.ts', 'src/a_b.ts', 'src/ab.ts'];

describe('checkChanges orders changedFiles by code unit, not by locale', () => {
  test('the #115 repro set comes back in code-unit order', () => {
    const outcome = checkChanges({ lint: emptyLint(), changedFiles: HOSTILE_FILES });
    expect(outcome.changedFiles).toEqual(CODE_UNIT_ORDER);
    expect(outcome.changedFiles).toEqual([...HOSTILE_FILES].sort(compareCodeUnits));
  });

  test('the case that separates the two comparators', () => {
    // Every uppercase ASCII letter sorts before every lowercase one by code unit
    // ('Z' is 0x5A, 'a' is 0x61); a locale-aware comparison typically interleaves.
    expect('B'.localeCompare('a')).toBeGreaterThan(0);
    expect(compareCodeUnits('B', 'a')).toBeLessThan(0);

    const outcome = checkChanges({ lint: emptyLint(), changedFiles: ['src/a.ts', 'src/B.ts'] });
    expect(outcome.changedFiles).toEqual(['src/B.ts', 'src/a.ts']);
  });

  test('input order never affects the output', () => {
    const reversed = checkChanges({ lint: emptyLint(), changedFiles: [...HOSTILE_FILES].reverse() });
    expect(reversed.changedFiles).toEqual(CODE_UNIT_ORDER);
  });
});

describe('sortFindings orders every tuple field by code unit', () => {
  const finding = (rule: string, message = 'm'): Finding => ({ rule, severity: 'warn', message });

  test('rules differing only in case sort by code unit', () => {
    const sorted = sortFindings([finding('affects-bad'), finding('Affects-bad')]);
    expect(sorted.map((f) => f.rule)).toEqual(['Affects-bad', 'affects-bad']);
  });

  test('the message tiebreak is code-unit too', () => {
    const sorted = sortFindings([finding('r', 'a_b'), finding('r', 'a-b'), finding('r', 'ab')]);
    expect(sorted.map((f) => f.message)).toEqual(['a-b', 'a_b', 'ab']);
  });

  test('an absent optional field still sorts before any present value', () => {
    const withId: Finding = { ...finding('r'), id: '0001' };
    const sorted = sortFindings([withId, finding('r')]);
    expect(sorted.map((f) => f.id)).toEqual([undefined, '0001']);
  });
});

describe('no scanned module on the check --json path reaches for localeCompare', () => {
  // The same source-scan shape as the adapter's
  // `test/glob-order.test.ts` guard, widened to every core module that feeds
  // `CheckOutcome`: `check/`, `load/`, `markers/`, `ordering/`, and `validate/`.
  // These are scanned as whole directories rather than as a file allowlist, so a
  // new module added to any of them is covered the day it lands — an allowlist
  // silently exempts new files, which is how `validate/index.ts` stayed unscanned
  // while `validate/findings.ts` was named individually. See the header for why
  // `affects/` is excluded.
  const SCANNED_DIRS = ['src/check', 'src/load', 'src/markers', 'src/ordering', 'src/validate'];

  function tsFilesUnder(relativeDir: string): string[] {
    const root = join(import.meta.dir, '..', relativeDir);
    const found: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const next = `${prefix}${entry.name}`;
        if (entry.isDirectory()) walk(join(dir, entry.name), `${next}/`);
        else if (entry.name.endsWith('.ts')) found.push(`${relativeDir}/${next}`);
      }
    };
    walk(root, '');
    return found;
  }

  const scanned = SCANNED_DIRS.flatMap(tsFilesUnder);

  test('the scan examined a non-trivial module list', () => {
    // Report what was examined, not only what was concluded (ADR-0016 clause 3):
    // an empty walk would make the per-file assertions below vacuous.
    expect(scanned.length).toBeGreaterThanOrEqual(8);
    expect(scanned).toContain('src/check/index.ts');
    expect(scanned).toContain('src/load/corpus.ts');
    expect(scanned).toContain('src/markers/resolve.ts');
    expect(scanned).toContain('src/validate/findings.ts');
    // `lintCorpus` lives here and produces the `records` `checkChanges` reads, so
    // its absence from the scan was the gap the directory walk closes.
    expect(scanned).toContain('src/validate/index.ts');
  });

  for (const file of scanned) {
    test(`${file} sorts with compareCodeUnits only`, () => {
      const source = readFileSync(join(import.meta.dir, '..', file), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
      expect(code).not.toContain('localeCompare');
    });
  }
});

/**
 * `load/corpus.ts`'s discovery order is not display polish. It survives into
 * `lintCorpus`'s `records` whenever two records share an id — the `frontmatter.id`
 * tiebreak is a no-op for equal ids over a stable sort — and `checkChanges` reads
 * whichever duplicate landed *later* as that id's canonical record
 * (`toGoverningDecisions`'s `byId` map is last-write-wins). Under `localeCompare`
 * that made `governing` / `activeProposals` / `governedBy` a function of the
 * runtime's ICU locale for byte-identical corpus files.
 */
describe('corpus discovery orders by code unit, not by locale', () => {
  const DIR_NAME = 'ordering-contract-corpus';
  const CORPUS = 'docs/adr';
  const MATCHER = ['affects:', '  - type: path', '    pattern: "src/**"'].join('\n');

  /**
   * The pair that separates the comparators without depending on filesystem case
   * sensitivity: 'Z' (0x5A) sorts before 'a' (0x61) by code unit, while a locale-aware
   * comparison puts 'alpha' first. A case-only pair (`0001-A…` / `0001-a…`) cannot be
   * used — macOS's default case-insensitive filesystem collapses it to one file.
   */
  const FIRST = '0001-Zeta-duplicate.md';
  const LAST = '0001-alpha-duplicate.md';

  afterEach(async () => {
    await cleanupTestDir(DIR_NAME);
  });

  /**
   * Two schema-valid records that share id `0001` and the same matcher, differing
   * only in filename and status. Whichever one discovery yields last decides
   * the bucket every match lands in.
   */
  async function seedDuplicateIds(): Promise<string> {
    const root = await resetTestDir(DIR_NAME);
    const withMatcher = (markdown: string): string => markdown.replace('affects: []', MATCHER);
    await writeText(
      join(root, CORPUS, FIRST),
      withMatcher(recordMarkdown('0001', 'Zeta duplicate'))
        .replace('status: draft', 'status: accepted')
        .replace('deciders: []', 'deciders: ["@tester"]'),
    );
    await writeText(join(root, CORPUS, LAST), withMatcher(recordMarkdown('0001', 'Alpha duplicate')));
    return root;
  }

  test('the case that separates the two comparators, at the filename level', () => {
    expect(FIRST.localeCompare(LAST)).toBeGreaterThan(0);
    expect(compareCodeUnits(FIRST, LAST)).toBeLessThan(0);
  });

  test('discovery yields code-unit order regardless of readdir order', async () => {
    const root = await seedDuplicateIds();
    const files = await discoverAdrFiles(CORPUS, root);
    expect(files.map((file) => file.slice(root.length + 1))).toEqual([
      `${CORPUS}/${FIRST}`,
      `${CORPUS}/${LAST}`,
    ]);
  });

  test('expandRecordInputs is order-invariant and code-unit ordered', async () => {
    const root = await seedDuplicateIds();
    const forward = await expandRecordInputs([join(root, CORPUS, FIRST), join(root, CORPUS, LAST)], CORPUS, root);
    const reversed = await expandRecordInputs([join(root, CORPUS, LAST), join(root, CORPUS, FIRST)], CORPUS, root);
    expect(forward).toEqual(reversed);
    expect(forward.map((file) => file.slice(root.length + 1))).toEqual([
      `${CORPUS}/${FIRST}`,
      `${CORPUS}/${LAST}`,
    ]);
  });

  test('skipped-markdown reporting is code-unit ordered too', async () => {
    const root = await resetTestDir(DIR_NAME);
    // Misnamed, so discovery skips them — the `corpus-file-skipped` warning list.
    for (const name of ['a_b.md', 'a-b.md', 'ab.md', 'Z.md', 'a.md']) {
      await writeText(join(root, CORPUS, name), '# not a record\n');
    }
    const skipped = await discoverSkippedMarkdownFiles(CORPUS, root);
    const names = skipped.map((file) => file.path.slice(join(root, CORPUS).length + 1));
    // localeCompare yields `a_b.md a-b.md a.md ab.md Z.md` for the same set.
    expect(names).toEqual(['Z.md', 'a-b.md', 'a.md', 'a_b.md', 'ab.md']);
    expect(names).toEqual([...names].sort(compareCodeUnits));
  });

  /**
   * `lintCorpus`'s own `records` sort, distinct from discovery order. Ids may be
   * mixed-case ULIDs (`^([0-9]{4,}|[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})$`), so this
   * comparison separates the comparators for *distinct* ids — the case the
   * duplicate-id test above cannot reach, because there the comparison returns 0.
   */
  test('lintCorpus orders distinct record ids by code unit', async () => {
    const root = await resetTestDir(DIR_NAME);
    const upper = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const lower = '01arz3ndektsv4rrffq69g5fav';
    expect(upper.localeCompare(lower)).toBeGreaterThan(0);
    expect(compareCodeUnits(upper, lower)).toBeLessThan(0);

    // Filenames are numeric so discovery order cannot supply the answer; only the
    // id sort can decide which record comes first.
    await writeText(join(root, CORPUS, `0001-${upper}.md`), recordMarkdown(upper, 'Upper ULID record'));
    await writeText(join(root, CORPUS, `0002-${lower}.md`), recordMarkdown(lower, 'Lower ULID record'));

    const lint = await lintCorpus({ dir: CORPUS, cwd: root });
    expect(lint.records.map((record) => record.frontmatter.id)).toEqual([upper, lower]);
  });

  test('a duplicate id resolves to the same governing decision in either input order', async () => {
    const root = await seedDuplicateIds();
    const first = join(root, CORPUS, FIRST);
    const last = join(root, CORPUS, LAST);

    const forward = await lintCorpus({ dir: CORPUS, cwd: root, paths: [first, last] });
    const reversed = await lintCorpus({ dir: CORPUS, cwd: root, paths: [last, first] });
    const discovered = await lintCorpus({ dir: CORPUS, cwd: root });

    // Both files are schema-valid, so both survive into `records` (with a
    // `unique-id` error alongside) and the id tiebreak cannot separate them.
    for (const lint of [forward, reversed, discovered]) {
      expect(lint.records.map((record) => record.path)).toEqual([
        `${CORPUS}/${FIRST}`,
        `${CORPUS}/${LAST}`,
      ]);
    }

    const outcomes = [forward, reversed, discovered].map((lint) =>
      checkChanges({ lint, changedFiles: ['src/app.ts'], dir: CORPUS }),
    );
    for (const outcome of outcomes) expect(outcome).toEqual(outcomes[0] as never);

    // `0001-alpha-duplicate.md` is discovered last, so it is the canonical `0001` — a
    // draft, which never governs. Under `localeCompare` the accepted record landed
    // last instead and `governing` was non-empty, flipping on collation alone.
    const [outcome] = outcomes as [ReturnType<typeof checkChanges>];
    expect(outcome.governing).toEqual([]);
    expect(outcome.activeProposals.map((decision) => decision.title)).toEqual([
      'Alpha duplicate',
      'Alpha duplicate',
    ]);
  });
});
