import { afterEach, describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { main } from '../src/main-module.ts';
import { createRepo, repoFromFixture, type TempRepo } from './helpers.ts';

const BIN_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src/bin.ts');

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

interface Captured {
  stdout: string;
  stderr: string;
  restore(): void;
}

function captureStd(): Captured {
  const captured: Captured = { stdout: '', stderr: '', restore() {} };
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured.stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured.stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  captured.restore = () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  };
  return captured;
}

async function runMain(argv: string[], env: Record<string, string | undefined> = {}): Promise<{ code: number; std: Captured }> {
  const std = captureStd();
  try {
    const code = await main(argv, env);
    return { code, std };
  } finally {
    std.restore();
  }
}

describe('adrkit-mcp bin — startup validation and exit codes', () => {
  test('an unknown flag exits 2 with stderr-only diagnostics', async () => {
    const { code, std } = await runMain(['--nope']);
    expect(code).toBe(2);
    expect(std.stdout).toBe('');
    expect(std.stderr.length).toBeGreaterThan(0);
  });

  test('a flag missing its value exits 2', async () => {
    expect((await runMain(['--cwd'])).code).toBe(2);
  });

  test('an invalid root exits 1 with a stderr-only, path-free reason', async () => {
    const { code, std } = await runMain(['--cwd', '/definitely/not/a/root', '--dir', 'docs/adr']);
    expect(code).toBe(1);
    expect(std.stdout).toBe('');
    expect(std.stderr).toContain('repository root');
  });

  test('an invalid dir under a valid root exits 1 naming the directory problem', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    const { code, std } = await runMain(['--cwd', repo.root, '--dir', 'no-such-subdir']);
    expect(code).toBe(1);
    expect(std.stderr).toContain('ADR directory');
  });

  test('a flag --cwd beats ADRKIT_MCP_CWD (dir error proves the flag root was used)', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    const { code, std } = await runMain(['--cwd', repo.root, '--dir', 'no-such'], { ADRKIT_MCP_CWD: '/definitely/not/a/root' });
    expect(code).toBe(1);
    expect(std.stderr).toContain('ADR directory'); // not "repository root" — the flag cwd resolved fine
  });

  test('env vars are used when no flag is given', async () => {
    const repo = await createRepo();
    cleanups.push(repo.cleanup);
    const { code, std } = await runMain([], { ADRKIT_MCP_CWD: repo.root, ADRKIT_MCP_DIR: 'no-such' });
    expect(code).toBe(1);
    expect(std.stderr).toContain('ADR directory');
  });

  test('a linked-worktree .git FILE is accepted as a root', async () => {
    const repo = await createRepo({ gitFile: true });
    cleanups.push(repo.cleanup);
    // dir invalid so we fail fast without starting a server; a root-not-git error would prove rejection.
    const { code, std } = await runMain(['--cwd', repo.root, '--dir', 'no-such']);
    expect(code).toBe(1);
    expect(std.stderr).toContain('ADR directory');
    expect(std.stderr).not.toContain('Git worktree');
  });
});

describe('adrkit-mcp bin — real stdio subprocess', () => {
  async function spawnClient(repo: TempRepo): Promise<Client> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN_SRC, '--cwd', repo.root],
    });
    const client = new Client({ name: 'bin-test', version: '0.0.0' });
    await client.connect(transport);
    cleanups.push(() => client.close());
    return client;
  }

  test('initialize / list / call / shutdown over real stdio', async () => {
    const repo = await repoFromFixture('edge-corpus');
    cleanups.push(repo.cleanup);
    const client = await spawnClient(repo);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual([
      'get_decision',
      'get_decision_context',
      'list_superseded',
      'search_decisions',
    ]);
    const call = await client.callTool({ name: 'list_superseded', arguments: {} });
    expect((call.structuredContent as { result: { outcome: string } }).result.outcome).toBe('entries');
  });

  test('stdout is line-by-line JSON-RPC only, with zero non-protocol bytes', async () => {
    const repo = await repoFromFixture('status-corpus');
    cleanups.push(repo.cleanup);
    const proc = Bun.spawn([process.execPath, BIN_SRC, '--cwd', repo.root], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const frames = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_decision', arguments: { ref: '0001' } } },
    ];
    proc.stdin.write(frames.map((f) => `${JSON.stringify(f)}\n`).join(''));
    await proc.stdin.end();
    const out = await new Response(proc.stdout).text();
    proc.kill();
    await proc.exited;
    const lines = out.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const ids = new Set<number>();
    for (const line of lines) {
      const message = JSON.parse(line); // throws if any non-JSON byte leaked to stdout
      expect(message.jsonrpc).toBe('2.0');
      if (typeof message.id === 'number') ids.add(message.id);
    }
    expect(ids.has(2)).toBe(true);
    expect(ids.has(3)).toBe(true);
  });
});
