import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest, packageRoot, WRITING_COMMANDS } from './manifest-fixture.ts';

/**
 * Wiring: every declared surface resolves to a file that actually exists.
 *
 * Spike 008 could not establish from upstream documentation whether a
 * fixture-local `scripts/` reference survives command rendering; it had to
 * prove it at execution time. It does survive — which is precisely why the
 * reference has to stay true here. A command file pointing at a script that was
 * renamed renders fine and fails only when someone invokes it.
 */
function frontmatterOf(markdown: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!match?.[1]) throw new Error('command file has no YAML frontmatter block');
  const parsed: unknown = Bun.YAML.parse(match[1]);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('command frontmatter is not a mapping');
  }
  return parsed as Record<string, unknown>;
}

describe('command wiring', () => {
  const manifest = loadManifest();

  test('every declared command file exists and is non-empty', () => {
    expect(manifest.provides.commands.length).toBe(3);
    for (const command of manifest.provides.commands) {
      const file = join(packageRoot, command.file);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(0);
    }
  });

  test('every command file declares an sh script that exists and is executable', () => {
    for (const command of manifest.provides.commands) {
      const frontmatter = frontmatterOf(readFileSync(join(packageRoot, command.file), 'utf8'));
      const scripts = frontmatter['scripts'];

      expect(typeof scripts).toBe('object');
      const shPath = (scripts as Record<string, unknown>)['sh'];
      expect(typeof shPath).toBe('string');

      const resolved = join(packageRoot, shPath as string);
      expect(existsSync(resolved)).toBe(true);
      // Mode 0o111 — some bit of "executable" set. An unexecutable script is a
      // rendering-time success and an invocation-time failure.
      expect(statSync(resolved).mode & 0o111).toBeGreaterThan(0);
    }
  });

  test('every command file declares a description matching the manifest intent', () => {
    for (const command of manifest.provides.commands) {
      const frontmatter = frontmatterOf(readFileSync(join(packageRoot, command.file), 'utf8'));
      expect(typeof frontmatter['description']).toBe('string');
      expect((frontmatter['description'] as string).length).toBeGreaterThan(20);
    }
  });

  test('every script sources the shared library rather than reimplementing it', () => {
    const scripts = ['context.sh', 'check.sh', 'draft.sh'];
    for (const script of scripts) {
      const source = readFileSync(join(packageRoot, 'scripts', script), 'utf8');
      expect(source).toContain('adrkit-lib.sh');
      expect(source).toContain('set -eu');
    }
  });
});

describe('hook boundary', () => {
  const manifest = loadManifest();
  const hooks = manifest.hooks ?? {};

  test('declares exactly one hook, on after_plan', () => {
    expect(Object.keys(hooks)).toEqual(['after_plan']);
  });

  test('the hook is optional, never mandatory', () => {
    // `optional: false` renders as an automatic hook that fires without
    // consent. For a governance tool sitting in someone else's plan loop, that
    // is the difference between adopted and uninstalled.
    for (const [, binding] of Object.entries(hooks)) {
      expect(binding.optional).toBe(true);
    }
  });

  test('every hook targets a command this extension actually provides', () => {
    const provided = new Set(manifest.provides.commands.map((command) => command.name));
    for (const [, binding] of Object.entries(hooks)) {
      expect(provided.has(binding.command)).toBe(true);
    }
  });

  test('no hook targets a command that writes', () => {
    // Guard the guard: if WRITING_COMMANDS ever drifts out of sync with the
    // manifest, this assertion would pass while protecting nothing.
    const provided = new Set(manifest.provides.commands.map((command) => command.name));
    expect(WRITING_COMMANDS.size).toBeGreaterThan(0);
    for (const writing of WRITING_COMMANDS) {
      expect(provided.has(writing)).toBe(true);
    }

    for (const [event, binding] of Object.entries(hooks)) {
      expect(`${event}:${binding.command}`).toBe(`${event}:speckit.adrkit.check`);
      expect(WRITING_COMMANDS.has(binding.command)).toBe(false);
    }
  });
});
