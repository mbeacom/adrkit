/**
 * #300 through the CLI: a `repo`-qualified `affects` matcher in a single-repository
 * corpus never matches, and `adr lint`, `adr check`, and `adr explain` each say so with
 * an `info` finding instead of dropping it silently. `info` has no exit-code authority
 * (ADR-0022), so every exit code here is the one the corpus would get without it.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { acceptedRecordMarkdown, cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-repo-qualified-matchers';
const RULE = 'affects-repo-not-applicable';

async function runAdr(args: string[], cwd = process.cwd()) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

interface JsonFinding {
  rule: string;
  severity: string;
  id?: string;
  field?: string;
  pattern?: string;
}

/** The issue's own reproduction: a record whose only matcher is repo-qualified. */
async function seedCorpus(): Promise<string> {
  const root = await resetTestDir(DIR_NAME);
  await writeText(
    join(root, 'docs/adr/0001-payments.md'),
    acceptedRecordMarkdown('0001', 'Use payments paths').replace(
      'affects: []',
      ['affects:', '  - type: path', '    pattern: "src/**"', '    repo: "payments"'].join('\n'),
    ),
  );
  return root;
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('repo-qualified affects matchers (#300)', () => {
  test('adr lint reports one info finding per record and still exits 0', async () => {
    const root = await seedCorpus();

    const json = await runAdr(['lint', '--dir', 'docs/adr', '--json'], root);
    expect(json.exitCode).toBe(0);
    const findings = (JSON.parse(json.stdout) as { findings: JsonFinding[] }).findings;
    expect(findings.map(({ rule, severity, id, field }) => ({ rule, severity, id, field }))).toEqual([
      { rule: RULE, severity: 'info', id: '0001', field: 'affects' },
    ]);

    const human = await runAdr(['lint', '--dir', 'docs/adr'], root);
    expect(human.exitCode).toBe(0);
    expect(`${human.stdout}${human.stderr}`).toContain(RULE);
  });

  test('adr check does not match the path, reports the skipped matcher, and exits 0', async () => {
    const root = await seedCorpus();

    const json = await runAdr(['check', 'src/a.ts', '--dir', 'docs/adr', '--json'], root);
    expect(json.exitCode).toBe(0);
    const outcome = JSON.parse(json.stdout) as { governing: unknown[]; findings: JsonFinding[]; ok: boolean };
    expect(outcome.governing).toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(outcome.findings.map(({ rule, severity, id, pattern }) => ({ rule, severity, id, pattern }))).toEqual([
      { rule: RULE, severity: 'info', id: '0001', pattern: 'src/**' },
    ]);

    const human = await runAdr(['check', 'src/a.ts', '--dir', 'docs/adr'], root);
    expect(human.exitCode).toBe(0);
    expect(`${human.stdout}${human.stderr}`).toContain(RULE);
  });

  test('adr explain does not match the path, reports the skipped matcher, and exits 0', async () => {
    const root = await seedCorpus();

    const json = await runAdr(['explain', 'src/a.ts', '--dir', 'docs/adr', '--json'], root);
    expect(json.exitCode).toBe(0);
    const explained = JSON.parse(json.stdout) as { governing: unknown[]; findings: JsonFinding[] };
    expect(explained.governing).toEqual([]);
    expect(explained.findings.map(({ rule, severity, id, pattern }) => ({ rule, severity, id, pattern }))).toEqual([
      { rule: RULE, severity: 'info', id: '0001', pattern: 'src/**' },
    ]);

    const human = await runAdr(['explain', 'src/a.ts', '--dir', 'docs/adr'], root);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('No decision governs');
    expect(human.stdout).toContain(RULE);
  });

  test("this repository's ADR-0056 resource matchers produce the lint advisory", async () => {
    const result = await runAdr(['lint', '--json']);
    expect(result.exitCode).toBe(0);
    const findings = (JSON.parse(result.stdout) as { findings: JsonFinding[] }).findings;
    expect(findings.filter((finding) => finding.rule === RULE && finding.id === '0056')).toEqual([
      expect.objectContaining({ severity: 'info', field: 'affects' }),
    ]);
  });
});
