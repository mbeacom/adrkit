import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { isMainModule } from '../src/index.ts';

const DIR_NAME = 'cli-main-module';

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('CLI main-module detection', () => {
  test('recognizes an installed package-manager bin symlink', async () => {
    const root = await resetTestDir(DIR_NAME);
    const target = join(root, 'dist', 'index.js');
    const bin = join(root, 'node_modules', '.bin', 'adr');
    await writeText(target, '#!/usr/bin/env node\n');
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true });
    await symlink(target, bin);

    expect(isMainModule(pathToFileURL(target).href, bin)).toBe(true);
  });

  test('rejects a missing argv path', () => {
    expect(isMainModule(import.meta.url, undefined)).toBe(false);
  });
});
