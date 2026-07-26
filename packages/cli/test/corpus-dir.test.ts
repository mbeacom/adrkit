import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';

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
});
