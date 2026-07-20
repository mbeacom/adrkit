import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMainModule(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath || !existsSync(argvPath)) return false;
  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
}
