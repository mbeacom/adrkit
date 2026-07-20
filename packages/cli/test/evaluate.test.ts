import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-evaluate';

async function runAdr(args: string[], cwd = process.cwd()) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const CLEAN_SNAPSHOT = JSON.stringify({ schemaVersion: 'adrkit.pass0.snapshot/v1' });

function validRecord(id: string, extra: string): string {
  return `---\nschemaVersion: 0.1.0\nid: "${id}"\ntitle: A decision titled clearly\ndate: 2026-07-19\n${extra}---\n\n# ADR-${id}\n`;
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('adr evaluate CLI', () => {
  test('exits 1 on a malformed proposal (structural error), never invoking a later pass', async () => {
    const root = await resetTestDir(DIR_NAME);
    const proposal = join(root, 'proposal.md');
    await writeText(proposal, '---\nid: "0042\ntitle: broken yaml\n---\n');
    const snapshot = join(root, 'snap.json');
    await writeText(snapshot, CLEAN_SNAPSHOT);

    const result = await runAdr(['evaluate', proposal, '--snapshot', snapshot, '--date', '2026-07-19', '--json']);
    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.result.report.results).toHaveLength(11);
    expect(payload.result.report.results[0].rule).toBe('schema-valid');
    expect(payload.result.report.results[0].status).toBe('fail');
    expect(payload.result.report.outcome).toBe('returned');
    // no later-pass fields leaked into the deterministic report
    expect(payload.result.report).not.toHaveProperty('scores');
    expect(payload.result.report).not.toHaveProperty('confidence');
  });

  test('exits 2 on invalid invocation (missing --date)', async () => {
    const root = await resetTestDir(DIR_NAME);
    const proposal = join(root, 'p.md');
    await writeText(proposal, validRecord('0042', 'status: proposed\n'));
    const snapshot = join(root, 'snap.json');
    await writeText(snapshot, CLEAN_SNAPSHOT);
    const result = await runAdr(['evaluate', proposal, '--snapshot', snapshot]);
    expect(result.exitCode).toBe(2);
  });

  test('exits 2 on a malformed snapshot contract (wrong schemaVersion)', async () => {
    const root = await resetTestDir(DIR_NAME);
    const proposal = join(root, 'p.md');
    await writeText(proposal, validRecord('0042', 'status: proposed\n'));
    const snapshot = join(root, 'snap.json');
    await writeText(snapshot, JSON.stringify({ schemaVersion: 'wrong/v9' }));
    const result = await runAdr(['evaluate', proposal, '--snapshot', snapshot, '--date', '2026-07-19']);
    expect(result.exitCode).toBe(2);
  });

  test('exits 2 on an unknown snapshot key', async () => {
    const root = await resetTestDir(DIR_NAME);
    const proposal = join(root, 'p.md');
    await writeText(proposal, validRecord('0042', 'status: proposed\n'));
    const snapshot = join(root, 'snap.json');
    await writeText(snapshot, JSON.stringify({ schemaVersion: 'adrkit.pass0.snapshot/v1', bogus: 1 }));
    const result = await runAdr(['evaluate', proposal, '--snapshot', snapshot, '--date', '2026-07-19']);
    expect(result.exitCode).toBe(2);
  });

  const nonProposalCases: ReadonlyArray<{ status: string; extra: string }> = [
    { status: 'accepted', extra: 'status: accepted\ndeciders: ["@alice"]\n' },
    { status: 'rejected', extra: 'status: rejected\n' },
    { status: 'superseded', extra: 'status: superseded\nsupersededBy: "0001"\n' },
    { status: 'deprecated', extra: 'status: deprecated\n' },
  ];

  for (const { status, extra } of nonProposalCases) {
    test(`exits 2 with candidate-status-not-proposal for a ${status} record`, async () => {
      const root = await resetTestDir(DIR_NAME);
      const proposal = join(root, `${status}.md`);
      await writeText(proposal, validRecord('0042', extra));
      const snapshot = join(root, 'snap.json');
      await writeText(snapshot, CLEAN_SNAPSHOT);
      const result = await runAdr(['evaluate', proposal, '--snapshot', snapshot, '--date', '2026-07-19', '--json']);
      expect(result.exitCode).toBe(2);
      // no report/patch is emitted for the input-contract error
      expect(result.stdout).not.toContain('"report"');
      expect(result.stderr.toLowerCase()).toContain('candidate-status-not-proposal');
    });
  }

  test('rejects a --write flag (no persistence is possible)', async () => {
    const root = await resetTestDir(DIR_NAME);
    const proposal = join(root, 'p.md');
    await writeText(proposal, validRecord('0042', 'status: proposed\n'));
    const snapshot = join(root, 'snap.json');
    await writeText(snapshot, CLEAN_SNAPSHOT);
    const result = await runAdr(['evaluate', proposal, '--snapshot', snapshot, '--date', '2026-07-19', '--write']);
    expect(result.exitCode).toBe(2);
  });

  test('a clean proposal exits 0 and prints report + patch', async () => {
    const root = await resetTestDir(DIR_NAME);
    const proposal = join(root, 'p.md');
    await writeText(proposal, validRecord('0042', 'status: proposed\n'));
    const snapshot = join(root, 'snap.json');
    await writeText(snapshot, CLEAN_SNAPSHOT);
    const result = await runAdr(['evaluate', proposal, '--snapshot', snapshot, '--date', '2026-07-19', '--json']);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.result.report.results).toHaveLength(11);
    expect(payload.result.patch.deterministicFindings).toEqual([]);
  });
});
