import { afterEach, describe, expect, test } from 'bun:test';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { COMMIT_A, removeScratch, scratch, writeCorpus } from './helpers.ts';

/**
 * ADR-0055 clause 13: one way in, no way out, nothing writable. The server runs under a
 * variant of the MCP side-effect-denial preload that permits one listener and denies file
 * system mutation, child processes, and outbound connections, and every route still answers.
 *
 * Passing is bounded executed-path evidence, as for the MCP preload: it does not prove the
 * absence of raw native syscalls or of runtime APIs the preload does not enumerate.
 */

const HERE = import.meta.dir;
const PRELOAD = join(HERE, 'side-effect-denial-preload.mjs');
const BIN_SRC = resolve(HERE, '../src/bin.ts');
const NAME = 'side-effect-denial';

const children: Array<ReturnType<typeof Bun.spawn>> = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL');
    await child.exited;
  }
  await removeScratch(NAME);
});

const DRIVER = `
import http from 'node:http';
import net from 'node:net';
import { writeFile, mkdir } from 'node:fs/promises';
import { spawn, execSync } from 'node:child_process';

const results = {};
async function check(name, fn) {
  try { await fn(); results[name] = 'allowed'; }
  catch (e) { results[name] = e && e.name === 'SideEffectDenied' ? 'denied' : ('other:' + (e && e.name)); }
}
const first = http.createServer(() => {});
await check('first.listen', () => new Promise((done, fail) => { first.once('error', fail); first.listen(0, '127.0.0.1', done); }));
await check('second.listen', () => new Promise((done, fail) => { const s = http.createServer(() => {}); s.once('error', fail); s.listen(0, '127.0.0.1', done); }));
await check('net.second.listen', () => new Promise((done, fail) => { const s = net.createServer(); s.once('error', fail); s.listen(0, '127.0.0.1', done); }));
await check('net.connect', () => net.connect(1, '127.0.0.1'));
await check('http.request', () => http.request('http://127.0.0.1:1/'));
await check('fetch', () => fetch('http://127.0.0.1:1/'));
await check('writeFile', () => writeFile(process.argv[2] + '/x', 'y'));
await check('mkdir', () => mkdir(process.argv[2] + '/d'));
await check('spawn', () => spawn('true'));
await check('execSync', () => execSync('true'));
first.close();
process.stdout.write(JSON.stringify(results));
`;

const EXPECTED_DRIVER = {
  'first.listen': 'allowed',
  'second.listen': 'denied',
  'net.second.listen': 'denied',
  'net.connect': 'denied',
  'http.request': 'denied',
  fetch: 'denied',
  writeFile: 'denied',
  mkdir: 'denied',
  spawn: 'denied',
  execSync: 'denied',
};

async function snapshot(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const info = await stat(path);
    out.push(`${relative(root, path)} ${info.size} ${info.mtimeMs} ${entry.isFile() ? (await readFile(path, 'utf8')).length : ''}`);
  }
  return out.sort();
}

async function waitForListening(child: ReturnType<typeof Bun.spawn>): Promise<number> {
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  let text = '';
  while (!text.includes('\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(text);
  if (!match) throw new Error(`server did not start: ${text}${await new Response(child.stderr as ReadableStream).text()}`);
  return Number(match[1]);
}

/** Every route a client can call, with the status it must answer under the trap. */
const CALLS: Array<[string, number]> = [
  ['/healthz', 200],
  ['/openapi.json', 200],
  ['/api/v1/corpora', 200],
  ['/api/v1/corpora/demo/records', 200],
  ['/api/v1/corpora/demo/records/0002', 200],
  ['/api/v1/corpora/demo/graph?kinds=supersedes,relatesTo,conflictsWith', 200],
  ['/api/v1/corpora/demo/queue', 200],
  ['/api/v1/corpora/demo/issues', 200],
  ['/api/v1/corpora/demo/governing?path=src/a.ts', 200],
  ['/', 302],
  ['/portal/demo/', 200],
  ['/portal/demo/portal-data.json', 200],
  ['/portal/demo/app.css', 200],
  ['/portal/demo/page/app.mjs', 200],
];

async function exercise(command: string[], root: string, readRoots: string[]): Promise<void> {
  const before = await snapshot(root);
  const child = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PATH: process.env.PATH ?? '',
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
      ADRKIT_SERVER_ROOT: root,
      ADRKIT_SERVER_CORPORA: 'demo',
      ADRKIT_SERVER_PORT: '0',
      ADRKIT_SERVER_TEST_READ_ROOTS: JSON.stringify(readRoots),
    },
  });
  children.push(child);
  const port = await waitForListening(child);
  for (const [path, status] of CALLS) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
    const body = await response.text();
    expect([path, response.status]).toEqual([path, status]);
    if (path === '/api/v1/corpora') expect(JSON.parse(body).data).toEqual([{ corpus: 'demo', commit: COMMIT_A }]);
  }
  const post = await fetch(`http://127.0.0.1:${port}/api/v1/corpora/demo/records`, { method: 'POST', body: '{}' });
  expect(post.status).toBe(405);
  expect(await snapshot(root)).toEqual(before);
}

describe('the one-listener preload fails closed on everything else', () => {
  test('under Bun', async () => {
    const dir = await scratch(NAME);
    const driver = join(dir, 'driver.mjs');
    await writeFile(driver, DRIVER, 'utf8');
    const proc = Bun.spawn([process.execPath, '--preload', PRELOAD, driver, dir], { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(out)).toEqual(EXPECTED_DRIVER);
  });

  test('under Node', async () => {
    const dir = await scratch(NAME);
    const driver = join(dir, 'driver.mjs');
    await writeFile(driver, DRIVER, 'utf8');
    const proc = Bun.spawn(['node', '--import', PRELOAD, driver, dir], { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(out)).toEqual(EXPECTED_DRIVER);
  });
});

describe('every route answers under the trap, and nothing on disk changes', () => {
  // ADR-0016 clause 2: observed failing with
  // `(await import('node:child_process')).execSync('true');` added to the getHealth handler
  // in src/server.ts: the trap denied it, the handler answered 500, and `/healthz` failed
  // its expected 200 under both runtimes. The retained input is the route list above.
  test('the source server under Bun', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    await exercise([process.execPath, '--preload', PRELOAD, BIN_SRC], root, [root]);
  });

  test('the bundled server, as the image runs it, under Node', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const out = await scratch(`${NAME}-bundle`);
    try {
      const built = await Bun.build({ entrypoints: [BIN_SRC], target: 'node', conditions: ['bun'], outdir: out, naming: 'server.js' });
      expect(built.success).toBe(true);
      // Node's ESM loader reads the entry module through the public fs API, so the bundle's
      // directory is a read root too.
      await exercise(['node', '--import', PRELOAD, join(out, 'server.js')], root, [root, out]);
    } finally {
      await removeScratch(`${NAME}-bundle`);
    }
  });
});
