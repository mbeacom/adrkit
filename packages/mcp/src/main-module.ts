/**
 * @adrkit/mcp — CLI/startup helpers for the `adrkit-mcp` bin.
 *
 * The only place `process.argv`/`process.env` are read, the FR-036 startup check
 * lives, and the `isMainModule()` guard is defined. A local helper mirroring
 * `packages/cli/src/main-module.ts` (not imported from it). stdout is reserved for
 * protocol frames; every diagnostic goes to stderr.
 */

import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createAdrkitMcpServer } from './index.ts';
import { resolveCanonicalRoots, CorpusUnavailableError } from './corpus/projection.ts';
import { CORPUS_UNAVAILABLE_MESSAGES } from './tools/shared.ts';

export function isMainModule(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath || !existsSync(argvPath)) return false;
  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
}

const USAGE = 'usage: adrkit-mcp [--cwd <path>] [--dir <path>]\n';

function writeStderr(text: string): void {
  process.stderr.write(text);
}

export function reportUnhandledRejection(
  reason: unknown,
  write: (text: string) => void = writeStderr,
  fail: () => void = () => {
    process.exitCode = 1;
  },
): void {
  const detail = reason instanceof Error ? reason.message : String(reason);
  write(`adrkit-mcp: unhandled rejection: ${detail}\n`);
  fail();
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
): Promise<0 | 1 | 2> {
  let values: { cwd?: string; dir?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { cwd: { type: 'string' }, dir: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }

  const cwd = values.cwd ?? env.ADRKIT_MCP_CWD ?? process.cwd();
  const dir = values.dir ?? env.ADRKIT_MCP_DIR ?? 'docs/adr';

  // Fail-fast startup check (FR-036): validate the configured root before any transport.
  try {
    await resolveCanonicalRoots({ cwd, dir });
  } catch (error) {
    if (error instanceof CorpusUnavailableError) {
      writeStderr(`${CORPUS_UNAVAILABLE_MESSAGES[error.reason]}\n`);
      return 1;
    }
    throw error;
  }

  const handle = createAdrkitMcpServer({ cwd, dir });

  const shutdown = (): void => {
    void handle.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.on('unhandledRejection', (reason) => reportUnhandledRejection(reason));

  await handle.start();
  return 0;
}
