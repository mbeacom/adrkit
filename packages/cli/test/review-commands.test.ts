import { afterEach, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const FIXTURES = resolve(process.cwd(), 'packages/core/test/fixtures/queue');
const sandboxes: string[] = [];

/** A private copy of a queue fixture corpus at `<sandbox>/docs/adr`. */
function sandbox(fixture = 'comprehensive-corpus'): string {
  const root = mkdtempSync(join(tmpdir(), 'adr-review-'));
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

async function queueItem(root: string, id: string) {
  const queue = await runAdr(['queue', '--format', 'json', '--as-of', '2026-01-08'], root);
  return JSON.parse(queue.stdout).items.find((item: { id: string }) => item.id === id) as {
    approvalCount: number;
    unresolvedObjectionCount: number;
    resolvedObjectionCount: number;
  };
}

function diffLines(before: string, after: string) {
  const old = before.split('\n');
  const next = after.split('\n');
  return { removed: old.filter((line) => !next.includes(line)), added: next.filter((line) => !old.includes(line)) };
}

describe('adr approve, adr object, adr resolve', () => {
  test('the queue reflects every write, and the record can then be accepted', async () => {
    const root = sandbox();
    const path = recordFile(root, '0001');
    expect(await queueItem(root, '0001')).toMatchObject({ approvalCount: 1, unresolvedObjectionCount: 1, resolvedObjectionCount: 0 });

    const before = readFileSync(path, 'utf8');
    const approved = await runAdr(['approve', '1', '--by', '@bob', '--json'], root);
    expect(approved.stderr).toBe('');
    expect(approved.exitCode).toBe(0);
    expect(JSON.parse(approved.stdout)).toEqual({ id: '0001', path: 'docs/adr/0001-overdue-arb.md', by: '@bob', changed: true, approvals: 2 });
    expect(diffLines(before, readFileSync(path, 'utf8'))).toEqual({
      removed: ['  approvals: ["@alice"]'],
      added: ['  approvals: ["@alice", "@bob"]'],
    });
    expect(await queueItem(root, '0001')).toMatchObject({ approvalCount: 2 });

    const objected = await runAdr(['object', '0001', '--by', '@dan', '--summary', 'Load test it first', '--json'], root);
    expect(objected.exitCode).toBe(0);
    expect(JSON.parse(objected.stdout)).toMatchObject({ id: '0001', by: '@dan', changed: true, objection: 2 });
    expect(await queueItem(root, '0001')).toMatchObject({ unresolvedObjectionCount: 2, resolvedObjectionCount: 0 });

    const first = await runAdr(['resolve', 'ADR-0001', '--objection', '1', '--by', '@carol'], root);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('resolved');
    expect(await queueItem(root, '0001')).toMatchObject({ unresolvedObjectionCount: 1, resolvedObjectionCount: 1 });

    const second = await runAdr(['resolve', '0001', '--objection', '2', '--by', '@dan', '--json'], root);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout)).toEqual({ id: '0001', path: 'docs/adr/0001-overdue-arb.md', by: '@dan', changed: true, objection: 2 });
    expect(await queueItem(root, '0001')).toMatchObject({ approvalCount: 2, unresolvedObjectionCount: 0, resolvedObjectionCount: 2 });

    const review = readFileSync(path, 'utf8');
    expect(review).toContain('    - by: "@carol"\n      summary: Needs more cost analysis\n      resolved: true\n');
    expect(review).toContain('    - by: "@dan"\n      summary: "Load test it first"\n      resolved: true\n---');

    expect((await runAdr(['accept', '0001', '--by', '@alice'], root)).exitCode).toBe(0);
  });

  test('repeats are no-ops: exit 0, a message, and no write', async () => {
    const root = sandbox();
    const path = recordFile(root, '0005');
    const before = readFileSync(path, 'utf8');

    // Backdate the file, so a rewrite of identical bytes would still show.
    utimesSync(path, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
    const mtime = statSync(path).mtimeMs;
    const approved = await runAdr(['approve', '0005', '--by', '@alice'], root);
    expect(approved.exitCode).toBe(0);
    expect(approved.stdout).toContain('already has an approval from @alice');
    const resolved = await runAdr(['resolve', '0005', '--objection', '1', '--by', '@carol', '--json'], root);
    expect(resolved.exitCode).toBe(0);
    expect(JSON.parse(resolved.stdout)).toMatchObject({ changed: false });
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(statSync(path).mtimeMs).toBe(mtime);

    expect((await runAdr(['object', '0005', '--by', '@erin', '--summary', 'Same concern'], root)).exitCode).toBe(0);
    const once = readFileSync(path, 'utf8');
    utimesSync(path, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
    const objectedAt = statSync(path).mtimeMs;
    const again = await runAdr(['object', '0005', '--by', '@erin', '--summary', 'Same concern'], root);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('already has this open objection');
    expect(readFileSync(path, 'utf8')).toBe(once);
    expect(statSync(path).mtimeMs).toBe(objectedAt);
  });

  test('refusals exit 1 and leave the file untouched', async () => {
    const root = sandbox();
    const path = recordFile(root, '0005');
    const before = readFileSync(path, 'utf8');
    const cases: Array<[string[], string]> = [
      [['resolve', '0005', '--objection', '2', '--by', '@carol'], 'only the objector may resolve it'],
      [['resolve', '0005', '--objection', '3', '--by', '@dave'], 'there is no objection 3'],
    ];
    for (const [args, message] of cases) {
      const result = await runAdr(args, root);
      expect({ args, exitCode: result.exitCode }).toEqual({ args, exitCode: 1 });
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`adr ${args[0]} refused`);
      expect(result.stderr).toContain(message);
      expect(readFileSync(path, 'utf8')).toBe(before);
    }

    const draftPath = recordFile(root, '0008');
    writeFileSync(draftPath, readFileSync(draftPath, 'utf8').replace('status: proposed', 'status: draft'));
    const draft = readFileSync(draftPath, 'utf8');
    for (const args of [
      ['approve', '0008', '--by', '@bob'],
      ['object', '0008', '--by', '@bob', '--summary', 'No'],
    ]) {
      const result = await runAdr(args, root);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('is "draft", not "proposed"');
      expect(readFileSync(draftPath, 'utf8')).toBe(draft);
    }

    const invalid = sandbox('schema-invalid-corpus');
    const id = readdirSync(join(invalid, 'docs/adr'))[0]!.slice(0, 4);
    const invalidBefore = readFileSync(recordFile(invalid, id), 'utf8');
    const lint = await runAdr(['approve', id, '--by', '@bob'], invalid);
    expect(lint.exitCode).toBe(1);
    expect(lint.stderr).toContain('is invalid');
    expect(readFileSync(recordFile(invalid, id), 'utf8')).toBe(invalidBefore);
  });

  test('usage errors exit 2 and write nothing', async () => {
    const root = sandbox();
    const path = recordFile(root, '0005');
    const before = readFileSync(path, 'utf8');
    const cases: Array<[string[], string]> = [
      [['approve', '--by', '@bob'], 'requires an ADR id'],
      [['approve', '0005'], 'It is never inferred.'],
      [['approve', '0005', '--by', 'bob'], 'Expected @handle, team:slug, or an email address.'],
      [['approve', '4242', '--by', '@bob'], 'No ADR with id "4242"'],
      [['approve', '0005', '--bye', '@bob'], 'Did you mean "--by"?'],
      [['object', '0005', '--by', '@bob'], 'requires --summary'],
      [['object', '0005', '--by', '@bob', '--summary', '  '], 'summary is empty'],
      [['object', '0005', '--by', '@bob', '--summary', 'two\nlines'], 'one line'],
      [['object', '0005', '--by', '@bob', '--summary', 'x'.repeat(501)], 'longer than 500'],
      [['object', '0005', '--summary', 'x'], 'It is never inferred.'],
      [['resolve', '0005', '--by', '@dave'], 'requires --objection'],
      [['resolve', '0005', '--objection', '0', '--by', '@dave'], 'positive whole number'],
      [['resolve', '0005', '--objection', '1e0', '--by', '@dave'], 'positive whole number'],
      [['resolve', '0005', '--objection', '2'], 'It is never inferred.'],
      [['resolve', '0005', '0006', '--objection', '2', '--by', '@dave'], 'exactly one ADR id'],
      [['approve', '0005', '--by', '@bob', '--by', '@carol'], 'more than once'],
      [['approve', '0005', '--by', 'x\u001b[31m@c.de'], 'no control or invisible characters'],
      [['object', '0005', '--by', '@bob', '--summary', 'rtl \u202e evil'], 'no control or invisible characters'],
    ];
    for (const [args, message] of cases) {
      const result = await runAdr(args, root);
      expect({ args, exitCode: result.exitCode }).toEqual({ args, exitCode: 2 });
      expect(result.stderr).toContain(message);
    }
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  test('each command has help', async () => {
    const root = sandbox();
    for (const command of ['approve', 'object', 'resolve']) {
      const help = await runAdr(['help', command], root);
      expect(help.exitCode).toBe(0);
      expect(help.stdout).toContain(`Usage: adr ${command} <id>`);
      expect(help.stdout).toContain('ADR-0051');
      expect((await runAdr([command, '--help'], root)).stdout).toBe(help.stdout);
    }
    const top = await runAdr(['--help'], root);
    for (const command of ['approve', 'object', 'resolve']) expect(top.stdout).toContain(`  ${command} `);
  });

  test('never writes corpus-controlled control characters to the terminal', async () => {
    const root = sandbox();
    const path = recordFile(root, '0008');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^title: .*$/m, 'title: "Evil \\u001b[2J\\u0007 title"'));
    const result = await runAdr(['approve', '0008', '--by', '@bob'], root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Evil');
    expect(result.stdout).not.toContain('\u001b');
    expect(result.stdout).not.toContain('\u0007');
  });

  test('one reviewer under two spellings is one approval, and does not meet quorum', async () => {
    const root = sandbox();
    const path = recordFile(root, '0008');
    writeFileSync(path, readFileSync(path, 'utf8').replace('deciders: ["@alice"]\n', 'deciders: ["@alice"]\nreview:\n  quorum: 2\n'));
    expect((await runAdr(['approve', '0008', '--by', '@bob'], root)).exitCode).toBe(0);
    const after = readFileSync(path, 'utf8');
    const again = await runAdr(['approve', '0008', '--by', '@Bob', '--json'], root);
    expect(again.exitCode).toBe(0);
    expect(JSON.parse(again.stdout)).toMatchObject({ changed: false, approvals: 1 });
    expect(readFileSync(path, 'utf8')).toBe(after);
    expect((await queueItem(root, '0008')).approvalCount).toBe(1);

    // Even a hand-edited second spelling counts once, in the queue and in accept.
    writeFileSync(path, after.replace('    - "@bob"\n', '    - "@bob"\n    - "@Bob"\n'));
    expect((await queueItem(root, '0008')).approvalCount).toBe(1);
    const accept = await runAdr(['accept', '0008', '--by', '@alice'], root);
    expect(accept.exitCode).toBe(1);
    expect(accept.stderr).toContain('1 of 2 required approval(s)');
  });
});
