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
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { deriveChangedDependenciesFromBunLockDiff } from '../src/affects/index.ts';
import { checkChanges, type CheckLintResult } from '../src/check/index.ts';
import {
  discoverAdrFiles,
  discoverSkippedMarkdownFiles,
  expandRecordInputs,
} from '../src/load/corpus.ts';
import { compareCodeUnits } from '../src/ordering/index.ts';
import { AdrFrontmatter, type Adr } from '../src/schema/adr.schema.ts';
import { lintCorpus } from '../src/validate/index.ts';
import { sortFindings, type Finding } from '../src/validate/findings.ts';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from './helpers.ts';

const emptyLint = (findings: Finding[] = []): CheckLintResult => ({ records: [], findings, checked: 0 });

/** The #115 repro set: names a locale-aware comparison interleaves differently. */
const HOSTILE_FILES = ['src/a_b.ts', 'src/a-b.ts', 'src/a.ts', 'src/A.ts', 'src/ab.ts', 'src/aB.ts'];
const CODE_UNIT_ORDER = ['src/A.ts', 'src/a-b.ts', 'src/a.ts', 'src/aB.ts', 'src/a_b.ts', 'src/ab.ts'];
const UPPER_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const LOWER_ULID = '01arz3ndektsv4rrffq69g5fav';

function affectsRecord(id: string, affects: Record<string, unknown>[]): Adr {
  return {
    frontmatter: AdrFrontmatter.parse({
      schemaVersion: '0.1.0',
      id,
      title: `Ordering record ${id}`,
      status: 'draft',
      date: '2026-08-27',
      deciders: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      affects,
      provenance: { authoredBy: 'human' },
    }),
    body: '',
    path: `docs/adr/${id}-ordering.md`,
  };
}

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

describe('affects output orders every serialized tuple by code unit', () => {
  const HOSTILE_AFFECTS = [
    { type: 'path', pattern: 'src/**' },
    { type: 'package', pattern: 'a' },
    { type: 'package', pattern: 'B' },
  ];
  const SNAPSHOTS = {
    changedDependencies: [
      { name: 'a', version: '1.0.0' },
      { name: 'B', version: '1.0.0' },
    ],
  };

  test('checkChanges is byte-identical across record input orders', () => {
    const upper = affectsRecord(UPPER_ULID, HOSTILE_AFFECTS);
    const lower = affectsRecord(LOWER_ULID, HOSTILE_AFFECTS);
    const outcomes = [
      checkChanges({
        lint: { records: [lower, upper], findings: [], checked: 2 },
        changedFiles: ['src/app.ts', 'bun.lock'],
        snapshots: SNAPSHOTS,
      }),
      checkChanges({
        lint: { records: [upper, lower], findings: [], checked: 2 },
        changedFiles: ['bun.lock', 'src/app.ts'],
        snapshots: SNAPSHOTS,
      }),
    ];

    expect(JSON.stringify(outcomes[0])).toBe(JSON.stringify(outcomes[1]));
    expect(outcomes[0]?.governedBy.map((decision) => decision.recordId)).toEqual([
      UPPER_ULID,
      LOWER_ULID,
    ]);
    for (const decision of outcomes[0]?.governedBy ?? []) {
      expect(decision.firedMatchers).toEqual([
        { type: 'package', pattern: 'B' },
        { type: 'package', pattern: 'a' },
        { type: 'path', pattern: 'src/**' },
      ]);
    }
  });

  test('lockfile dependencies order names and versions by code unit', () => {
    const diff = [
      'diff --git a/bun.lock b/bun.lock',
      '@@',
      '+    "a": ["a@1.0.0", "", {}, "sha512-a"],',
      '+    "B": ["B@1.0.0", "", {}, "sha512-b"],',
      '-    "pkg": ["pkg@1.0.0-a", "", {}, "sha512-old"],',
      '+    "pkg": ["pkg@1.0.0-B", "", {}, "sha512-new"],',
    ].join('\n');

    expect(deriveChangedDependenciesFromBunLockDiff(diff)).toEqual([
      { name: 'B', version: '1.0.0' },
      { name: 'a', version: '1.0.0' },
      { name: 'pkg', version: '1.0.0-B' },
      { name: 'pkg', version: '1.0.0-a' },
    ]);
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

describe('no scanned module on a serialized-output path reaches for localeCompare', () => {
  // The same source-scan shape as the adapter's `test/glob-order.test.ts` guard,
  // widened to every core module that feeds `CheckOutcome`.
  // `queue/` is scanned for the same reason on its own contract rather than on
  // `CheckOutcome`'s: QueueReport v1 promises byte-for-byte identical output for
  // identical inputs (007-arb-queue SC-001), which a locale-dependent sort would
  // break as a difference between machines.
  //
  // `graph/` is deliberately NOT scanned.
  // `buildAdrGraph` still orders nodes and edges with `localeCompare`, and
  // ADR-0033 clause 8 pins that: "The graph JSON shape remains exactly
  // `{ nodes, edges }`, with existing node and edge fields, **historical locale
  // ordering**, and missing-target omission unchanged." Migrating it is a change
  // to an accepted decision, not a defect fix, so it is recorded on #115 rather
  // than made here. `scripts/emit-manifest.ts` does not depend on that order: it
  // re-sorts the nodes it reads with `compareCodeUnits` before rendering, so the
  // `MANIFEST.md` no-diff gate is locale-independent regardless of how this
  // resolves.
  // These are scanned as whole directories rather than as a file allowlist, so a
  // new module added to any of them is covered the day it lands — an allowlist
  // silently exempts new files, which is how `validate/index.ts` stayed unscanned
  // while `validate/findings.ts` was named individually.
  const SCANNED_DIRS = [
    'src/affects',
    'src/check',
    'src/load',
    'src/markers',
    'src/ordering',
    'src/queue',
    'src/validate',
  ];

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

  function executableLocaleCompareUses(source: string, file: string): string[] {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const uses: string[] = [];
    const visit = (node: ts.Node): void => {
      const isIdentifier = ts.isIdentifier(node) && node.text === 'localeCompare';
      const isComputedProperty =
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'localeCompare';
      if (isIdentifier || isComputedProperty) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        uses.push(`${file}:${line + 1}:${character + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return uses;
  }

  test('the scan examined a non-trivial module list', () => {
    // Report what was examined, not only what was concluded (ADR-0016 clause 3):
    // an empty walk would make the per-file assertions below vacuous.
    expect(scanned.length).toBeGreaterThanOrEqual(8);
    expect(scanned).toContain('src/affects/index.ts');
    expect(scanned).toContain('src/affects/matchers/package.ts');
    expect(scanned).toContain('src/check/index.ts');
    expect(scanned).toContain('src/load/corpus.ts');
    expect(scanned).toContain('src/markers/resolve.ts');
    expect(scanned).toContain('src/queue/kernel.ts');
    expect(scanned).toContain('src/validate/findings.ts');
    // `lintCorpus` lives here and produces the `records` `checkChanges` reads, so
    // its absence from the scan was the gap the directory walk closes.
    expect(scanned).toContain('src/validate/index.ts');
  });

  test('the scan ignores comments and strings but catches code after comment-like literals', () => {
    const source = [
      '// localeCompare in documentation is not executable',
      'const prose = "localeCompare";',
      'const url = "https://example"; values.sort((a, b) => a.localeCompare(b));',
    ].join('\n');

    const uses = executableLocaleCompareUses(source, 'fixture.ts');
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/^fixture\.ts:3:\d+$/);
  });

  for (const file of scanned) {
    test(`${file} sorts with compareCodeUnits only`, () => {
      const source = readFileSync(join(import.meta.dir, '..', file), 'utf8');
      expect(executableLocaleCompareUses(source, file)).toEqual([]);
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
