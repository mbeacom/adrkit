import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The plugin package root, resolved from this file rather than from cwd. */
export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** The repository root, four levels up: test/ -> agent-plugin -> adapters -> packages. */
export const repoRoot = dirname(dirname(dirname(packageRoot)));

export const pluginManifestPath = join(packageRoot, '.claude-plugin', 'plugin.json');
export const apmManifestPath = join(packageRoot, 'apm.yml');
export const packageJsonPath = join(packageRoot, 'package.json');
export const marketplacePath = join(repoRoot, '.claude-plugin', 'marketplace.json');

/**
 * The components the plugin ships, by host-discovered convention. Named here
 * once so every test that asserts on them fails with the same vocabulary.
 */
export const COMMANDS = [
  'adr-context',
  'adr-check',
  'adr-draft',
  'adr-queue',
  'adr-backfill',
] as const;
export const AGENTS = ['decision-checker'] as const;
export const SKILLS = ['decision-memory', 'decision-backfill'] as const;

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/**
 * A deliberately small YAML reader for `apm.yml`. The package declares no
 * dependencies (see packaging.test.ts), so it cannot import a YAML parser, and
 * the manifest is flat scalars plus one inline list. Anything richer than that
 * should fail loudly here rather than be silently half-parsed.
 */
export function readFlatYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.length === 0 || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) continue; // nested block: not a top-level scalar
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    out[key as string] = (value ?? '').trim();
  }
  return out;
}

/** Split a `---` frontmatter block off a markdown component file. */
export function frontmatterOf(text: string): string {
  if (!text.startsWith('---\n')) return '';
  const end = text.indexOf('\n---', 3);
  return end === -1 ? '' : text.slice(4, end + 1);
}
