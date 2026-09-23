import { describe, expect, test } from 'bun:test';
import {
  SCANNED,
  collectDocs,
  findStaleReferences,
  formatFailure,
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
