/**
 * @adrkit/mcp — offline test helpers.
 *
 * Provides the in-memory SDK client harness (research §R1.4), disposable
 * git-worktree corpora, complete-sandbox / parent-sentinel / HOME / TMPDIR
 * snapshots, a cursor-walk driver, and response-schema accessors. Everything
 * here is local, offline, model-free, and credential-free.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, realpath, stat, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_INFO } from '../src/server.ts';
import { MAX_SOURCE_BYTES } from '../src/corpus/projection.ts';
import type { ToolConfig } from '../src/tools/shared.ts';

export const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/* ------------------------------------------------------------------ *
 * In-memory SDK harness
 * ------------------------------------------------------------------ */

export interface OpenServer {
  readonly server: McpServer;
  readonly client: Client;
  close(): Promise<void>;
}

/** Connect an already-built McpServer to an in-process client. */
export async function connectServer(server: McpServer): Promise<OpenServer> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'adrkit-mcp-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    server,
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** Build a fresh McpServer, apply `register`, and connect an in-process client. */
export async function openServer(register: (server: McpServer) => void): Promise<OpenServer> {
  const server = new McpServer(SERVER_INFO);
  register(server);
  return connectServer(server);
}

/** Convenience: register a single tool with `config` and connect a client. */
export async function openTool(
  register: (server: McpServer, config: ToolConfig) => void,
  config: ToolConfig,
): Promise<OpenServer> {
  return openServer((server) => register(server, config));
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

// biome-ignore lint: test accessor
export function resultOf(res: CallToolResult): any {
  return (res.structuredContent as { result?: unknown } | undefined)?.result;
}

// biome-ignore lint: test accessor
export function healthOf(res: CallToolResult): any {
  return (res.structuredContent as { corpusHealth?: unknown } | undefined)?.corpusHealth;
}

export function textOf(res: CallToolResult): string {
  const first = res.content?.[0];
  return first && first.type === 'text' ? first.text : '';
}

/* ------------------------------------------------------------------ *
 * Disposable git-worktree corpora
 * ------------------------------------------------------------------ */

export interface TempRepo {
  readonly root: string; // realpath'd
  readonly dir: string; // 'docs/adr' by default
  readonly adrDir: string; // absolute path to the ADR directory
  cleanup(): Promise<void>;
}

/** Create a disposable repo root with a `.git` directory and an empty ADR dir. */
export async function createRepo(options: { dir?: string; gitFile?: boolean } = {}): Promise<TempRepo> {
  const dir = options.dir ?? 'docs/adr';
  const created = await mkdtemp(join(tmpdir(), 'adrkit-mcp-'));
  const root = await realpath(created);
  if (options.gitFile) {
    await writeFile(join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n', 'utf8');
  } else {
    await mkdir(join(root, '.git'), { recursive: true });
  }
  const adrDir = join(root, dir);
  await mkdir(adrDir, { recursive: true });
  return {
    root,
    dir,
    adrDir,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Write named markdown files into a repo's ADR directory. */
export async function writeRecords(repo: TempRepo, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(repo.adrDir, name), content, 'utf8');
  }
}

/** Copy one committed fixture corpus into a fresh disposable repo's ADR directory. */
export async function repoFromFixture(
  fixtureName: 'status-corpus' | 'edge-corpus' | 'degraded-corpus',
  options: { dir?: string; gitFile?: boolean } = {},
): Promise<TempRepo> {
  const repo = await createRepo(options);
  const source = join(FIXTURES_DIR, fixtureName);
  for (const entry of await readdir(source)) {
    if (!entry.endsWith('.md')) continue;
    await cp(join(source, entry), join(repo.adrDir, entry));
  }
  return repo;
}

/** Build a `ToolConfig` for a repo root, mirroring `resolveCanonicalRoots`' contract. */
export async function toolConfig(root: string, dir = 'docs/adr'): Promise<ToolConfig> {
  const canonicalCwd = await realpath(root);
  return {
    configuredCwd: root,
    configuredDir: dir,
    expectedCanonicalCwd: canonicalCwd,
    maxSourceBytes: MAX_SOURCE_BYTES,
  };
}

/* ------------------------------------------------------------------ *
 * Filesystem snapshots (boundary / side-effect evidence)
 * ------------------------------------------------------------------ */

export type FsSnapshot = Map<string, string>;

async function snapshotEntry(path: string): Promise<string> {
  const info = await stat(path);
  if (info.isDirectory()) return `dir:${(info.mode & 0o7777).toString(8)}`;
  const bytes = await readFile(path);
  const sha = createHash('sha256').update(bytes).digest('hex');
  return `file:${info.size}:${(info.mode & 0o7777).toString(8)}:${sha}`;
}

/** Complete byte/mode snapshot of a directory tree. */
export async function snapshotTree(root: string): Promise<FsSnapshot> {
  const snapshot: FsSnapshot = new Map();
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      snapshot.set(rel, await snapshotEntry(abs));
      if (entry.isDirectory()) await walk(abs, rel);
    }
  }
  await walk(root, '');
  return snapshot;
}

/** Snapshot an explicit set of paths (parent sentinels, HOME, TMPDIR files). */
export async function snapshotPaths(paths: readonly string[]): Promise<FsSnapshot> {
  const snapshot: FsSnapshot = new Map();
  for (const path of paths) {
    try {
      snapshot.set(path, await snapshotEntry(path));
    } catch {
      snapshot.set(path, 'absent');
    }
  }
  return snapshot;
}

export function diffSnapshots(before: FsSnapshot, after: FsSnapshot): string[] {
  const changes: string[] = [];
  for (const [key, value] of before) {
    if (after.get(key) !== value) changes.push(`changed:${key}`);
  }
  for (const key of after.keys()) {
    if (!before.has(key)) changes.push(`added:${key}`);
  }
  return changes;
}

/* ------------------------------------------------------------------ *
 * Cursor-walk driver
 * ------------------------------------------------------------------ */

export interface WalkPage<T> {
  readonly items: readonly T[];
  readonly cursor: string | null;
}

/** Drive a paginated channel to completion, collecting every item exactly once. */
export async function walkChannel<T>(
  step: (cursor: string | undefined) => Promise<WalkPage<T>>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 10_000; guard += 1) {
    const page = await step(cursor);
    all.push(...page.items);
    if (page.cursor == null) return all;
    cursor = page.cursor;
  }
  throw new Error('walkChannel exceeded its page guard');
}

export function makeOversizedRecord(id: string, bytes = MAX_SOURCE_BYTES + 1): string {
  const header = `---\nschemaVersion: 0.1.0\nid: "${id}"\ntitle: Oversized record ${id}\nstatus: draft\ndate: 2026-01-01\n---\n\n`;
  return header + 'x'.repeat(Math.max(0, bytes - header.length));
}
