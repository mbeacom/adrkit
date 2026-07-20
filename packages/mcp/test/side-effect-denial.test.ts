import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as ts from 'typescript';
import { repoFromFixture, snapshotTree, diffSnapshots, type TempRepo } from './helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(HERE, 'side-effect-denial-preload.mjs');
const BIN_SRC = resolve(HERE, '../src/bin.ts');
const CORE_SRC = resolve(HERE, '../../core/src');

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const DRIVER = `
import { writeFile, readFile, stat, rm, mkdir, open } from 'node:fs/promises';
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
await check('read.outside-readFile', () => readFile('/etc/hosts'));
await check('read.outside-stat', () => stat('/etc/hosts'));

// A read-only API must still work — the preload never touches reads.
let readOk = false;
try { await readFile(process.argv[1]); readOk = true; } catch {}
results['read.readFile'] = readOk ? 'ok' : 'BROKEN';

process.stdout.write(JSON.stringify(results));
`;

const BUN_READ_DRIVER = `
import { access, lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';

const results = {};
async function check(name, fn) {
  try { await fn(); results[name] = 'allowed'; }
  catch (e) { results[name] = e && e.name === 'SideEffectDenied' ? 'denied' : ('other:' + (e && e.name)); }
}

for (const [name, fn] of [
  ['inside.access', () => access(process.argv[1])],
  ['inside.lstat', () => lstat(process.argv[1])],
  ['inside.readFile', () => readFile(process.argv[1])],
  ['inside.readdir', () => readdir(process.argv[2])],
  ['inside.realpath', () => realpath(process.argv[1])],
  ['inside.stat', () => stat(process.argv[1])],
  ['outside.access', () => access('/etc/hosts')],
  ['outside.lstat', () => lstat('/etc/hosts')],
  ['outside.readFile', () => readFile('/etc/hosts')],
  ['outside.readdir', () => readdir('/etc')],
  ['outside.realpath', () => realpath('/etc/hosts')],
  ['outside.stat', () => stat('/etc/hosts')],
]) {
  await check(name, fn);
}
process.stdout.write(JSON.stringify(results));
`;

function auditProductionSource(file: string, source: string): string[] {
  const findings = new Set<string>();
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const allowsSyncFs = file.endsWith('/main-module.ts');

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      if (node.text === 'Bun') findings.add('Bun runtime API');
      if (node.text === 'globalThis') findings.add('global runtime access');
      if (node.text === 'require' || node.text === 'createRequire') {
        findings.add('dynamic module loader');
      }
    }
    if (node.kind === ts.SyntaxKind.ImportKeyword) {
      findings.add('dynamic import');
    }
    if (ts.isStringLiteralLike(node)) {
      if (node.text === 'Bun' || node.text === 'bun' || node.text.startsWith('bun:')) {
        findings.add('Bun runtime/module access');
      }
      if (!allowsSyncFs && (node.text === 'fs' || node.text === 'node:fs')) {
        findings.add('Bun-untrapped synchronous filesystem module');
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...findings].sort();
}

describe('side-effect denial — the preload fails closed on the enumerated inventory (Node)', () => {
  test('every enumerated mutation / spawn / network entry point throws, reads still work', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'adrkit-denial-')));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const driverPath = join(dir, 'driver.mjs');
    await writeFile(driverPath, DRIVER, 'utf8');

    const proc = Bun.spawn(['node', '--import', PRELOAD, driverPath], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ADRKIT_MCP_TEST_READ_ROOTS: JSON.stringify([dir]),
      },
    });
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

describe('side-effect denial — Bun-only escape paths are statically absent', () => {
  test('production sources contain no Bun mutation, process, or shell entry point', async () => {
    const files: string[] = [];
    async function collect(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await collect(path);
        else if (['.ts', '.js', '.mjs', '.cjs'].includes(extname(entry.name))) files.push(path);
      }
    }
    await collect(resolve(HERE, '../src'));
    await collect(CORE_SRC);

    const findings: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const finding of auditProductionSource(file, source)) {
        findings.push(`${file}: ${finding}`);
      }
    }
    expect(findings).toEqual([]);
  });

  test('the AST audit rejects representative Bun, module-loader, and sync-fs escapes', () => {
    for (const source of [
      'Bun.file(path).writer()',
      'const file = Bun.file(resolve(path)); file.delete()',
      'Bun.write(path, bytes)',
      'Bun.spawn(["cmd"])',
      'Bun.spawnSync(["cmd"])',
      'Bun.$`echo escaped`',
      'const { $ } = Bun; $`echo escaped`',
      'import { $ } from "bun"',
      'await import("bun")',
      'require("bun")',
      'await import("node:fs")',
      'import fs from "fs"',
      'const load = createRequire(import.meta.url)',
      'globalThis["Bun"].file(path).writer()',
      'import { Database } from "bun:sqlite"',
    ]) {
      expect(auditProductionSource('/src/tool.ts', source).length).toBeGreaterThan(0);
    }
  });

  test('the Bun preload denies the async read/stat APIs used by corpus loading outside allowed roots', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'adrkit-bun-read-boundary-')));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const driverPath = join(dir, 'driver.ts');
    await writeFile(driverPath, BUN_READ_DRIVER, 'utf8');
    const proc = Bun.spawn([process.execPath, '--preload', PRELOAD, driverPath, dir], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
        ADRKIT_MCP_TEST_READ_ROOTS: JSON.stringify([dir]),
      },
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect([code, err]).toEqual([0, '']);
    expect(JSON.parse(out)).toEqual({
      'inside.access': 'allowed',
      'inside.lstat': 'allowed',
      'inside.readFile': 'allowed',
      'inside.readdir': 'allowed',
      'inside.realpath': 'allowed',
      'inside.stat': 'allowed',
      'outside.access': 'denied',
      'outside.lstat': 'denied',
      'outside.readFile': 'denied',
      'outside.readdir': 'denied',
      'outside.realpath': 'denied',
      'outside.stat': 'denied',
    });
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
