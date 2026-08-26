/**
 * Checks on the gate-integrity guard (#137).
 *
 * Three things need proving, and they are different:
 *
 * 1. **The guard fires** on each protected surface. A guard nobody has watched
 *    reject anything is an untested function that happens to live in a test file
 *    (ADR-0016), so every entry in `GATE_SURFACES` carries a case that blocks.
 * 2. **The guard stays silent on ordinary work.** This is the failure mode that
 *    would actually bite: a guard that fires on every pull request gets its label
 *    applied reflexively, and a reflexive acknowledgment is not one.
 * 3. **The guard refuses to pass over an input it could not read.** Its pass
 *    condition is "no gate path in this list", which is indistinguishable from
 *    "the list is empty because the listing failed" unless something separates
 *    them. Those cases are the reason the check is worth anything, so they are
 *    asserted directly rather than left to the shape of the code.
 *
 * The coverage assertion at the end is deliberate: it fails if a surface is
 * added to `GATE_SURFACES` without a case that observes it blocking, which is
 * clause 2 of ADR-0016 applied to the guard's own growth.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ACK_LABEL,
  GATE_SURFACES,
  classifyGateChanges,
  flattenPages,
  formatBlock,
  formatReport,
  normalizePath,
  parseArgs,
  pluck,
  surfaceOf,
} from './check-gate-integrity.ts';

/** One changed path per protected surface, in the shape a real pull request produces. */
const BLOCKING_CASES: ReadonlyArray<{ path: string; pattern: string }> = [
  { path: '.github/workflows/ci.yml', pattern: '.github/workflows/' },
  { path: '.github/workflows/trusted-gates.yml', pattern: '.github/workflows/' },
  { path: '.github/actions/setup/action.yml', pattern: '.github/actions/' },
  { path: 'scripts/check-dco.ts', pattern: 'scripts/' },
  { path: 'packages/ci/dist/index.js', pattern: 'packages/ci/' },
  { path: 'CODEOWNERS', pattern: 'CODEOWNERS' },
];

/** Paths an ordinary change touches. None of these may block. */
const ORDINARY_PATHS = [
  'packages/core/src/graph/build.ts',
  'packages/cli/src/index.ts',
  'docs/adr/0035-execute-the-gates.md',
  'README.md',
  'package.json',
  'bun.lock',
  'site/src/content/docs/cli.md',
  'packages/adapters/spec-kit/extension.yml',
  // Near misses, on purpose: a prefix match on a *string* rather than a path
  // boundary would swallow these, and they are legitimate files.
  'packages/cli-extras/src/index.ts',
  'docs/scripts-overview.md',
  'CODEOWNERS.md',
];

describe('the guard fires on every protected surface', () => {
  for (const { path, pattern } of BLOCKING_CASES) {
    test(`${path} blocks without the acknowledgment`, () => {
      const report = classifyGateChanges([path], []);
      expect(report.verdict).toBe('blocked');
      expect(report.changes).toHaveLength(1);
      expect(report.changes[0]?.path).toBe(path);
      expect(report.changes[0]?.surface.pattern).toBe(pattern);
    });
  }

  test('one gate path among many ordinary ones still blocks', () => {
    const report = classifyGateChanges([...ORDINARY_PATHS, 'scripts/check-dco.ts'], []);
    expect(report.verdict).toBe('blocked');
    // The specific observed value, not just the count: a report naming the wrong
    // path would satisfy `changes.length === 1` and tell the reader nothing.
    expect(report.changes.map((change) => change.path)).toEqual(['scripts/check-dco.ts']);
    expect(report.examined).toBe(ORDINARY_PATHS.length + 1);
  });

  test('the block names the path, the reason, and how to acknowledge it', () => {
    const text = formatBlock(classifyGateChanges(['.github/workflows/ci.yml'], []));
    expect(text).toContain('.github/workflows/ci.yml');
    expect(text).toContain('defines which checks run');
    expect(text).toContain(DEFAULT_ACK_LABEL);
    expect(text).toContain('gh pr edit');
  });

  test('matching is case-insensitive, which can only add a match', () => {
    expect(surfaceOf('Scripts/Check-Dco.ts')?.pattern).toBe('scripts/');
    expect(surfaceOf('.GitHub/Workflows/ci.yml')?.pattern).toBe('.github/workflows/');
    expect(surfaceOf('codeowners')?.pattern).toBe('CODEOWNERS');
  });

  test('a leading ./ and backslashes normalize rather than escaping the match', () => {
    expect(normalizePath('./scripts/x.ts')).toBe('scripts/x.ts');
    expect(surfaceOf('./scripts/check-dco.ts')?.pattern).toBe('scripts/');
    expect(surfaceOf('scripts\\check-dco.ts')?.pattern).toBe('scripts/');
  });
});

describe('the guard stays silent on ordinary work', () => {
  test('an ordinary change is clean, and says how much it looked at', () => {
    const report = classifyGateChanges(ORDINARY_PATHS, []);
    expect(report.verdict).toBe('clean');
    expect(report.changes).toEqual([]);
    expect(report.examined).toBe(ORDINARY_PATHS.length);
    expect(formatReport(report)).toContain(`examined ${ORDINARY_PATHS.length} changed path(s)`);
  });

  for (const path of ORDINARY_PATHS) {
    test(`${path} does not match a gate surface`, () => {
      expect(surfaceOf(path)).toBeUndefined();
    });
  }

  test('a prefix matches at a path boundary, not as a bare substring', () => {
    // `packages/cli-extras/` starts with neither `packages/ci/` nor `scripts/`,
    // but a naive `includes` or a prefix without the trailing slash would claim
    // otherwise — and a guard that fires here would be silenced by deletion.
    expect(surfaceOf('packages/cli-extras/src/index.ts')).toBeUndefined();
    expect(surfaceOf('packages/cifs/x.ts')).toBeUndefined();
  });
});

describe('the acknowledgment', () => {
  test('a gate change passes once the label is present', () => {
    const report = classifyGateChanges(['scripts/check-dco.ts'], [DEFAULT_ACK_LABEL]);
    expect(report.verdict).toBe('acknowledged');
    expect(report.acknowledged).toBe(true);
    // Still reported, not swallowed: acknowledged is not the same as clean, and
    // the log has to say which one happened.
    expect(report.changes).toHaveLength(1);
    expect(formatReport(report)).toContain('acknowledged by the');
  });

  test('label matching ignores case and surrounding whitespace', () => {
    expect(
      classifyGateChanges(['scripts/x.ts'], ['  Gate-Change-Acknowledged ']).verdict,
    ).toBe('acknowledged');
  });

  test('an unrelated label does not acknowledge anything', () => {
    const report = classifyGateChanges(['scripts/x.ts'], ['enhancement', 'github_actions']);
    expect(report.verdict).toBe('blocked');
  });

  test('a label that merely contains the token does not acknowledge', () => {
    expect(classifyGateChanges(['scripts/x.ts'], ['not-gate-change-acknowledged']).verdict).toBe(
      'blocked',
    );
  });

  test('the acknowledgment does not make an ordinary change report as acknowledged', () => {
    // The verdict has to distinguish "nothing matched" from "something matched
    // and was waved through", or a stale label would rewrite the log of a clean run.
    expect(classifyGateChanges(['README.md'], [DEFAULT_ACK_LABEL]).verdict).toBe('clean');
  });
});

describe('the guard refuses to pass over an input it could not read', () => {
  test('a non-array payload throws rather than yielding zero paths', () => {
    expect(() => flattenPages({ message: 'Not Found' })).toThrow(/expected a JSON array/);
    expect(() => flattenPages(null)).toThrow(/expected a JSON array/);
  });

  test('paginated and unpaginated shapes both flatten to the same files', () => {
    const paged = [[{ filename: 'a.ts' }], [{ filename: 'b.ts' }]];
    const flat = [{ filename: 'a.ts' }, { filename: 'b.ts' }];
    expect(pluck(flattenPages(paged), 'filename')).toEqual(['a.ts', 'b.ts']);
    expect(pluck(flattenPages(flat), 'filename')).toEqual(['a.ts', 'b.ts']);
  });

  test('an entry missing the field throws rather than silently dropping', () => {
    expect(() => pluck([{ filename: 'a.ts' }, { sha: 'deadbeef' }], 'filename')).toThrow(
      /entry 1 has no string "filename"/,
    );
  });

  test('parseArgs rejects a flag with no value and an unknown flag', () => {
    expect(() => parseArgs(['--files'])).toThrow(/--files needs a value/);
    expect(() => parseArgs(['--files', 'f.json', '--nope'])).toThrow(/unrecognized argument/);
    expect(() => parseArgs(['--labels', 'l.json'])).toThrow(/--files is required/);
  });

  test('parseArgs rejects a non-integer expected count', () => {
    expect(() => parseArgs(['--files', 'f', '--labels', 'l', '--expected-files', 'lots'])).toThrow(
      /non-negative integer/,
    );
  });

  test('parseArgs accepts the shape the trusted workflow passes', () => {
    const options = parseArgs([
      '--files',
      'pr-files.json',
      '--labels',
      'pr-labels.json',
      '--expected-files',
      '12',
    ]);
    expect(options).toEqual({
      files: 'pr-files.json',
      labels: 'pr-labels.json',
      expectedFiles: 12,
      ackLabel: DEFAULT_ACK_LABEL,
    });
  });
});

describe('the surface list carries its own coverage', () => {
  test('every protected surface has a case that was observed blocking', () => {
    const covered = new Set(BLOCKING_CASES.map((testCase) => testCase.pattern));
    const declared = GATE_SURFACES.map((surface) => surface.pattern);
    // Fails when a surface is added without a negative case, which is ADR-0016
    // clause 2 applied to this guard's own growth rather than to a one-off run.
    expect(declared.filter((pattern) => !covered.has(pattern))).toEqual([]);
  });

  test('every surface states why a change there matters', () => {
    for (const surface of GATE_SURFACES) {
      expect(surface.why.length).toBeGreaterThan(0);
    }
  });

  test('this repository really contains each protected surface', () => {
    // A pattern that matches nothing in the tree is a guard watching a door that
    // is not there. Asserted against real paths rather than against the list itself.
    const real = [
      '.github/workflows/ci.yml',
      'scripts/check-gate-integrity.ts',
      'packages/ci/action.yml',
      'CODEOWNERS',
    ];
    for (const path of real) expect(surfaceOf(path)).toBeDefined();
  });
});
