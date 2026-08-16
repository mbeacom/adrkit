#!/usr/bin/env node

/**
 * The unscoped `adrkit` package: a forwarder to `@adrkit/cli`, and the reason
 * the name is not available to anyone else.
 *
 * `adr` on npm belongs to an unrelated package, so `npx adr` reaches a
 * different tool whenever adrkit's binary is not linked into
 * `node_modules/.bin` — silently, and in CI without a prompt, because npm
 * assumes `--yes` on a non-TTY. Publishing this name is what makes
 * `npx adrkit` resolve to adrkit by construction rather than by luck.
 *
 * It forwards in-process rather than spawning: `@adrkit/cli` exports `main`,
 * and its entry only self-executes when it is the process's main module, so
 * importing it here is inert until this module calls it. That keeps one
 * process, one exit code, and the caller's stdio.
 */
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { main } from '@adrkit/cli';

export { main };

/**
 * True when this module is the process entry rather than an import.
 *
 * Compares real paths because every install invokes this through a symlinked
 * `node_modules/.bin/adrkit`, which would otherwise never equal the module URL
 * it resolves to.
 */
export function isMainModule(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath || !existsSync(argvPath)) return false;
  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main();
}
