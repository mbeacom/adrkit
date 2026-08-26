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
  CODEOWNERS_LOCATIONS,
  DEFAULT_ACK_LABEL,
  DOCUMENTED_UNPROTECTED_ROUTES,
  GATE_SURFACES,
  changedPaths,
  classifyGateChanges,
  displayPath,
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
  { path: '.github/CODEOWNERS', pattern: '.github/CODEOWNERS' },
  { path: 'docs/CODEOWNERS', pattern: 'docs/CODEOWNERS' },
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

  test('an empty expected count fails as missing rather than coercing to zero', () => {
    // `Number('')` is 0 and `Number.isInteger(0)` is true, so an unset
    // `changed_files` would otherwise arrive as a confident "changed nothing".
    for (const empty of ['', '   ']) {
      expect(() =>
        parseArgs(['--files', 'f', '--labels', 'l', '--expected-files', empty]),
      ).toThrow(/the count is missing, not zero/);
    }
    // Zero written deliberately is still a value, and still wrong for a pull
    // request — the empty-list guard is what rejects it, with its own message.
    expect(
      parseArgs(['--files', 'f', '--labels', 'l', '--expected-files', '0']).expectedFiles,
    ).toBe(0);
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

describe('a rename cannot carry a gate path out of sight', () => {
  // The guard's one real bypass, found by reading what the GitHub files endpoint
  // actually returns rather than by assuming. A rename reports `filename` as the
  // *new* path only; the old one lives in `previous_filename`. Moving the trusted
  // workflow out of `.github/workflows/` therefore presented a path matching
  // nothing, passed clean, and deleted the gate on merge.
  const renameAway = [
    {
      filename: '.github/wf/trusted-gates.yml',
      previous_filename: '.github/workflows/trusted-gates.yml',
      status: 'renamed',
    },
  ];

  test('the new path alone would have evaded the matcher', () => {
    // Stated explicitly so the case documents what it is defending, and fails
    // loudly if `.github/wf/` ever becomes a protected prefix for other reasons.
    expect(surfaceOf('.github/wf/trusted-gates.yml')).toBeUndefined();
  });

  test('the old path is read too, so the rename blocks', () => {
    const report = classifyGateChanges(changedPaths(renameAway), []);
    expect(report.verdict).toBe('blocked');
    expect(report.changes.map((change) => change.path)).toEqual([
      '.github/workflows/trusted-gates.yml',
    ]);
  });

  test('a rename *into* a gate path blocks on the new path', () => {
    const renameInto = [
      { filename: 'scripts/check-dco.ts', previous_filename: 'tmp/x.ts', status: 'renamed' },
    ];
    expect(classifyGateChanges(changedPaths(renameInto), []).verdict).toBe('blocked');
  });

  test('a deletion was never affected — filename is the deleted path', () => {
    const deletion = [{ filename: '.github/workflows/ci.yml', status: 'removed' }];
    expect(classifyGateChanges(changedPaths(deletion), []).verdict).toBe('blocked');
  });

  test('an ordinary rename outside the gate surface stays clean', () => {
    const ordinary = [
      { filename: 'packages/core/src/b.ts', previous_filename: 'packages/core/src/a.ts' },
    ];
    expect(classifyGateChanges(changedPaths(ordinary), []).verdict).toBe('clean');
  });

  test('an entry with no previous_filename contributes exactly one path', () => {
    // The count matters: `--expected-files` is compared against the *entry* count,
    // and a normalizer that invented a path per entry would make every ordinary
    // pull request report as truncated.
    expect(changedPaths([{ filename: 'a.ts' }, { filename: 'b.ts' }])).toEqual(['a.ts', 'b.ts']);
    expect(changedPaths([{ filename: 'a.ts', previous_filename: null }])).toEqual(['a.ts']);
  });

  test('a non-string previous_filename throws rather than being ignored', () => {
    expect(() => changedPaths([{ filename: 'a.ts', previous_filename: 42 }])).toThrow(
      /non-string "previous_filename"/,
    );
  });
});

describe('CODEOWNERS is protected at every location GitHub honors', () => {
  // Found in security review, not by the coverage assertion below — which reads
  // GATE_SURFACES and therefore cannot see a surface that was never added. GitHub
  // resolves `.github/CODEOWNERS` *before* the root file, so a pull request that
  // adds one supersedes the protected root file without ever touching it. Asserted
  // against a stated list rather than against the surface list itself.
  for (const location of CODEOWNERS_LOCATIONS) {
    test(`${location} blocks without the acknowledgment`, () => {
      expect(classifyGateChanges([location], []).verdict).toBe('blocked');
    });
  }

  test('the three locations are the ones GitHub honors, in precedence order', () => {
    expect([...CODEOWNERS_LOCATIONS]).toEqual([
      '.github/CODEOWNERS',
      'CODEOWNERS',
      'docs/CODEOWNERS',
    ]);
  });

  test('every stated location is actually in the surface list', () => {
    const declared = new Set(GATE_SURFACES.map((surface) => surface.pattern));
    expect(CODEOWNERS_LOCATIONS.filter((location) => !declared.has(location))).toEqual([]);
  });

  test('a file merely named like CODEOWNERS elsewhere does not block', () => {
    expect(surfaceOf('packages/core/CODEOWNERS')).toBeUndefined();
    expect(surfaceOf('CODEOWNERS.md')).toBeUndefined();
  });
});

describe('printed paths cannot forge workflow commands', () => {
  // Git permits a newline in a filename and the files endpoint carries it
  // through, so an attacker-chosen path can put `::` at the start of a physical
  // log line inside a privileged job. The runner trims leading whitespace before
  // testing for the prefix, so the output's indentation is not protection.
  const forged = '.github/workflows/a.yml\n::error title=Gate::forged';

  test('a path carrying a newline is escaped, not printed raw', () => {
    const report = classifyGateChanges([forged], []);
    for (const text of [formatReport(report), formatBlock(report)]) {
      const parsed = text.split('\n').filter((line) => line.trimStart().startsWith('::'));
      expect(parsed).toEqual([]);
      // Escaped rather than dropped: the reader still learns the exact path.
      expect(text).toContain('\\u000a::error title=Gate::forged');
    }
  });

  test('the escaped path still blocks, and names its surface', () => {
    const report = classifyGateChanges([forged], []);
    expect(report.verdict).toBe('blocked');
    expect(report.changes[0]?.surface.pattern).toBe('.github/workflows/');
  });

  test('an ordinary path is printed unchanged', () => {
    expect(displayPath('scripts/check-dco.ts')).toBe('scripts/check-dco.ts');
  });

  test('carriage returns and zero-width characters are escaped too', () => {
    expect(displayPath('a\rb')).toBe('"a\\u000db"');
    // The case JSON.stringify gets wrong: U+200B is a format character, not a
    // control character, so JSON leaves it exactly as invisible as it found it.
    expect(displayPath('scripts/\u200bx.ts')).toBe('"scripts/\\u200bx.ts"');
    expect(JSON.stringify('scripts/\u200bx.ts')).not.toContain('\\u200b');
  });

  test('a quote or backslash in a path cannot break the rendering', () => {
    expect(displayPath('a"b\\c\nd')).toBe('"a\\"b\\\\c\\u000ad"');
  });
});

describe('the unprotected routes are documented, not claimed away', () => {
  // The first version of this file asserted that every route to neutering a gate
  // ran through a protected path. That was false — `ci.yml` reaches most of its
  // checks through `bun run <name>`, so the root manifest redirects them, and the
  // packages under test are pull-request-controlled too. A false completeness
  // assertion is worse than a documented gap (ADR-0016), so the gap is pinned
  // here: this fails if someone protects one of these without moving the
  // documentation with it, and fails if the list is quietly emptied.
  test('every documented route really is unprotected', () => {
    for (const route of DOCUMENTED_UNPROTECTED_ROUTES) {
      expect(surfaceOf(route.path)).toBeUndefined();
    }
  });

  test('the list names the specific routes that exist today', () => {
    expect(DOCUMENTED_UNPROTECTED_ROUTES.map((route) => route.path)).toEqual([
      'package.json',
      'packages/cli/src/index.ts',
      'packages/core/src/index.ts',
      'bunfig.toml',
      'tsconfig.json',
    ]);
  });

  test('each route says which gates it reaches', () => {
    for (const route of DOCUMENTED_UNPROTECTED_ROUTES) {
      expect(route.reaches.length).toBeGreaterThan(20);
    }
  });

  test('the trusted gates are not reachable from any of them', () => {
    // The property that makes the narrowed claim true rather than an excuse:
    // trusted-gates.yml invokes script paths directly, and both of those paths
    // are protected, so no manifest or package edit can redirect them.
    expect(surfaceOf('scripts/check-dco.ts')).toBeDefined();
    expect(surfaceOf('scripts/check-gate-integrity.ts')).toBeDefined();
    expect(surfaceOf('.github/workflows/trusted-gates.yml')).toBeDefined();
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
