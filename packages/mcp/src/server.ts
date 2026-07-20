/**
 * @adrkit/mcp — internal server assembly (package-internal, never publicly exported).
 *
 * Owns the concrete `McpServer`, its registration APIs, and the in-memory builder
 * used only by in-process conformance tests. The public factory (`./index.ts`)
 * exposes only the sealed lifecycle handle. This module is absent from
 * `package.json#exports` and every public subpath.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSearchDecisions } from './tools/search-decisions.ts';
import { registerGetDecision } from './tools/get-decision.ts';
import { registerGetDecisionContext } from './tools/get-decision-context.ts';
import { registerListSuperseded } from './tools/list-superseded.ts';
import type { ToolConfig } from './tools/shared.ts';

export const SERVER_INFO = { name: '@adrkit/mcp', version: '0.1.0' } as const;

/** Package-internal: build the concrete server with exactly the four ratified tools. */
export function buildRegisteredServer(config: ToolConfig): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerSearchDecisions(server, config);
  registerGetDecision(server, config);
  registerGetDecisionContext(server, config);
  registerListSuperseded(server, config);
  return server;
}
