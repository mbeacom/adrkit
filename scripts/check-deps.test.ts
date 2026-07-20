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

  test('allows only vetted deterministic core dependencies', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/core/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/core',
          version: '0.1.0',
          dependencies: { picomatch: '^4', semver: '^7', yaml: 'latest', zod: '^4' },
          devDependencies: {
            '@types/bun': 'latest',
            '@types/picomatch': '^4',
            '@types/semver': '^7',
          },
        },
        null,
        2,
      ),
    );

    await expect(checkDependencyRules(root)).resolves.toEqual({ ok: true, violations: [] });
  });

  test('allows the ci surface to depend on core and the GitHub toolkit', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/ci/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/ci',
          version: '0.1.0',
          dependencies: { '@adrkit/core': 'workspace:*', '@actions/core': '^1.11.1', '@actions/github': '^6.0.1' },
          devDependencies: { '@types/bun': 'latest' },
        },
        null,
        2,
      ),
    );

    await expect(checkDependencyRules(root)).resolves.toEqual({ ok: true, violations: [] });
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

  test('fails when the GitHub toolkit reaches core', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/core/package.json'),
      JSON.stringify(
        { name: '@adrkit/core', version: '0.1.0', dependencies: { zod: '^4', yaml: 'latest', '@actions/github': '^6' } },
        null,
        2,
      ),
    );

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.reason)).toContain(
      'GitHub Action toolkit must stay confined to @adrkit/ci and never reach core/schema/cli',
    );
  });

  test('fails when the CLI pulls in the GitHub toolkit', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/cli/package.json'),
      JSON.stringify(
        { name: '@adrkit/cli', version: '0.1.0', dependencies: { '@adrkit/core': 'workspace:*', '@actions/core': '^1' } },
        null,
        2,
      ),
    );

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.reason)).toContain(
      'GitHub Action toolkit must stay confined to @adrkit/ci and never reach core/schema/cli',
    );
  });
});

describe('evaluator dependency boundary (Phase 4)', () => {
  test('allows the approved chain @adrkit/cli -> @adrkit/evaluator -> @adrkit/core with only the vetted engine', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/evaluator/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/evaluator',
          version: '0.1.0',
          dependencies: { '@adrkit/core': 'workspace:*', 'jsonpath-rfc9535': '1.3.0' },
          devDependencies: { '@types/bun': 'latest' },
        },
        null,
        2,
      ),
    );
    await writeText(
      join(root, 'packages/cli/package.json'),
      JSON.stringify(
        { name: '@adrkit/cli', version: '0.1.0', dependencies: { '@adrkit/core': 'workspace:*', '@adrkit/evaluator': 'workspace:*' }, devDependencies: { '@types/bun': 'latest' } },
        null,
        2,
      ),
    );
    await expect(checkDependencyRules(root)).resolves.toEqual({ ok: true, violations: [] });
  });

  test('rejects an evaluator dependency outside the vetted engine allow-list', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/evaluator/package.json'),
      JSON.stringify(
        { name: '@adrkit/evaluator', version: '0.1.0', dependencies: { '@adrkit/core': 'workspace:*', 'jsonpath-plus': '^10' } },
        null,
        2,
      ),
    );
    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.reason)).toContain(
      '@adrkit/evaluator declares a dependency outside its allowed public surface',
    );
  });

  test('rejects the evaluator importing an adapter package', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/adapters/example/package.json'),
      JSON.stringify({ name: '@adrkit/adapter-example', version: '0.1.0' }, null, 2),
    );
    await writeText(
      join(root, 'packages/evaluator/package.json'),
      JSON.stringify(
        { name: '@adrkit/evaluator', version: '0.1.0', dependencies: { '@adrkit/core': 'workspace:*', '@adrkit/adapter-example': 'workspace:*' } },
        null,
        2,
      ),
    );
    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    const reasons = result.violations.map((v) => v.reason);
    expect(reasons).toContain('non-adapter workspace depends on an adapter package');
  });

  test('rejects the evaluator pulling in the GitHub toolkit', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/evaluator/package.json'),
      JSON.stringify(
        { name: '@adrkit/evaluator', version: '0.1.0', dependencies: { '@adrkit/core': 'workspace:*', '@actions/github': '^6' } },
        null,
        2,
      ),
    );
    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.reason)).toContain(
      'GitHub Action toolkit must stay confined to @adrkit/ci and never reach core/schema/cli',
    );
  });

  test('rejects reversing the one-way graph (evaluator depending on the CLI)', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/evaluator/package.json'),
      JSON.stringify(
        { name: '@adrkit/evaluator', version: '0.1.0', dependencies: { '@adrkit/core': 'workspace:*', '@adrkit/cli': 'workspace:*' } },
        null,
        2,
      ),
    );
    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.reason)).toContain(
      '@adrkit/evaluator declares a dependency outside its allowed public surface',
    );
  });

  test('rejects a network/filesystem client in the evaluator', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/evaluator/package.json'),
      JSON.stringify(
        { name: '@adrkit/evaluator', version: '0.1.0', dependencies: { '@adrkit/core': 'workspace:*', undici: '^6', 'fast-glob': '^3' } },
        null,
        2,
      ),
    );
    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    const outside = result.violations.filter((v) => v.reason.includes('outside its allowed public surface'));
    expect(outside.map((v) => v.dependency).sort()).toEqual(['fast-glob', 'undici']);
  });
});
