/**
 * @adrkit/mcp — public entry point.
 *
 * Exports ONLY the sealed stdio lifecycle factory and its option/handle types.
 * No SDK server, registration API, internal builder, transport, or test subpath is
 * reachable from here. No side effects at import time; no filesystem access at
 * construction time (data-model.md §8, contracts/tools.md §1).
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
 * `start()` validates the configured root, builds the closure-private server, creates
 * exactly one `StdioServerTransport`, and connects it. The concrete server, its
 * registrations, and its transport remain unreachable to the caller.
 */
export function createAdrkitMcpServer(
  options?: Partial<AdrkitMcpServerOptions>,
): Readonly<AdrkitMcpServerHandle> {
  const cwd = resolve(options?.cwd ?? process.cwd());
  const dir = options?.dir ?? 'docs/adr';

  let server: McpServer | undefined;
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let closed = false;

  function start(): Promise<void> {
    if (closed) {
      return Promise.reject(new Error('adrkit MCP server handle is closed'));
    }
    if (startPromise) return startPromise;

    startPromise = (async () => {
      let nextServer: McpServer | undefined;
      try {
        const roots = await resolveCanonicalRoots({ cwd, dir });
        const config: ToolConfig = {
          configuredCwd: cwd,
          configuredDir: dir,
          expectedCanonicalCwd: roots.canonicalCwd,
          maxSourceBytes: MAX_SOURCE_BYTES,
        };
        nextServer = buildRegisteredServer(config);
        server = nextServer;
        await nextServer.connect(new StdioServerTransport());
      } catch (error) {
        server = undefined;
        if (nextServer) {
          try {
            await nextServer.close();
          } catch (closeError) {
            startPromise = undefined;
            throw new AggregateError([error, closeError], 'MCP server startup and cleanup failed');
          }
        }
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
      const current = server;
      server = undefined;
      if (current) await current.close();
    })();
    return closePromise;
  }

  const handle = Object.create(null) as AdrkitMcpServerHandle;
  handle.start = start;
  handle.close = close;
  return Object.freeze(handle);
}
