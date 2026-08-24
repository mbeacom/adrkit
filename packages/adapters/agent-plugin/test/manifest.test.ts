import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  apmManifestPath,
  marketplacePath,
  packageJsonPath,
  packageRoot,
  pluginManifestPath,
  readFlatYaml,
  readJson,
} from './harness.ts';

const plugin = readJson(pluginManifestPath);
const pkg = readJson(packageJsonPath);
const apm = readFlatYaml(readFileSync(apmManifestPath, 'utf8'));
const marketplace = readJson(marketplacePath);

describe('manifest agreement', () => {
  test('all three manifests carry the same name', () => {
    // `name` is the install and uninstall handle on every host. A divergence
    // means `copilot plugin uninstall <what plugin.json says>` cannot remove
    // what `apm install` deployed.
    expect({
      plugin: plugin['name'],
      apm: apm['name'],
    }).toEqual({ plugin: 'adrkit', apm: 'adrkit' });
  });

  test('all three manifests carry the same version', () => {
    // Claude Code keys its plugin cache on plugin.json's `version`, so shipped
    // content moving without a bump is content users never receive. The sibling
    // Spec Kit adapter shipped 0.1.1 with two version fields diverged and told
    // every user the wrong number; there are three fields in play here, so this
    // asserts on all of them at once rather than pairwise.
    const version = plugin['version'];
    expect(typeof version).toBe('string');
    expect({ plugin: version, apm: apm['version'], packageJson: pkg['version'] }).toEqual({
      plugin: version,
      apm: version as string,
      packageJson: version,
    });
  });

  test('the marketplace entry agrees with the plugin it points at', () => {
    // A catalog that advertises a different version or a path with no plugin at
    // the end of it fails at install time, in someone else's terminal.
    const plugins = marketplace['plugins'] as Array<Record<string, unknown>>;
    const entry = plugins.find((candidate) => candidate['name'] === plugin['name']);

    expect(entry).toBeDefined();
    expect({ version: entry?.['version'], source: entry?.['source'] }).toEqual({
      version: plugin['version'],
      source: './packages/adapters/agent-plugin',
    });
  });

  test('shared metadata is aligned across hosts', () => {
    // `description` is allowed to differ — plugin.json carries the fuller
    // marketplace copy and apm.yml the shorter CLI-listing one — but the
    // license and provenance fields are claims about the same artifact and
    // must not disagree between two files a user might read.
    expect({ license: apm['license'], homepage: apm['homepage'] }).toEqual({
      license: plugin['license'] as string,
      homepage: plugin['homepage'] as string,
    });
    expect(apm['description']).not.toBe(plugin['description']);
  });
});

describe('manifest shape the hosts actually accept', () => {
  test('declares no component path fields', () => {
    // Measured, not inferred. `agents`/`skills`/`commands` are documented
    // Copilot CLI fields accepting a string or an array, but `claude plugin
    // validate` rejects the string form outright ("commands: Invalid input").
    // Both hosts discover agents/, skills/, and commands/ by convention, so the
    // only shape that loads everywhere is to declare none of them. Re-adding
    // one breaks Claude Code without breaking Copilot, which is exactly the
    // kind of asymmetry nobody notices until a user reports it.
    for (const field of ['agents', 'skills', 'commands', 'extensions', 'lspServers']) {
      expect({ field, value: plugin[field] }).toEqual({ field, value: undefined });
    }
  });

  test('keeps `category` in the marketplace entry, not the plugin manifest', () => {
    // Claude Code's validator warns that `category` belongs to the catalog
    // entry and is ignored in plugin.json. Keeping one copy, in the place that
    // reads it, avoids two values that can drift apart.
    expect(plugin['category']).toBeUndefined();
    const plugins = marketplace['plugins'] as Array<Record<string, unknown>>;
    expect(plugins[0]?.['category']).toBe('process');
  });

  test('ships no MCP wiring', () => {
    // Not an oversight, and not a gap to be helpfully filled in later.
    // Copilot CLI spawns a plugin's MCP servers with a working directory that
    // is neither the workspace nor any Git repository, and exports nothing
    // naming the repository; the adrkit server requires a Git worktree root, so
    // it exits during `initialize` and logs `Failed to start MCP client for
    // adrkit` every session. A server that cannot start is worse than one that
    // was never configured. See README.md and ADR-0028; MCP is wired per
    // project, where the working directory is correct.
    expect(plugin['mcpServers']).toBeUndefined();
    expect(existsSync(join(packageRoot, '.mcp.json'))).toBe(false);
  });

  test('carries no JSON comment keys', () => {
    // JSON has no comments. `"//"` keys survive Copilot's loader but Claude
    // Code's validator reports them as unknown fields, so the reasoning goes in
    // README.md instead. package.json is exempt: npm tooling tolerates them and
    // it is not read by any plugin host.
    for (const [label, doc] of [
      ['plugin.json', plugin],
      ['marketplace.json', marketplace],
    ] as const) {
      const commentKeys = Object.keys(doc).filter((key) => key.startsWith('//'));
      expect({ label, commentKeys }).toEqual({ label, commentKeys: [] });
    }
  });
});
