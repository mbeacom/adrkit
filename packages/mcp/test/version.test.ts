import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SERVER_INFO } from '../src/server.ts';

const PACKAGE_JSON = resolve(process.cwd(), 'packages/mcp/package.json');

describe('SERVER_INFO', () => {
  test('matches the published package version', async () => {
    const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as { version: string };
    expect(pkg.version).toBe(SERVER_INFO.version);
  });
});
