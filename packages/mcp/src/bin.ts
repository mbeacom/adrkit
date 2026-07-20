#!/usr/bin/env node
/**
 * @adrkit/mcp — the `adrkit-mcp` stdio entrypoint.
 *
 * Never imported by anything except the compiled `bin` entry itself. Reserves
 * stdout for protocol frames; all diagnostics go to stderr.
 */

import { isMainModule, main } from './main-module.ts';

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
