import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, readdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { corpusDirectoryErrorKind } from '../src/errors.ts';

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
  test('root read failures are classified without hiding nested or unattributed errors', () => {
    for (const code of ['EIO', 'ESTALE']) {
      expect(corpusDirectoryErrorKind({ code, path: '/repo/docs/adr' }, 'docs/adr', '/repo')).toBe('not-readable');
      expect(corpusDirectoryErrorKind({ code, path: '/repo/docs/adr/0001-record.md' }, 'docs/adr', '/repo')).toBeUndefined();
      expect(corpusDirectoryErrorKind({ code }, 'docs/adr', '/repo')).toBeUndefined();
    }
  });

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
      { name: 'queue', args: ['queue', '--dir', 'missing-adr'] },
      {
        name: 'evaluate',
        args: ['evaluate', 'proposal.md', '--snapshot', 'snapshot.json', '--date', '2026-07-19', '--dir', 'missing-adr'],
      },
    ];

    for (const { name, args } of cases) {
      const result = await runAdr(args, root);
      expect(result.stdout, name).toBe('');
      expect(result.exitCode, name).toBe(2);
      expect(result.stderr, name).toContain('Error: Corpus directory not found: "missing-adr".');
      expect(result.stderr, name).toContain(`Run 'adr help ${name}' for more information.`);
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
        { name: 'queue', args: ['queue', '--dir', 'noread'] },
        {
          name: 'evaluate',
          args: ['evaluate', 'proposal.md', '--snapshot', 'snapshot.json', '--date', '2026-07-19', '--dir', 'noread'],
        },
      ];

      for (const { name, args } of cases) {
        const result = await runAdr(args, root);
        expect(result.stdout, name).toBe('');
        expect(result.exitCode, name).toBe(2);
        expect(result.stderr, name).toContain('Error: Corpus directory not readable: "noread".');
        expect(result.stderr, name).toContain(`Run 'adr help ${name}' for more information.`);
      }
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

  test('queue treats a symlink-loop corpus as an unreachable usage error', async () => {
    const root = await resetTestDir(DIR_NAME);
    await symlink('loop', join(root, 'loop'));

    const result = await runAdr(['queue', '--dir', 'loop'], root);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Error: Corpus directory not readable: "loop".');
    expect(result.stderr).toContain("Run 'adr help queue' for more information.");
  });

  test('queue treats an overlong corpus path as an unreachable usage error', async () => {
    const result = await runAdr(['queue', '--dir', 'x'.repeat(256)]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Error: Corpus directory not readable: "${'x'.repeat(256)}".`);
    expect(result.stderr).toContain("Run 'adr help queue' for more information.");
    expect(result.stderr).not.toContain('ENAMETOOLONG');
  });
});
