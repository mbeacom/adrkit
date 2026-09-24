import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  SCANNED,
  collectDocs,
  excludes,
  findStaleReferences,
  formatFailure,
  normalizeRelative,
  parseCorpus,
  referencedIds,
  splitBlocks,
  terminalSuccessor,
  type Corpus,
} from './check-stale-adr-references.ts';

/** 0021 superseded by 0022 (accepted); 0005 superseded by 0027 (accepted). */
const corpus: Corpus = {
  nodes: [
    { id: '0005', status: 'superseded' },
    { id: '0021', status: 'superseded' },
    { id: '0022', status: 'accepted' },
    { id: '0027', status: 'accepted' },
    { id: '0031', status: 'accepted' },
    { id: '0044', status: 'rejected' },
    { id: '0045', status: 'deprecated' },
  ],
  edges: [
    { from: '0022', to: '0021', kind: 'supersedes' },
    { from: '0027', to: '0005', kind: 'supersedes' },
    { from: '0031', to: '0022', kind: 'relatesTo' },
  ],
};

const scan = (text: string, path = 'README.md') => findStaleReferences(path, text, corpus);

describe('referencedIds', () => {
  test.each([
    ['hyphenated', 'See ADR-0021 for the rule.'],
    ['spaced', 'See ADR 0021 for the rule.'],
    ['lowercase', 'see adr-0021'],
    ['bare adjacency', 'ADR-0021.'],
    ['a corpus link target', '[the rule](./docs/adr/0021-resolve-inbound-source-annotations.md)'],
    ['an mdx link target', '[the rule](/docs/adr/0021-resolve-inbound.mdx)'],
  ])('finds an id written as %s', (_label, text) => {
    expect(referencedIds(text)).toEqual(['0021']);
  });

  // A bare four-digit number is not a citation. `8192`, `2026` and release
  // numbers all appear in these documents; a guard that fired on them would be
  // switched off within a week.
  test.each([
    ['a byte window', 'at most the first 8192 bytes'],
    ['a year', 'verified on 2026-03-01'],
    ['a pull request', 'shipped in #1021'],
    ['a version', 'released as 0.14.0'],
  ])('does not treat %s as a citation', (_label, text) => {
    expect(referencedIds(text)).toEqual([]);
  });

  test('deduplicates, preserving first appearance', () => {
    expect(referencedIds('ADR-0022 supersedes ADR-0021; see ADR-0022 again')).toEqual(['0022', '0021']);
  });
});

describe('splitBlocks', () => {
  test('keeps a multi-line sentence in one window', () => {
    const blocks = splitBlocks('extended the resolution under\nADR-0022,\nwhich supersedes ADR-0021.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.line).toBe(1);
  });

  test('starts a new window at each list item', () => {
    expect(splitBlocks('- first item\n- second item\n- third item')).toHaveLength(3);
  });

  test.each([
    ['numbered', '1. first\n2. second'],
    ['parenthesised', '1) first\n2) second'],
    ['asterisk', '* first\n* second'],
    ['plus', '+ first\n+ second'],
  ])('starts a new window for a %s list', (_label, text) => {
    expect(splitBlocks(text)).toHaveLength(2);
  });

  test('reports 1-based line numbers', () => {
    expect(splitBlocks('first\n\n\nfourth').map((block) => block.line)).toEqual([1, 4]);
  });

  test.each([
    ['backtick', '```\nADR-0021\n```'],
    ['tilde', '~~~\nADR-0021\n~~~'],
    ['a longer backtick fence', '````\n```\nADR-0021\n```\n````'],
    ['an indented fence', '  ```text\n  ADR-0021\n  ```'],
    ['an info string', '```text\nADR-0021\n```'],
  ])('drops a %s fenced block', (_label, text) => {
    expect(splitBlocks(text)).toEqual([]);
  });

  test('drops YAML frontmatter but not a later horizontal rule', () => {
    const blocks = splitBlocks('---\ntitle: ADR-0021\n---\n\nbody\n\n---\n\nADR-0022');
    expect(blocks.map((block) => block.text)).toEqual(['body', '---', 'ADR-0022']);
  });

  test('does not treat a mid-document `---` as frontmatter', () => {
    expect(splitBlocks('body\n\n---\ntitle: ADR-0021\n---').some((b) => b.text.includes('ADR-0021'))).toBe(true);
  });
});

describe('terminalSuccessor', () => {
  test('resolves a one-step chain to the live record', () => {
    expect(terminalSuccessor('0021', corpus)).toBe('0022');
  });

  test('walks a multi-step chain to the terminal live record', () => {
    const chained: Corpus = {
      nodes: [
        { id: '0001', status: 'superseded' },
        { id: '0002', status: 'superseded' },
        { id: '0003', status: 'accepted' },
      ],
      edges: [
        { from: '0002', to: '0001', kind: 'supersedes' },
        { from: '0003', to: '0002', kind: 'supersedes' },
      ],
    };
    expect(terminalSuccessor('0001', chained)).toBe('0003');
  });

  test('gives up on a cycle rather than looping', () => {
    const cyclic: Corpus = {
      nodes: [
        { id: '0001', status: 'superseded' },
        { id: '0002', status: 'superseded' },
      ],
      edges: [
        { from: '0002', to: '0001', kind: 'supersedes' },
        { from: '0001', to: '0002', kind: 'supersedes' },
      ],
    };
    expect(terminalSuccessor('0001', cyclic)).toBeUndefined();
  });

  test('gives up when the successor is not in the corpus', () => {
    const dangling: Corpus = {
      nodes: [{ id: '0001', status: 'superseded' }],
      edges: [{ from: '0099', to: '0001', kind: 'supersedes' }],
    };
    expect(terminalSuccessor('0001', dangling)).toBeUndefined();
  });

  test('ignores a relatesTo edge', () => {
    expect(terminalSuccessor('0022', corpus)).toBeUndefined();
  });

  // Core's `terminalLiveSuccessor` counts only accepted/draft/proposed as live.
  // Returning a rejected or deprecated record here would make the failure
  // message advise a citation this same guard rejects on the next run.
  test.each([
    ['rejected', 'rejected'],
    ['deprecated', 'deprecated'],
  ])('does not offer a %s record as the successor', (_label, status) => {
    const dead: Corpus = {
      nodes: [
        { id: '0001', status: 'superseded' },
        { id: '0002', status },
      ],
      edges: [{ from: '0002', to: '0001', kind: 'supersedes' }],
    };
    expect(terminalSuccessor('0001', dead)).toBeUndefined();
  });

  test.each([['draft'], ['proposed']])('offers a %s successor, as core does', (status) => {
    const pending: Corpus = {
      nodes: [
        { id: '0001', status: 'superseded' },
        { id: '0002', status },
      ],
      edges: [{ from: '0002', to: '0001', kind: 'supersedes' }],
    };
    expect(terminalSuccessor('0001', pending)).toBe('0002');
  });
});

describe('findStaleReferences', () => {
  test('reports a superseded record cited alone', () => {
    expect(scan('There is no schema change ([ADR-0021](./docs/adr/0021-resolve.md)).')).toEqual([
      { path: 'README.md', line: 1, id: '0021', status: 'superseded', successor: '0022' },
    ]);
  });

  // The positive control: AGENTS.md names ADR-0021 on one line and links
  // ADR-0022 two lines later, in the same sentence. A per-line window would
  // fail a correct document.
  test('accepts a citation whose window also names the successor', () => {
    const text =
      'v0.4.0 shipped that inbound edge under ADR-0021.\nv0.5.0 extended it under\n' +
      '[ADR-0022](./docs/adr/0022-scan.md), which supersedes ADR-0021.';
    expect(scan(text)).toEqual([]);
  });

  test('accepts acknowledgement by link target alone', () => {
    expect(scan('Superseded by [the newer rule](./docs/adr/0022-scan-inbound-markers.md); see ADR-0021.')).toEqual([]);
  });

  test('accepts a mid-chain successor, not only the terminal one', () => {
    const chained: Corpus = {
      nodes: [
        { id: '0001', status: 'superseded' },
        { id: '0002', status: 'superseded' },
        { id: '0003', status: 'accepted' },
      ],
      edges: [
        { from: '0002', to: '0001', kind: 'supersedes' },
        { from: '0003', to: '0002', kind: 'supersedes' },
      ],
    };
    // 0001 is acknowledged by 0002, which is mid-chain and itself superseded.
    // 0002 is not acknowledged, so it is still reported — naming a successor
    // excuses the record it succeeds, never itself.
    const findings = findStaleReferences('README.md', 'ADR-0001, later ADR-0002.', chained);
    expect(findings.map((finding) => finding.id)).toEqual(['0002']);
  });

  // The word alone does not say where to go next, which is the only thing a
  // reader of a superseded citation actually needs.
  test('does not accept the word "superseded" in place of the successor', () => {
    expect(scan('ADR-0021 is superseded.')).toHaveLength(1);
  });

  test.each([
    ['rejected', '0044'],
    ['deprecated', '0045'],
  ])('reports a %s record cited without its status word', (status, id) => {
    expect(scan(`The rule comes from ADR-${id}.`)).toEqual([
      { path: 'README.md', line: 1, id, status },
    ]);
  });

  test.each([
    ['rejected', '0044', 'ADR-0044 was rejected.'],
    ['deprecated', '0045', 'ADR-0045 is deprecated.'],
    ['case-insensitively', '0044', 'ADR-0044 — Rejected, for the reasons below.'],
  ])('accepts a %s record whose window carries the status word', (_label, _id, text) => {
    expect(scan(text)).toEqual([]);
  });

  test('omits successor when the chain does not resolve', () => {
    const dangling: Corpus = {
      nodes: [{ id: '0001', status: 'superseded' }],
      edges: [],
    };
    expect(findStaleReferences('README.md', 'See ADR-0001.', dangling)[0]?.successor).toBeUndefined();
  });

  test.each([
    ['an accepted record', 'See ADR-0022 and ADR-0027.'],
    ['a record the corpus does not have', 'See ADR-9999.'],
  ])('is silent about %s', (_label, text) => {
    expect(scan(text)).toEqual([]);
  });

  test('does not fire inside a fenced sample of this guard’s own output', () => {
    expect(scan('```text\nREADME.md:1  ADR-0021 is superseded\n```')).toEqual([]);
  });

  test('reports the window start line, not the file start', () => {
    expect(scan('intro\n\nfiller\n\nSee ADR-0021.')[0]?.line).toBe(5);
  });

  test('does not let one acknowledged bullet excuse another', () => {
    const text = '- ADR-0021, superseded by ADR-0022.\n- Nothing enters the record (ADR-0021).';
    expect(scan(text)).toEqual([
      { path: 'README.md', line: 2, id: '0021', status: 'superseded', successor: '0022' },
    ]);
  });

  test('reports each unacknowledged record once per window', () => {
    expect(scan('ADR-0021 and ADR-0005 both changed.')).toHaveLength(2);
  });
});

describe('formatFailure', () => {
  test('names the successor when it resolved', () => {
    const message = formatFailure([
      { path: 'README.md', line: 3, id: '0021', status: 'superseded', successor: '0022' },
    ]);
    expect(message).toContain('README.md:3  ADR-0021 is superseded — name ADR-0022 here');
  });

  test('asks for a successor generically when none resolved', () => {
    expect(formatFailure([{ path: 'README.md', line: 3, id: '0021', status: 'superseded' }])).toContain(
      'name its successor here',
    );
  });

  test('asks for the status word for a rejected record', () => {
    expect(formatFailure([{ path: 'README.md', line: 1, id: '0044', status: 'rejected' }])).toContain(
      'say "rejected" here',
    );
  });
});

describe('parseCorpus', () => {
  test('reads nodes and edges', () => {
    const parsed = parseCorpus('{"nodes":[{"id":"0001","title":"t","status":"accepted"}],"edges":[]}');
    expect(parsed.nodes).toEqual([{ id: '0001', status: 'accepted' }]);
  });

  // A guard that sees nothing reports nothing (ADR-0016).
  test.each([
    ['an empty corpus', '{"nodes":[],"edges":[]}'],
    ['a missing edges array', '{"nodes":[{"id":"0001","status":"accepted"}]}'],
    ['a missing nodes array', '{"edges":[]}'],
    ['a node without a status', '{"nodes":[{"id":"0001"}],"edges":[]}'],
    ['an edge without a kind', '{"nodes":[{"id":"0001","status":"accepted"}],"edges":[{"from":"a","to":"b"}]}'],
  ])('throws on %s rather than reporting a clean run', (_label, json) => {
    expect(() => parseCorpus(json)).toThrow();
  });
});

describe('the scanned set', () => {
  test('every configured path exists, and reading them yields documents', () => {
    const docs = collectDocs();
    expect(docs.length).toBeGreaterThan(10);
  });

  test('excludes the corpus and its generated site mirror', () => {
    const paths = collectDocs().map((doc) => doc.path);
    expect(paths.some((path) => path.startsWith('docs/adr/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('site/src/content/docs/adr/'))).toBe(false);
  });

  // The two `startsWith` assertions above are the ones that passed on Windows while
  // the guard failed there: a `docs\adr\…` path never starts with `docs/adr/`. Without
  // this, dropping `normalizeRelative` from the walk is caught by no test on any
  // platform — only by `bun run check:stale-refs` in the Windows smoke job (#218).
  test('reports every collected path with forward slashes', () => {
    expect(collectDocs().filter((doc) => doc.path.includes('\\')).map((doc) => doc.path)).toEqual([]);
  });

  test.each([
    ['CHANGELOG.md', 'CHANGELOG.md'],
    ['specs/', 'specs'],
    ['plan.md', 'plan.md'],
    ['packages/', 'packages'],
  ])('leaves %s out of scope, because it narrates history', (_label, path) => {
    expect(SCANNED.some((entry) => entry.path === path)).toBe(false);
  });

  test('scans the present-tense documents ADR-0040 names', () => {
    const configured = new Set(SCANNED.map((entry) => entry.path));
    for (const path of ['README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'MANIFEST.md', 'docs']) {
      expect(configured.has(path)).toBe(true);
    }
  });

  test('a missing configured path is an error, not a silent pass', () => {
    expect(() => collectDocs('/nonexistent-root-for-this-test')).toThrow(/does not exist/u);
  });
});

// ---------------------------------------------------------------------------
// Regressions from PR #217 review. Each was reproduced against the merged head
// (`969d12b`) before it was fixed.
// ---------------------------------------------------------------------------

describe('normalizeRelative (Windows separators)', () => {
  // @davesheffer reproduced this on Windows/Bun 1.3.14: `node:path.relative()`
  // returns `docs\adr\0005-….md`, the exclusion list is written with forward
  // slashes, so the corpus exclusion never matched and the guard reported dozens
  // of findings inside docs/adr/. The separator is a parameter so the POSIX suite
  // can assert the Windows behavior — the bug is otherwise unreachable here, and
  // the 68 tests that shipped all passed while the guard itself failed.
  test('rewrites backslashes when the platform separator is a backslash', () => {
    expect(normalizeRelative('docs\\adr\\0005-x.md', '\\')).toBe('docs/adr/0005-x.md');
  });

  // Mirrors core's `normalizeMarkerPath`: on POSIX a backslash is an ordinary
  // filename character, and rewriting it would name a different file.
  test('leaves a backslash alone when the platform separator is a slash', () => {
    expect(normalizeRelative('docs/we\\ird.md', '/')).toBe('docs/we\\ird.md');
  });

  test('is identity for an already-normal path', () => {
    expect(normalizeRelative('site/src/content/docs/ci.mdx', '\\')).toBe('site/src/content/docs/ci.mdx');
  });
});

describe('excludes', () => {
  test.each([
    ['the directory itself', 'docs/adr'],
    ['a file inside it', 'docs/adr/0005-x.md'],
    ['a nested file', 'docs/adr/sub/0005-x.md'],
  ])('excludes %s', (_label, path) => {
    expect(excludes(path, ['docs/adr'])).toBe(true);
  });

  test.each([
    ['a sibling directory sharing a prefix', 'docs/adrs/x.md'],
    ['a sibling file sharing a prefix', 'docs/adr-notes.md'],
    ['an unrelated path', 'docs/RELEASING.md'],
  ])('does not exclude %s', (_label, path) => {
    expect(excludes(path, ['docs/adr'])).toBe(false);
  });

  // The Windows failure, stated as the predicate rather than the walk.
  test('matches a path that arrived with backslashes once it is normalized', () => {
    expect(excludes(normalizeRelative('docs\\adr\\0005-x.md', '\\'), ['docs/adr'])).toBe(true);
  });
});

describe('frontmatter that never closes', () => {
  // Reported by Copilot. The loop ran to EOF and then stepped one past it, so the
  // `for` never executed and the whole document was dropped — a file could hide
  // every stale citation while the command reported a clean run. That is the
  // fail-open this script's own docblock promises it does not have (ADR-0016).
  test('scans a document whose opening --- has no closing delimiter', () => {
    const blocks = splitBlocks('---\ntitle: x\n\nSee ADR-0021.');
    expect(blocks.map((block) => block.text)).toContain('See ADR-0021.');
  });

  test('scans a document that opens with a thematic break', () => {
    expect(splitBlocks('---\n\nSee ADR-0021.').map((block) => block.text)).toContain('See ADR-0021.');
  });

  test('still drops frontmatter that does close', () => {
    expect(splitBlocks('---\ntitle: ADR-0021\n---\n\nbody').map((block) => block.text)).toEqual(['body']);
  });
});

describe('closing fences', () => {
  // Reported by Copilot. A closing fence may not carry an info string, but the
  // matcher accepted one, so ```js … ```py closed the block early and the code
  // after it was scanned as prose.
  test('does not let an info-string fence close an open fence', () => {
    expect(splitBlocks('```js\ncode\n```py\nSee ADR-0021.\n```')).toEqual([]);
  });

  test('closes on a bare fence of at least the opening length', () => {
    expect(splitBlocks('````\ncode\n````\n\nSee ADR-0022.').map((b) => b.text)).toEqual(['See ADR-0022.']);
  });

  test('does not close on a shorter fence', () => {
    expect(splitBlocks('````\n```\nSee ADR-0021.\n````')).toEqual([]);
  });

  test('does not let a tilde fence close a backtick fence', () => {
    expect(splitBlocks('```\n~~~\nSee ADR-0021.\n```')).toEqual([]);
  });

  test('tolerates trailing whitespace on a closing fence', () => {
    expect(splitBlocks('```\ncode\n```   \n\nSee ADR-0022.').map((b) => b.text)).toEqual(['See ADR-0022.']);
  });
});

describe('extensionless site routes', () => {
  // Reported by Copilot. The site renders records at `/adr/<slug>/` with no
  // extension, and eight pages already link that way, so a citation written as a
  // site route was invisible and a successor cited that way never acknowledged.
  test.each([
    ['a trailing-slash route', '[the rule](/adr/0022-scan-inbound-markers/)'],
    ['a route without a trailing slash', '[the rule](/adr/0022-scan-inbound-markers)'],
    ['a repository path', '[the rule](./docs/adr/0022-scan-inbound-markers.md)'],
    ['a blob URL', '[the rule](https://github.com/mbeacom/adrkit/blob/main/docs/adr/0022-scan.md)'],
  ])('reads an id from %s', (_label, text) => {
    expect(referencedIds(text)).toEqual(['0022']);
  });

  test('acknowledges a superseded citation whose successor is a site route', () => {
    const text = 'See ADR-0021, now [superseded](/adr/0022-scan-inbound-markers/).';
    expect(findStaleReferences('site/src/content/docs/ci.mdx', text, corpus)).toEqual([]);
  });

  // Anchoring on `adr/` made another project's corpus newly matchable, and
  // `docs/DISTRIBUTION.md` demonstrates the MADR repository — whose 0005 is a
  // different decision from this corpus's superseded 0005. It is inside a fence,
  // which is what keeps it inert; this pins that, because the fence is now doing
  // load-bearing work it was not doing before.
  test('does not fire on another corpus shown inside a fenced transcript', () => {
    const text = [
      '```sh',
      'npx -y @adrkit/cli migrate --from madr --dry-run',
      '#   → migrated  docs/adr/0005-use-dashes-in-filenames.md',
      '```',
    ].join('\n');
    expect(findStaleReferences('docs/DISTRIBUTION.md', text, corpus)).toEqual([]);
  });

  // The old link alternative was unanchored, so any `NNNN-slug.md` matched. A
  // dated filename is not a decision reference.
  test.each([
    ['a dated changelog file', 'see [notes](./notes/2026-09-22-release.md)'],
    ['a dated page', '[log](/journal/2026-01-thing/)'],
    // Second review round. `\badr/` finds a word boundary between the hyphen and
    // the `a` of `not-adr`, so an unrelated route was read as a local citation —
    // a false positive that fails a required check.
    ['a hyphenated lookalike segment', '[other](/not-adr/0005-old/)'],
    ['another hyphenated lookalike', '[other](/my-adr/0021-x/)'],
    ['a word-joined lookalike', '[other](/notadr/0005-old/)'],
  ])('does not read an id from %s', (_label, text) => {
    expect(referencedIds(text)).toEqual([]);
  });

  test.each([
    ['at the start of a relative path', '[r](adr/0022-scan/)'],
    ['after a slash', '[r](/docs/adr/0022-scan.md)'],
    ['after a dot-slash', '[r](./adr/0022-scan/)'],
  ])('still reads a real adr segment %s', (_label, text) => {
    expect(referencedIds(text)).toEqual(['0022']);
  });
});

/**
 * Whether this process can create a directory symlink.
 *
 * On Windows that needs Developer Mode or elevation, so a contributor's machine may
 * not be able to build the fixtures below. Those tests then skip — but a skipped
 * refusal test is coverage nobody has, so the skip is printed rather than silent,
 * and CI sets `ADRKIT_REQUIRE_SYMLINKS=1` to turn it into a failure (ADR-0016, #218).
 */
const canSymlink = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), 'adrkit-symlink-probe-'));
  try {
    mkdirSync(join(probe, 'target'));
    symlinkSync(join(probe, 'target'), join(probe, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

const symlinkTest = test.skipIf(!canSymlink);

test('the symlink refusal is exercised here, or its skip is stated', () => {
  if (canSymlink) return;
  if (process.env.ADRKIT_REQUIRE_SYMLINKS === '1') {
    throw new Error(
      'ADRKIT_REQUIRE_SYMLINKS=1 but this process cannot create a symlink, so every symlink ' +
        'refusal test would skip. On Windows, enable Developer Mode or run elevated.',
    );
  }
  console.warn(
    'check-stale-adr-references.test: cannot create symlinks here — the symlink refusal tests ' +
      'are SKIPPED and this run does not cover them.',
  );
});

describe('symlinks under a scanned path', () => {
  const tree = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'adrkit-stale-refs-'));
    for (const entry of SCANNED) {
      const target = join(root, entry.path);
      if (entry.path.includes('/') || entry.path === 'docs') {
        mkdirSync(entry.path.endsWith('.md') ? dirname(target) : target, { recursive: true });
      }
      if (entry.path.endsWith('.md')) writeFileSync(target, '# doc\n');
    }
    writeFileSync(join(root, 'docs', 'note.md'), '# note\n');
    return root;
  };

  // Reported by Copilot. `statSync` follows symlinks and `readdirSync` then
  // recurses through whatever it reaches, so a PR-authored tree could make the
  // guard read outside the worktree or recurse forever. Core's marker reader
  // already refuses every symlink component
  // (`packages/core/src/markers/read.ts`); this refuses rather than skips,
  // because skipping is the fail-open the rest of this file exists to avoid.
  symlinkTest('refuses a symlinked file inside a scanned directory', () => {
    const root = tree();
    writeFileSync(join(root, 'target.md'), 'See ADR-0021.\n');
    symlinkSync(join(root, 'target.md'), join(root, 'docs', 'linked.md'));
    expect(() => collectDocs(root)).toThrow(/symlink/iu);
  });

  symlinkTest('refuses a symlinked directory inside a scanned directory', () => {
    const root = tree();
    mkdirSync(join(root, 'elsewhere'));
    writeFileSync(join(root, 'elsewhere', 'x.md'), 'See ADR-0021.\n');
    symlinkSync(join(root, 'elsewhere'), join(root, 'docs', 'linked'));
    expect(() => collectDocs(root)).toThrow(/symlink/iu);
  });

  symlinkTest('refuses a scanned root that is itself a symlink', () => {
    const root = tree();
    // A complete tree first, so the refusal is the symlink and not a missing path.
    rmSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'elsewhere'));
    writeFileSync(join(root, 'elsewhere', 'x.md'), 'See ADR-0021.\n');
    symlinkSync(join(root, 'elsewhere'), join(root, 'docs'));
    expect(() => collectDocs(root)).toThrow(/symlink/iu);
  });

  // Second review round. `lstatSync` on the path this walk constructs checks only
  // its final entry; every ancestor is still traversed by the OS, which follows
  // links. Replacing `site/src/content` let the walk read `outside/docs/leak.md`
  // and report it as `site/src/content/docs/leak.md` — outside the root entirely.
  // Core's `lstatWithoutSymlink` checks each component for exactly this reason.
  symlinkTest('refuses a symlinked ancestor of a scanned path', () => {
    const root = tree();
    rmSync(join(root, 'site/src/content'), { recursive: true });
    mkdirSync(join(root, 'outside', 'docs'), { recursive: true });
    writeFileSync(join(root, 'outside', 'docs', 'leak.md'), 'See ADR-0021.\n');
    symlinkSync(join(root, 'outside'), join(root, 'site/src/content'));
    expect(() => collectDocs(root)).toThrow(/symlink/iu);
  });

  symlinkTest('refuses a symlinked ancestor deeper than one level', () => {
    const root = tree();
    rmSync(join(root, 'site/src'), { recursive: true });
    mkdirSync(join(root, 'outside', 'content', 'docs'), { recursive: true });
    symlinkSync(join(root, 'outside'), join(root, 'site/src'));
    expect(() => collectDocs(root)).toThrow(/symlink/iu);
  });

  // An excluded path is not read, but it is still inside the boundary this guard
  // claims. It was returning before the check, so `docs/adr` could be a symlink
  // and pass — and `main()` then hands that same tree to `adr graph`, whose
  // corpus loader does follow a symlinked root.
  symlinkTest('refuses a symlink at an excluded path rather than skipping the check', () => {
    const root = tree();
    mkdirSync(join(root, 'elsewhere'));
    symlinkSync(join(root, 'elsewhere'), join(root, 'docs', 'adr'));
    expect(() => collectDocs(root)).toThrow(/symlink/iu);
  });

  // Exact equality rather than `not.toContain('docs/adr/0001-x.md')`, which a walk
  // reporting `docs\adr\0001-x.md` also satisfies — the Windows failure from #217.
  // Listing what *was* collected makes the separator, and the exclusion, both
  // observable on whichever platform runs it.
  test('still does not read an excluded directory that is a real directory', () => {
    const root = tree();
    mkdirSync(join(root, 'docs', 'adr'));
    writeFileSync(join(root, 'docs', 'adr', '0001-x.md'), 'See ADR-0021.\n');
    mkdirSync(join(root, 'docs', 'guides'));
    writeFileSync(join(root, 'docs', 'guides', 'kept.md'), '# kept\n');
    expect(collectDocs(root).map((doc) => doc.path)).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'CONTRIBUTING.md',
      'MANIFEST.md',
      'README.md',
      'docs/guides/kept.md',
      'docs/note.md',
    ]);
  });

  // A directory junction is Windows' other link type, and needs no privilege to
  // create — so it is the one a contributor without Developer Mode can make. Whether
  // `lstat` reports it as a symlink is the runtime's call, not this script's; Bun
  // 1.3.14 does, and this pins that the refusal holds for it (#218).
  test.skipIf(process.platform !== 'win32')('refuses a directory junction inside a scanned directory', () => {
    const root = tree();
    mkdirSync(join(root, 'elsewhere'));
    writeFileSync(join(root, 'elsewhere', 'x.md'), 'See ADR-0021.\n');
    symlinkSync(join(root, 'elsewhere'), join(root, 'docs', 'linked'), 'junction');
    expect(() => collectDocs(root)).toThrow(/symlink/iu);
  });

  test('accepts a tree with no symlinks', () => {
    expect(() => collectDocs(tree())).not.toThrow();
  });
});

describe('successor edge selection', () => {
  // `adr graph` sorts edges with `localeCompare`, which follows the runtime's ICU
  // locale. `emit-manifest.ts` refuses to rest a gate on that order for the same
  // reason; first-wins over an unsorted map would make the successor this guard
  // names depend on the machine that ran it.
  test('picks the lowest successor id deterministically, whatever the edge order', () => {
    const nodes = [
      { id: '0001', status: 'superseded' },
      { id: '0002', status: 'accepted' },
      { id: '0003', status: 'accepted' },
    ];
    const forward = { nodes, edges: [
      { from: '0002', to: '0001', kind: 'supersedes' },
      { from: '0003', to: '0001', kind: 'supersedes' },
    ] } satisfies Corpus;
    const reversed = { nodes, edges: [...forward.edges].reverse() } satisfies Corpus;
    expect(terminalSuccessor('0001', forward)).toBe(terminalSuccessor('0001', reversed));
    expect(terminalSuccessor('0001', forward)).toBe('0002');
  });
});

describe('the failure message distinguishes the two acknowledgement rules', () => {
  // Reported by Copilot. The footer told every author to name a successor, while
  // the per-finding line for a rejected record asks for the status word — sending
  // contributors to look for a successor those states do not have.
  test('a rejected finding does not tell the author to name a successor', () => {
    const message = formatFailure([{ path: 'README.md', line: 1, id: '0044', status: 'rejected' }]);
    expect(message).toContain('say "rejected"');
    expect(message).not.toMatch(/acknowledged when the same paragraph or list item names the successor/u);
  });

  test('the footer states both rules when both kinds are reported', () => {
    const message = formatFailure([
      { path: 'README.md', line: 1, id: '0021', status: 'superseded', successor: '0022' },
      { path: 'README.md', line: 2, id: '0044', status: 'rejected' },
    ]);
    expect(message).toMatch(/superseded/u);
    expect(message).toMatch(/rejected or deprecated/u);
  });
});
