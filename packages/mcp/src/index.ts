/**
 * @adrkit/mcp — public entry point.
 *
 * Exports ONLY the sealed stdio lifecycle factory and its option/handle types.
 * No SDK server, registration API, internal builder, transport, or test subpath is
 * reachable from here. No side effects at import time; no filesystem access at
 * construction time (data-model.md §8, contracts/tools.md §1).
 */

import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { resolve } from 'node:path';
import { buildRegisteredServer } from './server.ts';
import { resolveCanonicalRoots, MAX_SOURCE_BYTES } from './corpus/projection.ts';
import type { ToolConfig } from './tools/shared.ts';

export interface AdrkitMcpServerOptions {
  readonly cwd: string;
  readonly dir: string;
}

export interface AdrkitMcpServerHandle {
  start(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The public stdio lifecycle factory. Performs NO filesystem access at construction;
 * `start()` validates the configured root, then hands a closure-private server factory
 * to the SDK's connection-pinned `serveStdio` entry. The concrete server, its
 * registrations, and its transport remain unreachable to the caller.
 *
 * `serveStdio` — not a hand-wired `StdioServerTransport` — is what makes this server
 * speak protocol revision 2026-07-28. The opening exchange selects the connection's
 * era and pins one factory instance to it; `legacy: 'serve'` (the default) keeps
 * 2025-era clients working unchanged. The four tools are registered once and served
 * identically to both eras.
 */
export function createAdrkitMcpServer(
  options?: Partial<AdrkitMcpServerOptions>,
): Readonly<AdrkitMcpServerHandle> {
  const cwd = resolve(options?.cwd ?? process.cwd());
  const dir = options?.dir ?? 'docs/adr';

  let connection: StdioServerHandle | undefined;
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let closed = false;

  function start(): Promise<void> {
    if (closed) {
      return Promise.reject(new Error('adrkit MCP server handle is closed'));
    }
    if (startPromise) return startPromise;

    startPromise = (async () => {
      try {
        const roots = await resolveCanonicalRoots({ cwd, dir });
        const config: ToolConfig = {
          configuredCwd: cwd,
          configuredDir: dir,
          expectedCanonicalCwd: roots.canonicalCwd,
          maxSourceBytes: MAX_SOURCE_BYTES,
        };
        connection = serveStdio(() => buildRegisteredServer(config));
      } catch (error) {
        connection = undefined;
        startPromise = undefined;
        throw error;
      }
    })();
    return startPromise;
  }

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      if (startPromise) await startPromise;
      const current = connection;
      connection = undefined;
      if (current) await current.close();
    })();
    return closePromise;
  }

  const handle = Object.create(null) as AdrkitMcpServerHandle;
  handle.start = start;
  handle.close = close;
  return Object.freeze(handle);
}
