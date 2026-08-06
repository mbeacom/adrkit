import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import {
  acceptedRecordMarkdown,
  cleanupTestDir,
  recordMarkdown,
  resetTestDir,
  supersededRecordMarkdown,
  writeText,
} from '../../core/test/helpers.ts';

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
        acceptedRecordMarkdown('0001', 'Use core paths'),
        ['affects:', '  - type: path', '    pattern: "src/**"'].join('\n'),
      ),
    );
    await writeText(
      join(dir, '0002-specific.md'),
      withAffects(
        acceptedRecordMarkdown('0002', 'Use specific file'),
        ['affects:', '  - type: path', '    pattern: "src/file.ts"'].join('\n'),
      ),
    );

    const result = await runAdr(['explain', 'src/file.ts', '--dir', dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('0001  [accepted] Use core paths');
    expect(result.stdout).toContain('  via path: src/**');
    expect(result.stdout).toContain('0002  [accepted] Use specific file');
    expect(result.stdout).toContain('  via path: src/file.ts');
  });

  test('separates non-accepted matches from the governing group', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(
      join(dir, '0001-draft.md'),
      withAffects(recordMarkdown('0001', 'Draft record'), ['affects:', '  - type: path', '    pattern: "src/**"'].join('\n')),
    );
    await writeText(
      join(dir, '0002-superseded.md'),
      withAffects(
        supersededRecordMarkdown('0002', '0001', 'Superseded record'),
        ['affects:', '  - type: path', '    pattern: "src/**"'].join('\n'),
      ),
    );

    const result = await runAdr(['explain', 'src/file.ts', '--dir', dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No accepted decision governs src/file.ts.');
    expect(result.stdout).toContain('Active proposals (not yet binding):\n  0001  [draft] Draft record');
    expect(result.stdout).toContain('Historical records (not binding):\n  0002  [superseded] Superseded record (superseded by 0001)');
    expect(result.stdout).not.toContain('Decisions governing');
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

    // A path that no pattern matches *and* that does not exist, so the run reports both
    // facts separately: nothing governs it, and nothing was scanned for inbound markers.
    const result = await runAdr(['explain', 'docs/nowhere.md', '--dir', dir]);

    expect(result).toEqual({
      stdout: [
        'No decision governs docs/nowhere.md.',
        'Note: docs/nowhere.md is not a file in this working tree; no @adr markers were scanned.',
        '',
      ].join('\n'),
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
        acceptedRecordMarkdown('0002', 'Use specific file'),
        ['affects:', '  - type: path', '    pattern: "src/file.ts"'].join('\n'),
      ),
    );
    await writeText(
      join(dir, '0001-core.md'),
      withAffects(
        acceptedRecordMarkdown('0001', 'Use core paths'),
        ['affects:', '  - type: path', '    pattern: "src/**"'].join('\n'),
      ),
    );

    const first = await runAdr(['explain', 'src/file.ts', '--dir', dir, '--json']);
    const second = await runAdr(['explain', 'src/file.ts', '--dir', dir, '--json']);
    const parsed = JSON.parse(first.stdout);

    const core = {
      recordId: '0001',
      title: 'Use core paths',
      status: 'accepted',
      bucket: 'governing',
      firedMatchers: [{ type: 'path', pattern: 'src/**' }],
    };
    const specific = {
      recordId: '0002',
      title: 'Use specific file',
      status: 'accepted',
      bucket: 'governing',
      firedMatchers: [{ type: 'path', pattern: 'src/file.ts' }],
    };

    expect(first.exitCode).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(parsed).toEqual({
      path: 'src/file.ts',
      governedBy: [core, specific],
      governing: [core, specific],
      activeProposals: [],
      history: [],
      // Both records were reached by pattern only, so neither carries `declaredBy`, and
      // the scan reports honestly that this path is not a file it could read.
      markers: { state: 'absent', windowBytes: 8192, truncated: false, declared: [] },
      findings: [],
    });
  });
});
