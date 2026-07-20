import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildRegisteredServer } from '../src/server.ts';
import {
  connectServer,
  callTool,
  resultOf,
  repoFromFixture,
  snapshotTree,
  snapshotPaths,
  diffSnapshots,
  toolConfig,
  type OpenServer,
  type TempRepo,
} from './helpers.ts';

const cleanups: Array<() => Promise<void>> = [];
const HERE = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(HERE, 'side-effect-denial-preload.mjs');
const BIN_SRC = resolve(HERE, '../src/bin.ts');
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function connectBuilt(repo: TempRepo): Promise<OpenServer> {
  const server = buildRegisteredServer(await toolConfig(repo.root, repo.dir));
  const harness = await connectServer(server);
  cleanups.push(harness.close);
  return harness;
}

describe('boundary — read-only, sandboxed, no arbitrary reads', () => {
  test('no tool call mutates the sandbox tree or any parent/TMPDIR sentinel', async () => {
    const repo = await repoFromFixture('status-corpus');
    cleanups.push(repo.cleanup);
    const parentSentinel = join(repo.root, '..', 'adrkit-parent-sentinel.txt');
    await writeFile(parentSentinel, 'parent', 'utf8');
    cleanups.push(() => rm(parentSentinel, { force: true }));
    const tmpSentinelDir = await realpath(await mkdtemp(join(tmpdir(), 'adrkit-sentinel-')));
    const tmpSentinel = join(tmpSentinelDir, 'sentinel.txt');
    await writeFile(tmpSentinel, 'tmp', 'utf8');
    cleanups.push(() => rm(tmpSentinelDir, { recursive: true, force: true }));

    const sentinels = [parentSentinel, tmpSentinel, join(repo.root, '.git')];
    const treeBefore = await snapshotTree(repo.root);
    const sentBefore = await snapshotPaths(sentinels);

    const { client } = await connectBuilt(repo);
    await callTool(client, 'search_decisions', { query: 'the' });
    await callTool(client, 'get_decision', { ref: '0001' });
    await callTool(client, 'get_decision_context', { files: ['src/app.ts'] });
    await callTool(client, 'list_superseded', {});

    expect(diffSnapshots(treeBefore, await snapshotTree(repo.root))).toEqual([]);
    expect(diffSnapshots(sentBefore, await snapshotPaths(sentinels))).toEqual([]);
  });

  test('real stdio corpus reads stay inside the configured root and preserve complete HOME/TMPDIR trees', async () => {
    const repo = await repoFromFixture('status-corpus');
    cleanups.push(repo.cleanup);
    const environmentRoot = await mkdtemp(join(tmpdir(), 'adrkit-mcp-environment-'));
    cleanups.push(() => rm(environmentRoot, { recursive: true, force: true }));
    const home = join(environmentRoot, 'home');
    const processTmp = join(environmentRoot, 'tmp');
    await mkdir(home);
    await mkdir(processTmp);
    await writeFile(join(home, 'sentinel.txt'), 'home', 'utf8');
    await writeFile(join(processTmp, 'sentinel.txt'), 'tmp', 'utf8');

    const repoBefore = await snapshotTree(repo.root);
    const homeBefore = await snapshotTree(home);
    const tmpBefore = await snapshotTree(processTmp);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--preload', PRELOAD, BIN_SRC, '--cwd', repo.root],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
        HOME: home,
        TMPDIR: processTmp,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
        ADRKIT_MCP_TEST_READ_ROOTS: JSON.stringify([repo.root]),
      },
    });
    const client = new Client({ name: 'boundary-test', version: '0.0.0' });
    await client.connect(transport);
    cleanups.push(() => client.close());

    for (const [name, args] of [
      ['search_decisions', { query: 'the' }],
      ['get_decision', { ref: '0001' }],
      ['get_decision_context', { files: ['src/app.ts'] }],
      ['list_superseded', {}],
    ] as const) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError).toBeFalsy();
    }

    expect(diffSnapshots(repoBefore, await snapshotTree(repo.root))).toEqual([]);
    expect(diffSnapshots(homeBefore, await snapshotTree(home))).toEqual([]);
    expect(diffSnapshots(tmpBefore, await snapshotTree(processTmp))).toEqual([]);
  });

  test('adversarial inputs are rejected before any corpus access, mutating nothing', async () => {
    const repo = await repoFromFixture('status-corpus');
    cleanups.push(repo.cleanup);
    const before = await snapshotTree(repo.root);
    const { client } = await connectBuilt(repo);
    const bad = [
      ['get_decision_context', { files: ['../escape.md'] }],
      ['get_decision_context', { files: ['/abs.md'] }],
      ['get_decision_context', { files: ['docs\\adr\\x.md'] }],
      ['search_decisions', { query: 'x', bogus: 1 }],
      ['get_decision', { ref: 'x'.repeat(200) }],
    ] as const;
    for (const [name, args] of bad) {
      const res = await callTool(client, name, args as Record<string, unknown>);
      expect(res.isError).toBe(true);
    }
    expect(diffSnapshots(before, await snapshotTree(repo.root))).toEqual([]);
  });

  test('no successful response interpolates an absolute corpus path', async () => {
    const repo = await repoFromFixture('status-corpus');
    cleanups.push(repo.cleanup);
    const { client } = await connectBuilt(repo);
    for (const [name, args] of [
      ['search_decisions', { query: 'the' }],
      ['get_decision', { ref: '0001' }],
      ['get_decision_context', { files: ['src/app.ts'] }],
      ['list_superseded', {}],
    ] as const) {
      const res = await callTool(client, name, args as Record<string, unknown>);
      expect(JSON.stringify(res)).not.toContain(repo.root);
    }
  });

  test('each call fresh-reads the corpus: an edit between calls is visible', async () => {
    const repo = await repoFromFixture('status-corpus');
    cleanups.push(repo.cleanup);
    const { client } = await connectBuilt(repo);
    expect(resultOf(await callTool(client, 'get_decision', { ref: '0099' })).outcome).toBe('not-found');
    await writeFile(
      join(repo.adrDir, '0099-late-addition.md'),
      '---\nschemaVersion: 0.1.0\nid: "0099"\ntitle: A late addition\nstatus: draft\ndate: 2026-06-01\n---\n\n# 0099\n',
      'utf8',
    );
    expect(resultOf(await callTool(client, 'get_decision', { ref: '0099' })).outcome).toBe('found');
  });

  test('concurrent calls do not share mutable results or findings', async () => {
    const repo = await repoFromFixture('edge-corpus');
    cleanups.push(repo.cleanup);
    const { client } = await connectBuilt(repo);
    const [search, superseded] = await Promise.all([
      callTool(client, 'search_decisions', { query: 'duplicate' }),
      callTool(client, 'list_superseded', {}),
    ]);
    expect(resultOf(search).outcome).toBe('results');
    expect(resultOf(superseded).outcome).toBe('entries');
    // Distinct findings arrays, independently derived.
    expect(resultOf(search).findings.items).not.toBe(resultOf(superseded).findings.items);
  });
});
