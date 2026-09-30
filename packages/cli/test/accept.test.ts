import { afterEach, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const FIXTURES = resolve(process.cwd(), 'packages/core/test/fixtures/queue');
const sandboxes: string[] = [];

/** A private copy of a queue fixture corpus at `<sandbox>/docs/adr`. */
function sandbox(fixture: string): string {
  const root = mkdtempSync(join(tmpdir(), 'adr-accept-'));
  sandboxes.push(root);
  cpSync(join(FIXTURES, fixture), join(root, 'docs/adr'), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runAdr(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function recordFile(root: string, id: string): string {
  const name = readdirSync(join(root, 'docs/adr')).find((file) => file.startsWith(`${id}-`))!;
  return join(root, 'docs/adr', name);
}

describe('adr accept', () => {
  test('accepts a proposed record, changes three fields, and it leaves the queue', async () => {
    const root = sandbox('comprehensive-corpus');
    const path = recordFile(root, '0002');
    const before = readFileSync(path, 'utf8');

    const result = await runAdr(['accept', '2', '--by', '@carol', '--json'], root);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(Object.keys(json)).toEqual(['id', 'path', 'status', 'ratifiedBy', 'decidedAt']);
    expect(json).toMatchObject({ id: '0002', status: 'accepted', ratifiedBy: '@carol' });
    expect(json.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    const after = readFileSync(path, 'utf8');
    const removed = before.split('\n').filter((line) => !after.split('\n').includes(line));
    const added = after.split('\n').filter((line) => !before.split('\n').includes(line));
    expect(removed).toEqual(['status: proposed']);
    expect(added).toContain('status: accepted');
    expect(added).toContain(`  decidedAt: ${json.decidedAt}`);
    expect(added.some((line) => line.includes('ratifiedBy: "@carol"'))).toBe(true);
    expect(added.length).toBeLessThanOrEqual(4);

    const queue = await runAdr(['queue', '--format', 'json', '--as-of', '2026-01-08'], root);
    expect(JSON.parse(queue.stdout).items.map((item: { id: string }) => item.id)).not.toContain('0002');
  });

  test('refuses an unresolved objection or an unmet quorum and leaves the file untouched', async () => {
    const root = sandbox('comprehensive-corpus');
    for (const id of ['0001', '0005']) {
      const path = recordFile(root, id);
      const before = readFileSync(path, 'utf8');
      const result = await runAdr(['accept', id, '--by', '@carol'], root);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('adr accept refused');
      expect(result.stderr).toContain('unresolved objection');
      expect(readFileSync(path, 'utf8')).toBe(before);
    }
  });

  test('refuses a record that is not proposed, such as one it already accepted', async () => {
    const root = sandbox('within-sla-corpus');
    const id = readdirSync(join(root, 'docs/adr'))[0]!.slice(0, 4);
    expect((await runAdr(['accept', id, '--by', '@carol'], root)).exitCode).toBe(0);
    const path = recordFile(root, id);
    const before = readFileSync(path, 'utf8');
    const again = await runAdr(['accept', id, '--by', '@carol'], root);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain('is "accepted", not "proposed"');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  test('usage errors: missing id, missing or malformed --by, unknown id', async () => {
    const root = sandbox('within-sla-corpus');
    expect((await runAdr(['accept', '--by', '@carol'], root)).exitCode).toBe(2);
    const noBy = await runAdr(['accept', '0001'], root);
    expect(noBy.exitCode).toBe(2);
    expect(noBy.stderr).toContain('It is never inferred.');
    const badBy = await runAdr(['accept', '0001', '--by', 'carol'], root);
    expect(badBy.exitCode).toBe(2);
    expect(badBy.stderr).toContain('Expected @handle, team:slug, or an email address.');
    const unknown = await runAdr(['accept', '4242', '--by', '@carol'], root);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain('No ADR with id "4242"');
    const typo = await runAdr(['accept', '0001', '--bye', '@carol'], root);
    expect(typo.exitCode).toBe(2);
    expect(typo.stderr).toContain('Did you mean "--by"?');
  });

  test('refuses a record with lint errors', async () => {
    const root = sandbox('schema-invalid-corpus');
    const ids = readdirSync(join(root, 'docs/adr')).map((file) => file.slice(0, 4));
    const before = readFileSync(recordFile(root, ids[0]!), 'utf8');
    const result = await runAdr(['accept', ids[0]!, '--by', '@carol'], root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('is invalid');
    expect(readFileSync(recordFile(root, ids[0]!), 'utf8')).toBe(before);
  });
});
