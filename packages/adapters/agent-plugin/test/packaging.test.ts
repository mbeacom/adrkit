import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { packageJsonPath, packageRoot, readJson, repoRoot } from './harness.ts';

/**
 * Packaging constraints imposed by how the hosts install a plugin.
 *
 * `copilot plugin install <path>` and `apm install path:` both copy this
 * directory. Neither skips `node_modules`, so the same rule the Spec Kit
 * adapter lives under applies here: a single declared dependency is enough for
 * Bun's isolated linker to create one, which then rides along into someone
 * else's machine.
 */
describe('packaging', () => {
  const packageJson = readJson(packageJsonPath);

  test('declares no dependencies of any kind', () => {
    for (const section of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      expect({ section, value: packageJson[section] }).toEqual({ section, value: undefined });
    }
  });

  test('carries no node_modules directory to copy into a consumer', () => {
    expect(existsSync(join(packageRoot, 'node_modules'))).toBe(false);
  });

  test('is private, because no host installs a plugin from npm', () => {
    // Copilot CLI, Claude Code, and APM all install from git. Publishing to npm
    // would add a second, staler path to the same bytes and a fourth version
    // field to keep in agreement.
    expect(packageJson['private']).toBe(true);
    expect(packageJson['publishConfig']).toBeUndefined();
  });

  test('is independently versioned, not pinned to the repository release', () => {
    // ADR-0007: an adapter's semver contract is with its upstream — here, the
    // plugin hosts — so it must not move with the lockstep tag.
    const repoVersion = readJson(join(repoRoot, 'package.json'))['version'];
    expect(packageJson['version']).not.toBe(repoVersion);
  });

  test('carries the license every install path can see', () => {
    // Sibling packages copy LICENSE and NOTICE into `dist` at build time. This
    // one has no build and is consumed by directory copy, so both files are
    // committed rather than generated.
    for (const name of ['LICENSE', 'NOTICE']) {
      const packaged = readFileSync(join(packageRoot, name), 'utf8');
      const canonical = readFileSync(join(repoRoot, name), 'utf8');
      expect({ name, identical: packaged === canonical }).toEqual({ name, identical: true });
      expect(packaged.length).toBeGreaterThan(100);
    }
  });

  test('ships every file an installed plugin needs at runtime', () => {
    // The install copies the directory, so these must exist on disk. There is
    // no `files` allowlist standing between the checkout and the consumer.
    for (const required of [
      '.claude-plugin/plugin.json',
      'apm.yml',
      'agents/decision-checker.md',
      'commands/adr-context.md',
      'commands/adr-check.md',
      'commands/adr-draft.md',
      'commands/adr-queue.md',
      'skills/decision-memory/SKILL.md',
      'opencode/opencode.json',
      'README.md',
      'LICENSE',
      'NOTICE',
    ]) {
      expect({ required, present: existsSync(join(packageRoot, required)) }).toEqual({
        required,
        present: true,
      });
    }
  });

  test('keeps .claude-plugin reserved for the manifest', () => {
    // Components live at the plugin root. A component parked beside the
    // manifest is invisible to both hosts' convention-based discovery, and the
    // manifest declares no paths that could rescue it.
    expect(readdirSync(join(packageRoot, '.claude-plugin'))).toEqual(['plugin.json']);
  });

  test('the opencode fragment stays consistent with the documented server', () => {
    // opencode's schema differs from the Copilot/Claude one in two ways that
    // are easy to get wrong: `command` is a single array rather than a command
    // plus args, and the environment block is spelled `environment`, not `env`.
    const fragment = readJson(join(packageRoot, 'opencode', 'opencode.json'));
    const server = (fragment['mcp'] as Record<string, Record<string, unknown>>)['adrkit'];

    expect(server?.['type']).toBe('local');
    expect(Array.isArray(server?.['command'])).toBe(true);
    expect((server?.['command'] as string[])[0]).toBe('npx');
    expect(server?.['environment']).toBeDefined();
    expect(server?.['env']).toBeUndefined();
  });
});
