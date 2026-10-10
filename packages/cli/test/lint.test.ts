import { afterEach, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cleanupTestDir, recordMarkdown, resetTestDir, writeText } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-lint';

/**
 * Count this repository's records the way the corpus contract describes them —
 * `NNNN-*.md`, template excluded — rather than hardcoding a total that goes
 * stale the next time anyone adds a decision. Restating the rule here instead of
 * importing it from `@adrkit/core` keeps the assertion an independent check on
 * discovery: if lint silently stopped seeing a record, the counts diverge.
 */
async function countRepositoryRecords(): Promise<number> {
  const entries = await readdir(resolve(process.cwd(), 'docs/adr'), { withFileTypes: true });
  return entries.filter(
    (entry) => entry.isFile() && /^[0-9]{4,}-.+\.md$/.test(entry.name) && entry.name !== '0000-template.md',
  ).length;
}

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

describe('adr lint CLI', () => {
  test('passes on this repository corpus', async () => {
    const expectedRecords = await countRepositoryRecords();
    expect(expectedRecords).toBeGreaterThan(0);

    const result = await runAdr(['lint']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`checked ${expectedRecords} records, 0 errors, 0 warnings`);
    // Advisory `info` findings may appear (ADR-0056's repo-qualified matchers, #300);
    // nothing at `error` or `warn` may.
    expect(result.stderr).not.toMatch(/^\s+(error|warn)\s/m);
  });

  test('exits 1 on a fixture corpus containing an error', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-bad.md'),
      recordMarkdown('0001').replace('status: draft', 'status: superseded'),
    );

    const result = await runAdr(['lint', '--dir', join(root, 'docs/adr')]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('checked 1 records, 1 errors');
    expect(result.stderr).toContain('superseded-requires-supersededBy');
  });

  // ADR-0059 clause 5, amending ADR-0031 clause 5: a log-qualified relatesTo or
  // conflictsWith is inert against a single corpus, so it no longer fails the gate.
  test('exits 0 on a qualified relatesTo and reports it at info in --json', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-federated.md'),
      recordMarkdown('0001').replace('relatesTo: []', 'relatesTo: ["payments:0012"]'),
    );

    const human = await runAdr(['lint', '--dir', join(root, 'docs/adr')]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('checked 1 records, 0 errors, 0 warnings');
    expect(human.stderr).toContain('federated-ref-unresolved');
    expect(human.stderr).not.toContain('dangling-relatesTo');

    const json = await runAdr(['lint', '--json', '--dir', join(root, 'docs/adr')]);
    expect(json.exitCode).toBe(0);
    const report = JSON.parse(json.stdout) as { findings: Array<Record<string, unknown>> };
    expect(report.findings).toMatchObject([
      { rule: 'federated-ref-unresolved', severity: 'info', id: '0001', field: 'relatesTo', pattern: 'payments:0012' },
    ]);
  });

  test('reports a qualified conflictsWith at info instead of warn', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-federated.md'),
      recordMarkdown('0001', undefined, 'conflictsWith: ["payments:0012"]\n'),
    );

    const result = await runAdr(['lint', '--json', '--dir', join(root, 'docs/adr')]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as { findings: Array<Record<string, unknown>> };
    expect(report.findings).toMatchObject([
      { rule: 'federated-ref-unresolved', severity: 'info', field: 'conflictsWith' },
    ]);
  });

  test('still exits 1 on a qualified supersedes, which clause 4 keeps out', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-federated.md'),
      recordMarkdown('0001', undefined, 'supersedes: ["payments:0012"]\n'),
    );

    const result = await runAdr(['lint', '--dir', join(root, 'docs/adr')]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('checked 1 records, 1 errors');
    expect(result.stderr).toContain('dangling-supersedes');
    expect(result.stderr).toContain('cross-repository supersession is not supported');
  });

  test('still exits 1 on an unqualified dangling relatesTo', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-local.md'),
      recordMarkdown('0001').replace('relatesTo: []', 'relatesTo: ["0012"]'),
    );

    const result = await runAdr(['lint', '--json', '--dir', join(root, 'docs/adr')]);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as { findings: Array<Record<string, unknown>> };
    expect(report.findings).toMatchObject([{ rule: 'dangling-relatesTo', severity: 'error' }]);
  });

  test('reports a missing explicit path as a finding instead of crashing', async () => {
    const root = await resetTestDir(DIR_NAME);

    const result = await runAdr(['lint', './does-not-exist.md'], root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('checked 1 records, 1 errors');
    expect(result.stderr).toContain('file-read');
    expect(result.stderr).toContain('does-not-exist.md');
  });
});
