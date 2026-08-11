/**
 * @adrkit/mcp — internal server assembly (package-internal, never publicly exported).
 *
 * Owns the concrete `McpServer`, its registration APIs, and the in-memory builder
 * used only by in-process conformance tests. The public factory (`./index.ts`)
 * exposes only the sealed lifecycle handle. This module is absent from
 * `package.json#exports` and every public subpath.
 */

import { McpServer, type ServerOptions } from '@modelcontextprotocol/server';
import { registerSearchDecisions } from './tools/search-decisions.ts';
import { registerGetDecision } from './tools/get-decision.ts';
import { registerGetDecisionContext } from './tools/get-decision-context.ts';
import { registerListSuperseded } from './tools/list-superseded.ts';
import type { ToolConfig } from './tools/shared.ts';

export const SERVER_INFO = { name: '@adrkit/mcp', version: '0.6.0' } as const;

/**
 * The MCP protocol revision this server serves through `serveStdio`'s modern era.
 *
 * The SDK keeps the revision string internal (`LATEST_PROTOCOL_VERSION` names the
 * latest *legacy*-era version, `2025-11-25`), so the modern revision is stated here
 * once and asserted against the wire in `test/bin.test.ts`.
 */
export const MODERN_PROTOCOL_VERSION = '2026-07-28' as const;

/**
 * SEP-2549 cache hints for the two cacheable results this server can answer.
 *
 * Both are immutable for the lifetime of the process and carry no corpus content,
 * caller identity, or per-request state: `tools/list` is the four ratified tools with
 * their fixed schemas and annotations, and `server/discover` is the supported
 * revisions plus the tools capability. They are therefore honestly `public` and safe
 * to cache, which spares an agent a round trip per re-list. Corpus reads are NOT
 * cacheable and are unaffected — every `tools/call` still loads a fresh projection.
 *
 * Without this the SDK falls back to the conservative `{ ttlMs: 0, cacheScope:
 * 'private' }`. 2025-era responses never carry these fields either way.
 */
const CACHE_HINTS = {
  'tools/list': { ttlMs: 300_000, cacheScope: 'public' },
  'server/discover': { ttlMs: 300_000, cacheScope: 'public' },
} as const satisfies ServerOptions['cacheHints'];

/**
 * Package-internal: build the concrete server with exactly the four ratified tools.
 *
 * Registration order is lexicographic by tool name so `tools/list` answers in a
 * deterministic, self-evidently stable order (2026-07-28 minor change 3 — servers
 * SHOULD do this so clients can cache catalogs and keep upstream prompt caches warm).
 */
export function buildRegisteredServer(config: ToolConfig): McpServer {
  const server = new McpServer(SERVER_INFO, { cacheHints: CACHE_HINTS });
  registerGetDecision(server, config);
  registerGetDecisionContext(server, config);
  registerListSuperseded(server, config);
  registerSearchDecisions(server, config);
  return server;
}
