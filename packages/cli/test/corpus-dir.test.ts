import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-corpus-dir';

async function runAdr(args: string[], cwd = process.cwd()) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('ADR corpus directory usage errors', () => {
  test('commands that read a corpus reject an unreachable --dir consistently', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'proposal.md'),
      [
        '---',
        'schemaVersion: 0.1.0',
        'id: "0042"',
        'title: Missing corpus candidate',
        'status: proposed',
        'date: 2026-07-19',
        'deciders: []',
        'tags: []',
        'scope: component',
        'reversibility: unknown',
        'blastRadius: component',
        'relatesTo: []',
        'affects: []',
        'provenance:',
        '  authoredBy: human',
        '---',
        '',
        '# Missing corpus candidate',
        '',
      ].join('\n'),
    );
    await writeText(join(root, 'snapshot.json'), JSON.stringify({ schemaVersion: 'adrkit.pass0.snapshot/v1' }));

    const cases: ReadonlyArray<{ name: string; args: string[] }> = [
      { name: 'lint', args: ['lint', '--dir', 'missing-adr'] },
      { name: 'graph', args: ['graph', '--dir', 'missing-adr'] },
      { name: 'explain', args: ['explain', 'src/x.ts', '--dir', 'missing-adr'] },
      { name: 'check', args: ['check', 'src/x.ts', '--dir', 'missing-adr'] },
      { name: 'migrate', args: ['migrate', '--from', 'madr', '--dir', 'missing-adr'] },
      {
        name: 'evaluate',
        args: ['evaluate', 'proposal.md', '--snapshot', 'snapshot.json', '--date', '2026-07-19', '--dir', 'missing-adr'],
      },
    ];

    for (const { name, args } of cases) {
      const result = await runAdr(args, root);
      expect(result, name).toEqual({
        stdout: '',
        stderr: "Corpus directory not found: 'missing-adr'.\n",
        exitCode: 2,
      });
      expect(result.stderr, name).not.toContain('ENOENT');
      expect(result.stderr, name).not.toContain(root);
    }
  });

  test('commands that read a corpus reject an unreadable --dir consistently', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'noread');
    await writeText(join(dir, '0001-unreadable.md'), recordMarkdown('0001'));
    await writeText(
      join(root, 'proposal.md'),
      [
        '---',
        'schemaVersion: 0.1.0',
        'id: "0042"',
        'title: Unreadable corpus candidate',
        'status: proposed',
        'date: 2026-07-19',
        'deciders: []',
        'tags: []',
        'scope: component',
        'reversibility: unknown',
        'blastRadius: component',
        'relatesTo: []',
        'affects: []',
        'provenance:',
        '  authoredBy: human',
        '---',
        '',
        '# Unreadable corpus candidate',
        '',
      ].join('\n'),
    );
    await writeText(join(root, 'snapshot.json'), JSON.stringify({ schemaVersion: 'adrkit.pass0.snapshot/v1' }));

    await chmod(dir, 0o300);
    try {
      const stillReadable = await readdir(dir).then(
        () => true,
        () => false,
      );
      if (stillReadable) return;

      const cases: ReadonlyArray<{ name: string; args: string[] }> = [
        { name: 'lint', args: ['lint', '--dir', 'noread'] },
        { name: 'graph', args: ['graph', '--dir', 'noread'] },
        { name: 'explain', args: ['explain', 'src/x.ts', '--dir', 'noread'] },
        { name: 'check', args: ['check', 'src/x.ts', '--dir', 'noread'] },
        { name: 'migrate', args: ['migrate', '--from', 'madr', '--dir', 'noread'] },
        {
          name: 'evaluate',
          args: ['evaluate', 'proposal.md', '--snapshot', 'snapshot.json', '--date', '2026-07-19', '--dir', 'noread'],
        },
      ];

      const actual = [];
      for (const { name, args } of cases) actual.push({ name, ...(await runAdr(args, root)) });
      expect(actual).toEqual(
        cases.map(({ name }) => ({
          name,
          stdout: '',
          stderr: "Corpus directory not readable: 'noread'.\n",
          exitCode: 2,
        })),
      );

    } finally {
      await chmod(dir, 0o700).catch(() => {});
    }
  });

  test('lint treats --dir after -- as a positional path, not an option', async () => {
    const root = await resetTestDir(DIR_NAME);

    const result = await runAdr(['lint', '--', '--dir'], root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('checked 1 records, 1 errors');
    expect(result.stderr).toContain('file-read');
    expect(result.stderr).toContain('--dir');
    expect(result.stderr).not.toContain('Corpus directory not found');
  });
});
