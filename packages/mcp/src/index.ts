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
  const cwd = options?.cwd ?? process.cwd();
  const dir = options?.dir ?? 'docs/adr';

  let server: McpServer | undefined;

  async function start(): Promise<void> {
    const roots = await resolveCanonicalRoots({ cwd, dir });
    const config: ToolConfig = {
      configuredCwd: roots.canonicalCwd,
      configuredDir: dir,
      expectedCanonicalCwd: roots.canonicalCwd,
      maxSourceBytes: MAX_SOURCE_BYTES,
    };
    server = buildRegisteredServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  async function close(): Promise<void> {
    if (server) await server.close();
  }

  const handle = Object.create(null) as AdrkitMcpServerHandle;
  handle.start = start;
  handle.close = close;
  return Object.freeze(handle);
}
