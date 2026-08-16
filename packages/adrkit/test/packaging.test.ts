import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const packageRoot = dirname(import.meta.dir);
const repoRoot = dirname(dirname(packageRoot));

type Manifest = {
  name?: string;
  version?: string;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
};

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Manifest;
const cliManifest = JSON.parse(
  readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'),
) as Manifest;

/**
 * This package exists to own a name and to run one command. Both of those are
 * properties of the *published* artifact rather than of any code path, so they
 * are asserted here rather than exercised.
 */
describe('adrkit forwarder packaging', () => {
  test('claims the unscoped name, which is the entire point', () => {
    expect(manifest.name).toBe('adrkit');
  });

  test('exposes exactly the adrkit binary', () => {
    expect(manifest.bin).toEqual({ adrkit: './dist/index.js' });
  });

  /**
   * A forwarder that lags its target is a forwarder that lies: `adrkit@0.7.0`
   * resolving to some other `@adrkit/cli` would report a version it is not
   * running. `workspace:*` keeps them equal by construction in development, and
   * release-pack rewrites it to the exact version at pack time.
   */
  test('tracks @adrkit/cli exactly, by workspace protocol', () => {
    expect(manifest.dependencies).toEqual({ '@adrkit/cli': 'workspace:*' });
  });

  test('is lockstep-versioned with @adrkit/cli', () => {
    expect(manifest.version).toBe(cliManifest.version);
  });

  /**
   * Regression: the first build of this package omitted the shebang, because
   * `bun build` only preserves one that is present in the entry source. npm
   * still linked `node_modules/.bin/adrkit`, and the shell then ran an ES
   * module as a shell script — `import { main } ...` resolved to `/usr/bin/
   * import`, so the binary "worked" by launching ImageMagick and exited 2. A
   * missing first line is invisible in every unit test and fatal on install,
   * which is exactly the class of defect this file is for.
   */
  test('entry source carries the node shebang on its first line', () => {
    const source = readFileSync(join(packageRoot, 'src', 'index.ts'), 'utf8');
    expect(source.split('\n')[0]).toBe('#!/usr/bin/env node');
  });
});
