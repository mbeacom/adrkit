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

describe('catalog adapter and consumer dependency boundary (feature 010)', () => {
  const ADAPTER_MANIFEST = 'packages/adapters/catalog-backstage/package.json';
  const CONSUMER_MANIFEST = 'packages/catalog-envelope/package.json';

  function adapterManifest(extra: Record<string, string> = {}): string {
    return JSON.stringify(
      {
        name: '@adrkit/catalog-backstage',
        version: '0.0.0',
        dependencies: { '@adrkit/core': 'workspace:*', picomatch: '^4', yaml: 'latest', ...extra },
        devDependencies: { '@types/bun': 'latest', '@types/picomatch': '^4' },
      },
      null,
      2,
    );
  }

  function consumerManifest(extra: Record<string, string> = {}): string {
    return JSON.stringify(
      {
        name: '@adrkit/catalog-envelope',
        version: '0.0.0',
        dependencies: { '@adrkit/core': 'workspace:*', ...extra },
        devDependencies: { '@types/bun': 'latest' },
      },
      null,
      2,
    );
  }

  test('allows exactly the surfaces package-boundary.md §2 freezes for both packages', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, ADAPTER_MANIFEST), adapterManifest());
    await writeText(join(root, CONSUMER_MANIFEST), consumerManifest());
    await expect(checkDependencyRules(root)).resolves.toEqual({ ok: true, violations: [] });
  });

  // T009 / SC-015 — a deliberately introduced edge from core, then the CLI, onto
  // the adapter. Observed failing against the real workspace tree before being
  // recorded here; these are the retained inputs (ADR-0016 clause 2).
  test('rejects @adrkit/core depending on the catalog adapter', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, ADAPTER_MANIFEST), adapterManifest());
    await writeText(
      join(root, 'packages/core/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/core',
          version: '0.1.0',
          dependencies: {
            picomatch: '^4',
            semver: '^7',
            yaml: 'latest',
            zod: '^4',
            '@adrkit/catalog-backstage': 'workspace:*',
          },
        },
        null,
        2,
      ),
    );

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.reason).sort()).toEqual([
      '@adrkit/core declares a dependency outside its allowed public surface',
      'non-adapter workspace depends on an adapter package',
    ]);
  });

  test('rejects @adrkit/cli depending on the catalog adapter', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, ADAPTER_MANIFEST), adapterManifest());
    await writeText(
      join(root, 'packages/cli/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/cli',
          version: '0.1.0',
          dependencies: {
            '@adrkit/core': 'workspace:*',
            '@adrkit/evaluator': 'workspace:*',
            '@adrkit/catalog-backstage': 'workspace:*',
          },
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

  test('does NOT see a manifest-less directory such as schema/, and this records that limitation', async () => {
    // FR-003 covers `schema/` as well as core and the CLI, but `schema/` carries
    // no package.json, so `readWorkspacePackages()` never visits it and this
    // check cannot express the rule for it. Observed directly: adding
    // `import … from '@adrkit/catalog-backstage'` to `schema/adr.schema.ts` in
    // the real tree leaves `bun run check:deps` at exit 0, printing
    // `core-has-no-adapter-deps: ok`.
    //
    // The clause is held instead by `bunfig.toml`'s `linker = "isolated"` — root
    // level files get no `node_modules/@adrkit/`, so the same edge fails
    // `bun run typecheck` with `TS2307: Cannot find module
    // '@adrkit/catalog-backstage'`. That is Constitution Principle III's stated
    // reason the isolated linker is load-bearing, observed working.
    //
    // Recorded as a specific observed value rather than left as an assumption
    // that this check covers schema/, which it does not (ADR-0016 clause 3).
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, ADAPTER_MANIFEST), adapterManifest());
    await writeText(
      join(root, 'schema/adr.schema.ts'),
      "import { PACKAGE_NAME } from '@adrkit/catalog-backstage';\nexport const leaked = PACKAGE_NAME;\n",
    );

    await expect(checkDependencyRules(root)).resolves.toEqual({ ok: true, violations: [] });
  });

  // T010 / FR-044 direction (i) — the consumer must not reach the adapter.
  test('rejects @adrkit/catalog-envelope depending on the adapter', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, ADAPTER_MANIFEST), adapterManifest());
    await writeText(
      join(root, CONSUMER_MANIFEST),
      consumerManifest({ '@adrkit/catalog-backstage': 'workspace:*' }),
    );

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.reason).sort()).toEqual([
      '@adrkit/catalog-envelope declares a dependency outside its allowed public surface',
      'non-adapter workspace depends on an adapter package',
    ]);
  });

  // T011 / FR-044 direction (ii) — the adapter must not reach the consumer. Only
  // the allowed-surface guard fires here: the adapter *is* an adapter package, so
  // the non-adapter guard correctly does not apply, and the allowlist is the only
  // thing standing between the two packages in this direction.
  test('rejects the adapter depending on @adrkit/catalog-envelope', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, ADAPTER_MANIFEST),
      adapterManifest({ '@adrkit/catalog-envelope': 'workspace:*' }),
    );
    await writeText(join(root, CONSUMER_MANIFEST), consumerManifest());

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.reason)).toEqual([
      '@adrkit/catalog-backstage declares a dependency outside its allowed public surface',
    ]);
  });

  // T012 — the only proof the two allowlist entries actually exist. A package
  // with no entry is silently unconstrained (`check-deps.ts` returns undefined
  // and the allowed-surface guard is skipped), so a green check on such a package
  // is evidence of nothing. Each entry is proven present by watching a disallowed
  // dependency produce a violation.
  test('proves the adapter allowlist entry exists, by rejecting a disallowed dependency', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, ADAPTER_MANIFEST), adapterManifest({ undici: '^6' }));

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => `${violation.dependency}: ${violation.reason}`)).toEqual([
      'undici: @adrkit/catalog-backstage declares a dependency outside its allowed public surface',
    ]);
  });

  test('proves the consumer allowlist entry exists, by rejecting a disallowed dependency', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, CONSUMER_MANIFEST), consumerManifest({ undici: '^6' }));

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => `${violation.dependency}: ${violation.reason}`)).toEqual([
      'undici: @adrkit/catalog-envelope declares a dependency outside its allowed public surface',
    ]);
  });

  test('the trap itself: a package with no allowlist entry passes with the same disallowed dependency', async () => {
    // This is what makes the two tests above mean something. Observed directly in
    // the real tree: removing the adapter's `allowedDependenciesFor()` entry while
    // leaving `undici` declared returns `check:deps` to exit 0 and
    // `core-has-no-adapter-deps: ok` — the identical output a clean tree produces.
    // Absence of a rule and a satisfied rule are the same string here, which is
    // exactly why package-boundary.md §4 calls the omission a green check that
    // means nothing.
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/adapters/unlisted/package.json'),
      JSON.stringify(
        { name: '@adrkit/adapter-unlisted', version: '0.1.0', dependencies: { undici: '^6' } },
        null,
        2,
      ),
    );

    await expect(checkDependencyRules(root)).resolves.toEqual({ ok: true, violations: [] });
  });
});

describe('mcp dependency boundary (Phase 5)', () => {
  test('allows exactly core, the pinned SDK server, and zod, plus the dev-only SDK client and @types/bun', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/mcp/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/mcp',
          version: '0.1.0',
          dependencies: { '@adrkit/core': 'workspace:*', '@modelcontextprotocol/server': '2.0.0', zod: '^4' },
          devDependencies: { '@modelcontextprotocol/client': '2.0.0', '@types/bun': 'latest' },
        },
        null,
        2,
      ),
    );
    await expect(checkDependencyRules(root)).resolves.toEqual({ ok: true, violations: [] });
  });

  test('rejects an adapter, network/auth/model/embedding/db/cache lib, native addon, or worker helper', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/adapters/example/package.json'),
      JSON.stringify({ name: '@adrkit/adapter-example', version: '0.1.0' }, null, 2),
    );
    await writeText(
      join(root, 'packages/mcp/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/mcp',
          version: '0.1.0',
          dependencies: {
            '@adrkit/core': 'workspace:*',
            '@modelcontextprotocol/server': '2.0.0',
            zod: '^4',
            '@adrkit/adapter-example': 'workspace:*',
            undici: '^6',
            jose: '^5',
            openai: '^4',
            '@xenova/transformers': '^2',
            pg: '^8',
            ioredis: '^5',
            'node-gyp': '^10',
            piscina: '^4',
          },
        },
        null,
        2,
      ),
    );
    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    const outside = result.violations
      .filter((v) => v.reason.includes('outside its allowed public surface'))
      .map((v) => v.dependency)
      .sort();
    expect(outside).toEqual(['@adrkit/adapter-example', '@xenova/transformers', 'ioredis', 'jose', 'node-gyp', 'openai', 'pg', 'piscina', 'undici']);
    expect(result.violations.some((v) => v.reason === 'non-adapter workspace depends on an adapter package')).toBe(true);
  });

  test('rejects an undeclared SDK subpath package masquerading as the SDK', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/mcp/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/mcp',
          version: '0.1.0',
          dependencies: { '@adrkit/core': 'workspace:*', '@modelcontextprotocol/server': '2.0.0', zod: '^4', '@modelcontextprotocol/server-everything': '^1' },
        },
        null,
        2,
      ),
    );
    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.dependency)).toContain('@modelcontextprotocol/server-everything');
  });

  test('rejects the GitHub toolkit reaching the mcp surface', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/mcp/package.json'),
      JSON.stringify(
        { name: '@adrkit/mcp', version: '0.1.0', dependencies: { '@adrkit/core': 'workspace:*', '@modelcontextprotocol/server': '2.0.0', zod: '^4', '@actions/github': '^6' } },
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
});

describe('no-backstage-sdk-in-this-repository (ADR-0029)', () => {
  const BACKSTAGE_REASON =
    'Backstage SDK must not enter this repository; the publication surface is a downstream consumer in its own repository (ADR-0029)';

  test('passes on the current workspace tree, which declares no @backstage/* anywhere', async () => {
    await expect(checkDependencyRules()).resolves.toEqual({ ok: true, violations: [] });
  });

  test('fails when the core declares a Backstage dependency', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/core/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/core',
          version: '0.1.0',
          dependencies: { zod: '^4', yaml: 'latest', '@backstage/core-plugin-api': '^1.10.0' },
        },
        null,
        2,
      ),
    );

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.reason)).toContain(BACKSTAGE_REASON);
  });

  test('fails on a package the allowlist has never heard of', async () => {
    // The rule that matters. `allowedDependenciesFor` returns `undefined` for an
    // unrecognized package — "silently unconstrained" — so an allowlist-only rule would
    // pass here. Keying on the `@backstage/` prefix across every package is what makes a
    // brand-new directory unable to smuggle the SDK in.
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/some-new-surface/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/some-new-surface',
          version: '0.0.0',
          dependencies: { '@backstage/plugin-catalog-react': '^1.0.0' },
        },
        null,
        2,
      ),
    );

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.reason)).toContain(BACKSTAGE_REASON);
  });

  test('grants no package an exception, including a would-be Backstage surface', async () => {
    // The prohibition is blanket. An earlier draft of ADR-0029 confined the SDK to
    // `@adrkit/backstage-plugin` instead; naming that package here asserts the exception
    // is really gone, since this is the one input a confinement rule would have allowed.
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'packages/backstage-plugin/package.json'),
      JSON.stringify(
        {
          name: '@adrkit/backstage-plugin',
          version: '0.0.0',
          dependencies: { '@adrkit/core': 'workspace:*', '@backstage/core-plugin-api': '^1.10.0' },
        },
        null,
        2,
      ),
    );

    const result = await checkDependencyRules(root);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.reason)).toContain(BACKSTAGE_REASON);
  });
});
