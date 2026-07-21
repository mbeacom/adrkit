import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const FIX = 'packages/core/test/fixtures/queue';

async function runAdr(args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd: process.cwd(),
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

describe('adr queue — success paths', () => {
  test('(a) within-sla JSON at asOf', async () => {
    const { stdout, exitCode } = await runAdr(['queue', '--dir', `${FIX}/within-sla-corpus`, '--as-of', '2026-01-08', '--format', 'json']);
    expect(exitCode).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.version).toBe('1');
    expect(report.asOf).toBe('2026-01-08');
    expect(report.items).toHaveLength(1);
    expect(report.items[0].slaState).toBe('within-sla');
    expect(report.totalCorpusFindings).toBe(0);
  });

  test('(b) default format is markdown with dated heading', async () => {
    const { stdout, exitCode } = await runAdr(['queue', '--dir', `${FIX}/within-sla-corpus`, '--as-of', '2026-01-08']);
    expect(exitCode).toBe(0);
    expect(stdout.startsWith('# ARB Queue — 2026-01-08')).toBe(true);
  });

  test('(c) --format markdown equals default', async () => {
    const a = await runAdr(['queue', '--dir', `${FIX}/within-sla-corpus`, '--as-of', '2026-01-08']);
    const b = await runAdr(['queue', '--dir', `${FIX}/within-sla-corpus`, '--as-of', '2026-01-08', '--format', 'markdown']);
    expect(b.stdout).toBe(a.stdout);
  });

  test('(f) offset datetime normalizes to UTC calendar date', async () => {
    const { stdout, exitCode } = await runAdr(['queue', '--dir', `${FIX}/within-sla-corpus`, '--as-of', '2026-01-08T01:00:00+05:00', '--format', 'json']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).asOf).toBe('2026-01-07');
  });

  test('(j) warn-only item finding exits 0', async () => {
    const { exitCode } = await runAdr(['queue', '--dir', `${FIX}/warn-review-by-before-queued-corpus`, '--as-of', '2026-01-08', '--format', 'json']);
    expect(exitCode).toBe(0);
  });

  test('(k) deterministic stdout across two runs (SC-001)', async () => {
    const a = await runAdr(['queue', '--dir', `${FIX}/comprehensive-corpus`, '--as-of', '2026-01-08', '--format', 'json']);
    const b = await runAdr(['queue', '--dir', `${FIX}/comprehensive-corpus`, '--as-of', '2026-01-08', '--format', 'json']);
    expect(b.stdout).toBe(a.stdout);
  });
});

describe('adr queue — error-severity findings (exit 1, full report first)', () => {
  test('(h) schema-invalid corpus emits full JSON then exits 1', async () => {
    const { stdout, exitCode } = await runAdr(['queue', '--dir', `${FIX}/schema-invalid-corpus`, '--as-of', '2026-01-08', '--format', 'json']);
    expect(exitCode).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.corpusFindings.length).toBeGreaterThan(0);
  });

  test('(i) one-way-door auto corpus → corpus.one-way-door-auto-tier, exit 1', async () => {
    const { stdout, exitCode } = await runAdr(['queue', '--dir', `${FIX}/one-way-door-auto-corpus`, '--as-of', '2026-01-08', '--format', 'json']);
    expect(exitCode).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.corpusFindings.map((f: { code: string }) => f.code)).toContain('corpus.one-way-door-auto-tier');
  });

  test('(l) comprehensive corpus: 10 items + 1 corpus finding before exit 1 (SC-002)', async () => {
    const { stdout, exitCode } = await runAdr(['queue', '--dir', `${FIX}/comprehensive-corpus`, '--as-of', '2026-01-08', '--format', 'json']);
    expect(exitCode).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.items).toHaveLength(10);
    expect(report.corpusFindings).toHaveLength(1);
    const states = report.items.map((i: { slaState: string }) => i.slaState);
    expect(states).toContain('overdue');
    expect(states).toContain('due');
    expect(states).toContain('escalated');
    // Markdown surfaces every item/corpus finding without opening sources.
    const md = await runAdr(['queue', '--dir', `${FIX}/comprehensive-corpus`, '--as-of', '2026-01-08']);
    expect(md.stdout).toContain('## Corpus Findings');
    expect(md.stdout).toContain('#### Findings');
  });
});

describe('adr queue — usage errors (exit 2, empty stdout)', () => {
  test('(d) invalid --format', async () => {
    const { stdout, stderr, exitCode } = await runAdr(['queue', '--dir', `${FIX}/within-sla-corpus`, '--format', 'csv']);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain("Invalid --format value: 'csv'");
  });

  test('(e) timezone-less --as-of is rejected', async () => {
    const { stdout, stderr, exitCode } = await runAdr(['queue', '--dir', `${FIX}/within-sla-corpus`, '--as-of', '2026-01-08T10:00:00']);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('Timezone-less datetimes are ambiguous');
  });

  test('(g) impossible dates are rejected without throwing', async () => {
    const bad = await runAdr(['queue', '--dir', `${FIX}/within-sla-corpus`, '--as-of', '2026-13-01']);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain('Invalid --as-of value');
    const bad2 = await runAdr(['queue', '--dir', `${FIX}/within-sla-corpus`, '--as-of', '2026-02-30']);
    expect(bad2.exitCode).toBe(2);
  });

  test('(m) --help exits 0 with usage on stdout and empty stderr', async () => {
    const { stdout, stderr, exitCode } = await runAdr(['queue', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout).toContain('adr queue');
    expect(stderr).toBe('');
  });

  test('(n) unknown flag → exit 2 with frozen message', async () => {
    const { stdout, stderr, exitCode } = await runAdr(['queue', '--unknown-flag']);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe("Unknown flag: '--unknown-flag'. See 'adr queue --help'.\n");
  });

  test('(o) missing --dir → corpus-not-found exit 2 (not generic exit 1)', async () => {
    const { stdout, stderr, exitCode } = await runAdr(['queue', '--dir', `${FIX}/does-not-exist`, '--as-of', '2026-01-08']);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe(`Corpus directory not found: '${FIX}/does-not-exist'.\n`);
  });
});

describe('adr queue — value-taking flags require a value (exit 2)', () => {
  test('bare --as-of (no value) is a usage error, not today’s report', async () => {
    const { stdout, stderr, exitCode } = await runAdr(['queue', '--as-of']);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe("Missing value for flag '--as-of'. See 'adr queue --help'.\n");
  });

  test('bare --dir (no value) is a usage error', async () => {
    const { stdout, stderr, exitCode } = await runAdr(['queue', '--dir']);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe("Missing value for flag '--dir'. See 'adr queue --help'.\n");
  });

  test('bare --format (no value) is a usage error', async () => {
    const { stdout, stderr, exitCode } = await runAdr(['queue', '--format']);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe("Missing value for flag '--format'. See 'adr queue --help'.\n");
  });

  test('--as-of does not consume a following flag as its value', async () => {
    const { stdout, stderr, exitCode } = await runAdr(['queue', '--as-of', '--format', 'json']);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe("Missing value for flag '--as-of'. See 'adr queue --help'.\n");
  });
});
