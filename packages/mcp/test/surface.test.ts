import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { resolve } from 'node:path';
import { createAdrkitMcpServer } from '../src/index.ts';
import { buildRegisteredServer } from '../src/server.ts';
import * as projection from '../src/corpus/projection.ts';
import { connectServer, repoFromFixture, toolConfig, type TempRepo } from './helpers.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const FOUR_TOOLS = ['get_decision', 'get_decision_context', 'list_superseded', 'search_decisions'];

describe('public surface — sealed lifecycle handle', () => {
  test('createAdrkitMcpServer does no construction-time I/O and returns a frozen null-prototype handle', () => {
    // A bogus, nonexistent root does NOT throw at construction — proving no fs access here.
    const handle = createAdrkitMcpServer({ cwd: '/definitely/not/a/real/adrkit/root', dir: 'docs/adr' });
    expect(Object.getPrototypeOf(handle)).toBeNull();
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.getOwnPropertyNames(handle).sort()).toEqual(['close', 'start']);
    expect(Object.getOwnPropertySymbols(handle)).toEqual([]);
    expect(typeof handle.start).toBe('function');
    expect(typeof handle.close).toBe('function');
    // No SDK server, transport, registration API, or internal builder is reachable.
    expect((handle as Record<string, unknown>).server).toBeUndefined();
    expect((handle as Record<string, unknown>).connect).toBeUndefined();
  });

  test('start() takes no argument (a caller cannot inject a transport)', () => {
    const handle = createAdrkitMcpServer();
    expect(handle.start.length).toBe(0);
    expect(handle.close.length).toBe(0);
  });

  test('concurrent start() calls share one in-flight startup', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rootSpy = spyOn(projection, 'resolveCanonicalRoots').mockImplementation(async () => {
      await gate;
      throw new Error('controlled startup failure');
    });
    const handle = createAdrkitMcpServer({ cwd: '/not-read-by-this-test' });

    const first = handle.start();
    const second = handle.start();
    expect(rootSpy).toHaveBeenCalledTimes(1);
    release();
    await expect(first).rejects.toThrow('controlled startup failure');
    await expect(second).rejects.toThrow('controlled startup failure');
    rootSpy.mockRestore();
  });

  test('a relative configured root is captured as an absolute lexical path', async () => {
    let observedCwd: string | undefined;
    const rootSpy = spyOn(projection, 'resolveCanonicalRoots').mockImplementation(async (options) => {
      observedCwd = options.cwd;
      throw new Error('controlled startup failure');
    });
    try {
      const handle = createAdrkitMcpServer({ cwd: '.' });
      await expect(handle.start()).rejects.toThrow('controlled startup failure');
      expect(observedCwd).toBe(resolve('.'));
    } finally {
      rootSpy.mockRestore();
    }
  });

  test('a closed handle cannot be started', async () => {
    const handle = createAdrkitMcpServer();
    await handle.close();
    await expect(handle.start()).rejects.toThrow('server handle is closed');
  });
});

describe('internal builder — exactly four tools, no other capability', () => {
  async function connectBuilt(repo: TempRepo) {
    cleanups.push(repo.cleanup);
    const server = buildRegisteredServer(await toolConfig(repo.root, repo.dir));
    const harness = await connectServer(server);
    cleanups.push(harness.close);
    return harness;
  }

  test('tools/list exposes exactly the four named tools with root-object output schemas and fixed annotations', async () => {
    const { client } = await connectBuilt(await repoFromFixture('status-corpus'));
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(FOUR_TOOLS);
    for (const tool of list.tools) {
      expect(tool.outputSchema?.type).toBe('object');
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  test('the server declares tools capability but NOT prompts, resources, or subscriptions', async () => {
    const { client } = await connectBuilt(await repoFromFixture('status-corpus'));
    const caps = client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect(caps?.prompts).toBeUndefined();
    expect(caps?.resources).toBeUndefined();
  });

  test('listing prompts or resources fails — no such capability is registered', async () => {
    const { client } = await connectBuilt(await repoFromFixture('status-corpus'));
    await expect(client.listPrompts()).rejects.toThrow();
    await expect(client.listResources()).rejects.toThrow();
  });
});
