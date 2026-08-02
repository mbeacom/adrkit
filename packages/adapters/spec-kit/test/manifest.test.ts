import { describe, expect, test } from 'bun:test';
import { loadManifest } from './manifest-fixture.ts';

/**
 * The upstream validation rules from Spec Kit's EXTENSION-API-REFERENCE at the
 * commit spike 008 verified against (v0.13.0, 9a30db48). Upstream rejects a
 * manifest that breaks these at install time; failing here instead means the
 * break is found in CI rather than in someone else's terminal.
 */
const ID_PATTERN = /^[a-z0-9-]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const COMMAND_NAME_PATTERN = /^speckit\.[a-z0-9-]+\.[a-z0-9-]+$/;

describe('extension manifest', () => {
  const manifest = loadManifest();

  test('declares manifest schema version 1.0', () => {
    expect(manifest.schema_version).toBe('1.0');
  });

  test('extension id matches the upstream identifier pattern', () => {
    expect(manifest.extension.id).toBe('adrkit');
    expect(manifest.extension.id).toMatch(ID_PATTERN);
  });

  test('extension version is a bare semver triple', () => {
    expect(manifest.extension.version).toMatch(SEMVER_PATTERN);
  });

  test('description stays under the 200-character upstream limit', () => {
    // Asserting the real length, not just the bound, so a description that
    // silently emptied out cannot pass this by being trivially short.
    expect(manifest.extension.description.length).toBeGreaterThan(40);
    expect(manifest.extension.description.length).toBeLessThan(200);
  });

  test('required identity fields are populated', () => {
    expect(manifest.extension.author).toContain('mbeacom');
    expect(manifest.extension.repository).toBe('https://github.com/mbeacom/adrkit');
    expect(manifest.extension.license).toBe('Apache-2.0');
  });

  test('speckit_version is a bounded specifier, not a bare version', () => {
    // Bounded on both ends on purpose, and the upper bound is a verification
    // boundary rather than a guess: installed and rendered against 0.13.0
    // (spike 008), 0.14.4, and 0.15.1. Raising it means re-verifying against
    // the new minor first — breaking loudly on an unverified one is ADR-0007's
    // intended adapter behavior.
    expect(manifest.requires.speckit_version).toBe('>=0.13.0,<0.16.0');
  });

  test('declares the adr CLI as a required tool', () => {
    const tools = manifest.requires.tools ?? [];
    const adr = tools.find((tool) => tool.name === 'adr');
    expect(adr).toBeDefined();
    expect(adr?.required).toBe(true);
  });

  test('provides exactly the three intended commands', () => {
    // Pinning the exact set is what makes every per-command loop below
    // meaningful: a manifest that lost its commands fails here first, instead
    // of quietly satisfying every downstream check by having nothing to check.
    expect(manifest.provides.commands.map((command) => command.name)).toEqual([
      'speckit.adrkit.context',
      'speckit.adrkit.check',
      'speckit.adrkit.draft',
    ]);
  });

  test('every command name is namespaced under the extension id', () => {
    for (const command of manifest.provides.commands) {
      expect(command.name).toMatch(COMMAND_NAME_PATTERN);
      expect(command.name.split('.')[1]).toBe(manifest.extension.id);
    }
  });

  test('every command carries a non-placeholder description', () => {
    for (const command of manifest.provides.commands) {
      expect(command.description.length).toBeGreaterThan(20);
      expect(command.description).not.toMatch(/TODO|TBD|FIXME/i);
    }
  });
});
