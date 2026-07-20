import { afterEach, describe, expect, test } from 'bun:test';
import { createAdrkitMcpServer } from '../src/index.ts';
import { buildRegisteredServer } from '../src/server.ts';
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
