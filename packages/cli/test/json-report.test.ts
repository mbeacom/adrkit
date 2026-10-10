/**
 * `adr lint --json`, `adr new --json`, and `adr explain --json` come from core's report
 * formatters (ADR-0031 action item 4, ADR-0053 action item 8) and are byte-for-byte what the
 * CLI printed when it assembled them inline.
 *
 * The goldens in `fixtures/json-report/` were captured from the CLI **before** the inline
 * assembly was removed, run over the conformance corpus (`packages/core/test/conformance/golden/repo`)
 * and a two-record corpus that does not parse (written below). Because the CLI JSON carries an
 * additive-only obligation (ADR-0031 clause 5), a key moved by the convergence would be a
 * contract break, so equality here is the whole claim. `--as-of <git ref>` cannot be pinned in
 * a golden (the commit moves); `packages/core/test/report.test.ts` covers the ref provenance
 * keys' order, and the one-off before/after comparison on this repository's corpus is
 * recorded in the change that landed this file.
 *
 * ADR-0016: observed failing. Swapping `governedBy` and `governing` in `buildExplainReport`
 * failed every explain case; emitting `findings` before `checked` in `buildLintReport` failed
 * both lint cases; leaking `content` through `buildNewAdrReport` failed the new case. Each
 * mutation was reverted.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const CORPUS = resolve(process.cwd(), 'packages/core/test/conformance/golden/repo');
const GOLDEN = resolve(process.cwd(), 'packages/cli/test/fixtures/json-report');
const BROKEN = 'cli-json-report-broken';
const NEW = 'cli-json-report-new';

let brokenRoot = '';
let newRoot = '';

async function runAdr(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { stdout, exitCode };
}

async function golden(name: string): Promise<string> {
  return readFile(join(GOLDEN, name), 'utf8');
}

beforeAll(async () => {
  brokenRoot = await resetTestDir(BROKEN);
  await cp(join(CORPUS, 'docs/adr/0001-use-the-sync-protocol.md'), join(brokenRoot, 'docs/adr/0001-use-the-sync-protocol.md'));
  await writeText(join(brokenRoot, 'docs/adr/0002-no-closing-fence.md'), '---\nid: "0002"\ntitle: No closing fence\n\n# Broken\n');
  await writeText(join(brokenRoot, 'src/retry.ts'), '// @adr 0001\nexport const retry = true;\n');
  newRoot = await resetTestDir(NEW);
  await cp(join(CORPUS, 'docs'), join(newRoot, 'docs'), { recursive: true });
});

afterAll(async () => {
  await cleanupTestDir(BROKEN);
  await cleanupTestDir(NEW);
});

describe('adr lint --json is core\'s LintReport, unchanged', () => {
  test('a clean corpus', async () => {
    const result = await runAdr(['lint', '--json'], CORPUS);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(await golden('lint.json'));
  });

  test('a corpus that does not parse', async () => {
    const result = await runAdr(['lint', '--json'], brokenRoot);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(await golden('lint-broken.json'));
  });
});

describe('adr explain --json is core\'s ExplainReport, unchanged', () => {
  for (const name of ['retry', 'protocol', 'stale', 'lru', 'missing']) {
    const path = name === 'lru' ? 'src/cache/lru.ts' : `src/sync/${name}.ts`;
    test(`${path}`, async () => {
      const result = await runAdr(['explain', '--json', path], CORPUS);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(await golden(`explain-${name}.json`));
    });
    test(`${path} --as-of 2026-07-15`, async () => {
      const result = await runAdr(['explain', '--json', '--as-of', '2026-07-15', path], CORPUS);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(await golden(`explain-as-of-${name}.json`));
    });
  }

  test('a corpus that does not parse answers with empty groups', async () => {
    const result = await runAdr(['explain', '--json', 'src/retry.ts'], brokenRoot);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(await golden('explain-broken.json'));
  });

  test('a corpus that does not parse still reports the --as-of resolution', async () => {
    const result = await runAdr(['explain', '--json', '--as-of', '2026-07-15T23:30:00-05:00', 'src/retry.ts'], brokenRoot);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(await golden('explain-broken-as-of.json'));
  });
});

describe('adr new --json is core\'s NewAdrReport, unchanged', () => {
  test('id and display path only', async () => {
    const result = await runAdr(['new', '--json', '--status', 'proposed', 'Cap batch size'], newRoot);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(await golden('new.json'));
  });
});
