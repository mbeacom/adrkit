import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { repoFromFixture, snapshotTree, diffSnapshots, type TempRepo } from './helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(HERE, 'side-effect-denial-preload.mjs');
const BIN_SRC = resolve(HERE, '../src/bin.ts');

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const DRIVER = `
import { writeFile, readFile, rm, mkdir, open } from 'node:fs/promises';
import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import worker from 'node:worker_threads';

const results = {};
async function check(name, fn) {
  try { await fn(); results[name] = 'NOT-DENIED'; }
  catch (e) { results[name] = e && e.name === 'SideEffectDenied' ? 'denied' : ('other:' + (e && e.name)); }
}

await check('static.writeFile', () => writeFile('/tmp/adrkit-should-not-exist', 'x'));
await check('dynamic.writeFile', async () => { const m = await import('node:fs/promises'); return m.writeFile('/tmp/x', 'y'); });
await check('alias.writeFile', () => { const w = writeFile; return w('/tmp/x', 'y'); });
await check('fs/promises.rm', () => rm('/tmp/x'));
await check('fs/promises.mkdir', () => mkdir('/tmp/x'));
await check('fs/promises.open(write)', () => open('/tmp/x', 'w'));
await check('fs.writeFileSync', async () => { const fs = await import('node:fs'); return fs.writeFileSync('/tmp/x', 'y'); });
await check('fs.openSync(write)', async () => { const fs = await import('node:fs'); return fs.openSync('/tmp/x', 'w'); });
await check('child_process.execSync', () => execSync('true'));
await check('child_process.spawn', () => spawn('true'));
await check('fetch', () => fetch('http://127.0.0.1:1/'));
await check('http.request', () => http.request('http://127.0.0.1:1/'));
await check('net.connect', () => net.connect(1, '127.0.0.1'));
await check('dgram.createSocket', () => dgram.createSocket('udp4'));
await check('worker_threads.Worker', () => new worker.Worker('/tmp/x.js'));
await check('process.dlopen', () => process.dlopen({ exports: {} }, '/tmp/x.node'));

// A read-only API must still work — the preload never touches reads.
let readOk = false;
try { await readFile(process.argv[1]); readOk = true; } catch {}
results['read.readFile'] = readOk ? 'ok' : 'BROKEN';

process.stdout.write(JSON.stringify(results));
`;

describe('side-effect denial — the preload fails closed on the enumerated inventory (Node)', () => {
  test('every enumerated mutation / spawn / network entry point throws, reads still work', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'adrkit-denial-')));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const driverPath = join(dir, 'driver.mjs');
    await writeFile(driverPath, DRIVER, 'utf8');

    const proc = Bun.spawn(['node', '--import', PRELOAD, driverPath], { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    await proc.exited;
    expect(err).toBe('');
    const results = JSON.parse(out) as Record<string, string>;

    for (const [name, verdict] of Object.entries(results)) {
      if (name === 'read.readFile') {
        expect(verdict).toBe('ok');
      } else {
        expect([name, verdict]).toEqual([name, 'denied']);
      }
    }
  });
});

describe('side-effect denial — all four tools run clean under the trap (Bun)', () => {
  async function spawnUnderTrap(repo: TempRepo): Promise<Client> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--preload', PRELOAD, BIN_SRC, '--cwd', repo.root],
    });
    const client = new Client({ name: 'denial-test', version: '0.0.0' });
    await client.connect(transport);
    cleanups.push(() => client.close());
    return client;
  }

  test('startup and every tool call complete with no denied API and no sandbox mutation', async () => {
    const repo = await repoFromFixture('edge-corpus');
    cleanups.push(repo.cleanup);
    const before = await snapshotTree(repo.root);
    const client = await spawnUnderTrap(repo);

    const calls = [
      ['search_decisions', { query: 'duplicate' }],
      ['get_decision', { ref: '0010' }],
      ['get_decision_context', { files: ['src/app.ts'] }],
      ['list_superseded', {}],
    ] as const;
    for (const [name, args] of calls) {
      const res = await client.callTool({ name, arguments: args as Record<string, unknown> });
      expect(res.isError).toBeFalsy();
    }

    expect(diffSnapshots(before, await snapshotTree(repo.root))).toEqual([]);
  });
});
