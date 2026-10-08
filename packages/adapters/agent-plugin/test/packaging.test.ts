import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { extensionFiles, packageJsonPath, packageRoot, readJson, repoRoot } from './harness.ts';

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
      'commands/adr-backfill.md',
      'skills/decision-memory/SKILL.md',
      'skills/decision-backfill/SKILL.md',
      'opencode/opencode.json',
      'extensions/adrkit/extension.mjs',
      'extensions/adrkit/review.mjs',
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

  test('retains the negative backfill contract fixture', () => {
    expect(
      existsSync(join(packageRoot, 'test', 'fixtures', 'unsafe-backfill-guidance.md')),
    ).toBe(true);
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

/**
 * The `adr-review` workflow extension (ADR-0045). Copilot forks it as a plain
 * Node process and resolves exactly one non-builtin module for it, the SDK. The
 * plugin ships no dependencies, so any other import fails at load time in a
 * consumer's session while every Bun-run test here stays green.
 */
describe('workflow extension packaging', () => {
  const files = extensionFiles();

  test('lives at the plugin root, where a .claude-plugin manifest is read', () => {
    // Measured against Copilot CLI 1.0.92: `com.github.copilot/extensions/` is
    // read only for Agent Plugins 1.0 manifests. A copy there is dead weight
    // that drifts from the one that loads.
    expect(existsSync(join(packageRoot, 'extensions', 'adrkit', 'extension.mjs'))).toBe(true);
    expect(existsSync(join(packageRoot, 'com.github.copilot'))).toBe(false);
  });

  test('ships only .mjs files', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect({ file, ext: file.endsWith('.mjs') }).toEqual({ file, ext: true });
  });

  test('imports only node builtins, its sibling, and (extension.mjs alone) the SDK', () => {
    // The SDK is allowed only in extension.mjs so review.mjs stays importable,
    // and testable, under Bun where the host's module resolver does not exist.
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const name = relative(packageRoot, file);
      const allowed = (specifier: string) =>
        specifier.startsWith('node:') ||
        specifier === './review.mjs' ||
        (basename(file) === 'extension.mjs' && specifier === '@github/copilot-sdk/extension');
      const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm)]
        .concat([...source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)])
        .map((match) => match[1] as string);
      expect({ name, disallowed: specifiers.filter((specifier) => !allowed(specifier)) }).toEqual({
        name,
        disallowed: [],
      });
      // Dynamic loading would slip past the static check above.
      expect({ name, dynamic: /\brequire\s*\(|\bimport\s*\(/.test(source) }).toEqual({
        name,
        dynamic: false,
      });
    }
  });

  test('references no Bun global, because Copilot runs it under Node', () => {
    // The same failure as `as-of.ts` once shipped: a `Bun.` reference is a
    // ReferenceError in every real run while the whole Bun-run suite passes.
    for (const file of files) {
      const name = relative(packageRoot, file);
      expect({ name, bun: /\bBun\./.test(readFileSync(file, 'utf8')) }).toEqual({ name, bun: false });
    }
  });

  test('never writes to stdout, which carries the JSON-RPC connection', () => {
    for (const file of files) {
      const name = relative(packageRoot, file);
      const source = readFileSync(file, 'utf8');
      expect({ name, stdout: /console\.log\s*\(|process\.stdout\.write/.test(source) }).toEqual({
        name,
        stdout: false,
      });
    }
  });
});
