import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const manifestPath = join(packageRoot, 'extension.yml');

export interface ProvidedCommand {
  name: string;
  file: string;
  description: string;
  aliases?: string[];
}

export interface HookBinding {
  command: string;
  optional?: boolean;
  priority?: number;
  prompt?: string;
  description?: string;
  condition?: string;
}

export interface ExtensionManifest {
  schema_version: string;
  extension: {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    repository: string;
    license: string;
    homepage?: string;
    category?: string;
    effect?: string;
  };
  requires: {
    speckit_version: string;
    tools?: { name: string; version?: string; required?: boolean }[];
  };
  provides: { commands: ProvidedCommand[] };
  hooks?: Record<string, HookBinding>;
}

function fail(what: string): never {
  throw new Error(`extension.yml is unreadable as a manifest: ${what}`);
}

/**
 * Parse the manifest and assert only the structure the tests need in order to
 * ask real questions of it. A malformed manifest must blow up here, loudly —
 * never degrade into an empty command list that every downstream `for` loop
 * then passes over vacuously (ADR-0016).
 */
export function loadManifest(): ExtensionManifest {
  const parsed: unknown = Bun.YAML.parse(readFileSync(manifestPath, 'utf8'));

  if (typeof parsed !== 'object' || parsed === null) fail('top level is not a mapping');
  const root = parsed as Record<string, unknown>;

  const provides = root['provides'];
  if (typeof provides !== 'object' || provides === null) fail('provides is missing');
  const commands = (provides as Record<string, unknown>)['commands'];
  if (!Array.isArray(commands)) fail('provides.commands is not a list');
  if (commands.length === 0) fail('provides.commands is empty');

  const extension = root['extension'];
  if (typeof extension !== 'object' || extension === null) fail('extension is missing');

  const requires = root['requires'];
  if (typeof requires !== 'object' || requires === null) fail('requires is missing');

  return parsed as ExtensionManifest;
}

/** Commands whose scripts write to the repository. Hooks may never reach these. */
export const WRITING_COMMANDS: ReadonlySet<string> = new Set(['speckit.adrkit.draft']);
