import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-explain';

async function runAdr(args: string[], cwd = process.cwd()) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function withAffects(markdown: string, affects: string): string {
  return markdown.replace('affects: []', affects);
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('adr explain CLI', () => {
  test('prints two governing records and the matchers that fired', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(
      join(dir, '0001-core.md'),
      withAffects(
        recordMarkdown('0001', 'Use core paths'),
        ['affects:', '  - type: path', '    pattern: "src/**"'].join('\n'),
      ),
    );
    await writeText(
      join(dir, '0002-specific.md'),
      withAffects(
        recordMarkdown('0002', 'Use specific file'),
        ['affects:', '  - type: path', '    pattern: "src/file.ts"'].join('\n'),
      ),
    );

    const result = await runAdr(['explain', 'src/file.ts', '--dir', dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('0001  Use core paths');
    expect(result.stdout).toContain('  via path: src/**');
    expect(result.stdout).toContain('0002  Use specific file');
    expect(result.stdout).toContain('  via path: src/file.ts');
  });

  test('prints a clear line for an ungoverned path and exits zero', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(
      join(dir, '0001-core.md'),
      withAffects(
        recordMarkdown('0001', 'Use core paths'),
        ['affects:', '  - type: path', '    pattern: "src/**"'].join('\n'),
      ),
    );

    const result = await runAdr(['explain', 'README.md', '--dir', dir]);

    expect(result).toEqual({
      stdout: 'No decision governs README.md.\n',
      stderr: '',
      exitCode: 0,
    });
  });

  test('shows inert matchers as findings, not governing matches', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(
      join(dir, '0001-entity.md'),
      withAffects(
        recordMarkdown('0001', 'Use catalog entity'),
        ['affects:', '  - type: entity', '    pattern: "component:default/payments"'].join('\n'),
      ),
    );

    const result = await runAdr(['explain', 'packages/payments/src/index.ts', '--dir', dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('No decision governs packages/payments/src/index.ts.');
    expect(result.stdout).toContain('Findings:');
    expect(result.stdout).toContain('affects-unresolvable');
    expect(result.stdout).toContain('component:default/payments');
  });

  test('--json output is stable and sorted', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(
      join(dir, '0002-specific.md'),
      withAffects(
        recordMarkdown('0002', 'Use specific file'),
        ['affects:', '  - type: path', '    pattern: "src/file.ts"'].join('\n'),
      ),
    );
    await writeText(
      join(dir, '0001-core.md'),
      withAffects(
        recordMarkdown('0001', 'Use core paths'),
        ['affects:', '  - type: path', '    pattern: "src/**"'].join('\n'),
      ),
    );

    const first = await runAdr(['explain', 'src/file.ts', '--dir', dir, '--json']);
    const second = await runAdr(['explain', 'src/file.ts', '--dir', dir, '--json']);
    const parsed = JSON.parse(first.stdout);

    expect(first.exitCode).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(parsed).toEqual({
      path: 'src/file.ts',
      governedBy: [
        {
          recordId: '0001',
          title: 'Use core paths',
          firedMatchers: [{ type: 'path', pattern: 'src/**' }],
        },
        {
          recordId: '0002',
          title: 'Use specific file',
          firedMatchers: [{ type: 'path', pattern: 'src/file.ts' }],
        },
      ],
      findings: [],
    });
  });
});
