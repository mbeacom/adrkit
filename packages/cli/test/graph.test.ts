import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { createPresentation } from '../src/presentation.ts';
import { renderTerminalGraph, resolveGraphFormat, terminalDisplayWidth } from '../src/graph.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-graph';

async function runAdr(args: string[], cwd = process.cwd()) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function graphFixture(): Promise<string> {
  const root = await resetTestDir(DIR_NAME);
  const dir = join(root, 'docs/adr');
  await writeText(join(dir, '0001-foundation.md'), recordMarkdown('0001', 'Use the foundation'));
  await writeText(
    join(dir, '0002-successor.md'),
    recordMarkdown('0002', 'Use the successor')
      .replace('relatesTo: []', 'relatesTo: ["0001"]')
      .replace('affects: []', 'supersedes: ["0001"]\nconflictsWith: ["0001"]\naffects: []'),
  );
  await writeText(
    join(dir, '0003-consumer.md'),
    recordMarkdown('0003', 'Use the consumer').replace('relatesTo: []', 'relatesTo: ["0002"]'),
  );
  return root;
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('adr graph', () => {
  test('resolves auto at the CLI boundary and explicit formats always win', () => {
    expect(resolveGraphFormat('auto', true)).toBe('terminal');
    expect(resolveGraphFormat('auto', false)).toBe('dot');
    expect(resolveGraphFormat('mermaid', true)).toBe('mermaid');
    expect(resolveGraphFormat('terminal', false)).toBe('terminal');
  });

  test('keeps the non-TTY default byte-compatible with the DOT channel', async () => {
    const root = await graphFixture();
    const [automatic, explicit] = await Promise.all([
      runAdr(['graph'], root),
      runAdr(['graph', '--format', 'dot'], root),
    ]);

    expect(automatic.exitCode).toBe(0);
    expect(automatic.stderr).toBe('');
    expect(automatic.stdout).toBe(explicit.stdout);
    expect(automatic.stdout).toStartWith('digraph adr {\n');
  });

  test('emits Mermaid and human terminal formats explicitly', async () => {
    const root = await graphFixture();
    const [mermaid, terminal] = await Promise.all([
      runAdr(['graph', '--format', 'mermaid'], root),
      runAdr(['graph', '--format', 'terminal'], root),
    ]);

    expect(mermaid.exitCode).toBe(0);
    expect(mermaid.stderr).toBe('');
    expect(mermaid.stdout).toStartWith('flowchart LR\n');
    expect(mermaid.stdout).toContain('|supersedes|');

    expect(terminal.exitCode).toBe(0);
    expect(terminal.stderr).toBe('');
    expect(terminal.stdout).toContain('ADR decision graph');
    expect(terminal.stdout).toContain('3 decisions | 4 relationships');
    expect(terminal.stdout).toContain('0002 --supersedes--> 0001');
  });

  test('filters every output format by focus and repeated relationship kinds', async () => {
    const root = await graphFixture();
    const focused = await runAdr(['graph', '--format', 'json', '--focus', '0002'], root);
    const kinds = await runAdr(
      ['graph', '--format', 'json', '--kind', 'supersedes', '--kind', 'conflictsWith'],
      root,
    );

    expect(focused.exitCode).toBe(0);
    expect(JSON.parse(focused.stdout).nodes.map((node: { id: string }) => node.id)).toEqual([
      '0001',
      '0002',
      '0003',
    ]);
    expect(JSON.parse(focused.stdout).edges).toHaveLength(4);

    expect(kinds.exitCode).toBe(0);
    expect(JSON.parse(kinds.stdout).nodes.map((node: { id: string }) => node.id)).toEqual([
      '0001',
      '0002',
    ]);
    expect(JSON.parse(kinds.stdout).edges.map((edge: { kind: string }) => edge.kind)).toEqual([
      'conflictsWith',
      'supersedes',
    ]);
  });

  test('rejects unknown focus ids and relationship kinds as usage errors', async () => {
    const root = await graphFixture();
    const [focus, kind] = await Promise.all([
      runAdr(['graph', '--focus', '9999'], root),
      runAdr(['graph', '--kind', 'dependsOn'], root),
    ]);

    expect(focus.exitCode).toBe(2);
    expect(focus.stdout).toBe('');
    expect(focus.stderr).toContain('No ADR with id "9999" exists');

    expect(kind.exitCode).toBe(2);
    expect(kind.stdout).toBe('');
    expect(kind.stderr).toContain('adr graph --kind must be');
  });

  test('rejects an empty focus instead of silently returning the full graph', async () => {
    const root = await graphFixture();
    const result = await runAdr(['graph', '--focus='], root);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('adr graph --focus requires a non-empty ADR id.');
  });

  test('renders a focused terminal view with incoming and outgoing relationships', () => {
    const style = createPresentation({ colorMode: 'never' }).stdout;
    const output = renderTerminalGraph(
      {
        nodes: [
          { id: '0001', title: 'Use the foundation', status: 'accepted' },
          { id: '0002', title: 'Use the successor', status: 'proposed' },
          { id: '0003', title: 'Use the consumer', status: 'draft' },
        ],
        edges: [
          { from: '0002', to: '0001', kind: 'supersedes' },
          { from: '0003', to: '0002', kind: 'relatesTo' },
        ],
      },
      { columns: 100, focus: '0002', style },
    );

    expect(output).toContain('Focus 0002 [proposed]');
    expect(output).toContain('Outgoing');
    expect(output).toContain('--supersedes--> 0001 [accepted]');
    expect(output).toContain('Incoming');
    expect(output).toContain('0003 [draft] Use the consumer --relatesTo--> 0002');
  });

  test('summarizes dense graphs instead of printing an unreadable edge list', () => {
    const style = createPresentation({ colorMode: 'never' }).stdout;
    const nodes = Array.from({ length: 6 }, (_, index) => ({
      id: String(index + 1).padStart(4, '0'),
      title: `Use decision ${index + 1}`,
      status: 'accepted',
    }));
    const edges = nodes.flatMap((from) =>
      nodes
        .filter((to) => to.id !== from.id)
        .map((to) => ({ from: from.id, to: to.id, kind: 'relatesTo' as const })),
    );

    const output = renderTerminalGraph({ nodes, edges }, { columns: 100, style });
    expect(output).toContain('6 decisions | 30 relationships');
    expect(output).toContain('Most connected');
    expect(output).toContain('Dense graph: use `adr graph --focus');
    expect(output).not.toContain('Relationship map');
  });

  test('bounds large sparse and focused terminal views', () => {
    const style = createPresentation({ colorMode: 'never' }).stdout;
    const sparseNodes = Array.from({ length: 200 }, (_, index) => ({
      id: String(index + 1).padStart(4, '0'),
      title: `Use isolated decision ${index + 1}`,
      status: 'draft',
    }));
    const sparse = renderTerminalGraph({ nodes: sparseNodes, edges: [] }, { columns: 100, style });
    expect(sparse).toContain('Most connected');
    expect(sparse).not.toContain('Relationship map');
    expect(sparse.split('\n').length).toBeLessThan(40);

    const focusNodes = Array.from({ length: 101 }, (_, index) => ({
      id: String(index + 1).padStart(4, '0'),
      title: `Use focus decision ${index + 1}`,
      status: 'accepted',
    }));
    const focusEdges = focusNodes.slice(1).map((node) => ({
      from: node.id,
      to: '0001',
      kind: 'relatesTo' as const,
    }));
    const focused = renderTerminalGraph(
      { nodes: focusNodes, edges: focusEdges },
      { columns: 100, focus: '0001', style },
    );
    expect(focused).toContain('100 incoming | 0 outgoing');
    expect(focused).toContain('80 more incoming relationships');
    expect(focused.split('\n').length).toBeLessThan(60);
  });

  test('truncates terminal titles by grapheme-safe display width', () => {
    const style = createPresentation({ colorMode: 'never' }).stdout;
    const output = renderTerminalGraph(
      {
        nodes: [
          { id: '0001', title: '数据库架构'.repeat(4), status: 'accepted' },
          { id: '0002', title: `${'a'.repeat(20)}😀bbbb`, status: 'draft' },
        ],
        edges: [],
      },
      { columns: 40, style },
    );

    for (const line of output.split('\n')) expect(terminalDisplayWidth(line)).toBeLessThanOrEqual(40);
    expect(output).not.toContain('\ud83d...');
  });

  test('keeps valid 26-character ids within the minimum terminal width', () => {
    const style = createPresentation({ colorMode: 'never' }).stdout;
    const first = `A${'0'.repeat(25)}`;
    const second = `B${'0'.repeat(25)}`;
    const nodes = [
      { id: first, title: 'Use the first long identifier', status: 'accepted' },
      { id: second, title: 'Use the second long identifier', status: 'superseded' },
    ];
    const edge = { from: first, to: second, kind: 'relatesTo' as const };
    const views = [
      renderTerminalGraph({ nodes, edges: [edge] }, { columns: 40, style }),
      renderTerminalGraph(
        {
          nodes: [
            ...nodes,
            ...Array.from({ length: 39 }, (_, index) => ({
              id: String(index + 1).padStart(4, '0'),
              title: `Use dense decision ${index + 1}`,
              status: 'draft',
            })),
          ],
          edges: [],
        },
        { columns: 40, style },
      ),
      renderTerminalGraph({ nodes, edges: [edge] }, { columns: 40, focus: first, style }),
    ];

    for (const view of views) {
      for (const line of view.split('\n')) {
        expect(terminalDisplayWidth(line)).toBeLessThanOrEqual(40);
      }
    }
  });

  test('emits a complete graph with corpus diagnostics and exit 1', async () => {
    const root = await graphFixture();
    const dir = join(root, 'docs/adr');
    await writeText(join(dir, '0004-invalid.md'), recordMarkdown('0004', 'X'));

    const result = await runAdr(['graph', '--format', 'json'], root);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).nodes.map((node: { id: string }) => node.id)).not.toContain('0004');
    expect(result.stderr).toContain('invalid-size');
  });

  test('distinguishes an invalid focused ADR from an absent id', async () => {
    const root = await graphFixture();
    const dir = join(root, 'docs/adr');
    await writeText(join(dir, '0004-invalid.md'), recordMarkdown('0004', 'X'));

    const result = await runAdr(['graph', '--focus', '0004'], root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('ADR "0004" exists but is invalid');
    expect(result.stderr).toContain('invalid-size');
  });

  test('identifies an invalid focused ADR from its filename when parsing cannot recover its id', async () => {
    const root = await graphFixture();
    const dir = join(root, 'docs/adr');
    await writeText(join(dir, '0005-broken.md'), '---\nid: "0005"\ntitle: Broken\n');

    const result = await runAdr(['graph', '--focus', '0005'], root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('ADR "0005" exists but is invalid');
    expect(result.stderr).toContain('frontmatter-fence');
  });
});
