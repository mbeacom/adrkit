import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkDependencyRules } from './check-deps.ts';
import { cleanupTestDir, resetTestDir, writeText } from '../packages/core/test/helpers.ts';

const DIR_NAME = 'check-deps';

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('core-has-no-adapter-deps', () => {
  test('passes on the current workspace tree', async () => {
    await expect(checkDependencyRules()).resolves.toEqual({ ok: true, violations: [] });
  });

  test('fails on a synthetic non-adapter dependency on an adapter', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/adapters/example/package.json'),
      JSON.stringify({ name: '@adrkit/adapter-example', version: '0.1.0' }, null, 2),
    );
    await writeText(
      join(root, 'packages/core/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/core',
          version: '0.1.0',
          dependencies: { zod: '^4', yaml: 'latest', '@adrkit/adapter-example': 'workspace:*' },
        },
        null,
        2,
      ),
    );

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.reason)).toContain(
      'non-adapter workspace depends on an adapter package',
    );
  });
});
