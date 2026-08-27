import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readYaml(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = Bun.YAML.parse(await Bun.file(path).text());
  if (!isRecord(parsed)) throw new Error(`${path} must contain a YAML object`);
  return parsed;
}

function marketplaceWorkflow(source: string): string {
  const use = source.indexOf('uses: mbeacom/adrkit@v');
  const start = source.lastIndexOf('```yaml', use);
  const end = source.indexOf('```', use);
  if (use < 0 || start < 0 || end < 0) {
    throw new Error('Marketplace documentation must contain an immutable root workflow');
  }
  return source.slice(start, end);
}

function assertMarketplaceContract(
  rootAction: Record<string, unknown>,
  nestedAction: Record<string, unknown>,
): void {
  const rootRuns = rootAction.runs;
  const nestedRuns = nestedAction.runs;
  if (!isRecord(rootRuns)) throw new Error('action.yml must define runs');
  if (!isRecord(nestedRuns)) throw new Error('packages/ci/action.yml must define runs');

  expect(Object.keys(rootRuns).sort()).toEqual(['main', 'using']);
  expect(Object.keys(nestedRuns).sort()).toEqual(['main', 'using']);
  expect(rootRuns.main).toBe('packages/ci/dist/index.js');
  expect(nestedRuns.main).toBe('dist/index.js');
  expect(rootAction).toEqual({
    ...nestedAction,
    runs: {
      ...nestedRuns,
      main: 'packages/ci/dist/index.js',
    },
  });

  const description = rootAction.description;
  if (typeof description !== 'string') throw new Error('action.yml must define a description');
  expect(description.length).toBeLessThanOrEqual(125);
}

describe('Marketplace Action contract', () => {
  test('the root entry point mirrors the governing-decisions Action', async () => {
    const rootAction = await readYaml(join(ROOT, 'action.yml'));
    const nestedAction = await readYaml(join(ROOT, 'packages', 'ci', 'action.yml'));
    assertMarketplaceContract(rootAction, nestedAction);
  });

  test('rejects drift from the established nested bundle', async () => {
    const rootAction = await readYaml(join(ROOT, 'action.yml'));
    const nestedAction = await readYaml(join(ROOT, 'packages', 'ci', 'action.yml'));
    const nestedRuns = nestedAction.runs;
    if (!isRecord(nestedRuns)) throw new Error('packages/ci/action.yml must define runs');

    expect(() => assertMarketplaceContract(rootAction, {
      ...nestedAction,
      runs: {
        ...nestedRuns,
        main: 'dist/queue-action.js',
      },
    })).toThrow();
  });

  test('documents a complete immutable root workflow', async () => {
    for (const path of [
      join(ROOT, 'README.md'),
      join(ROOT, 'site', 'src', 'content', 'docs', 'ci.mdx'),
    ]) {
      const workflow = marketplaceWorkflow(await Bun.file(path).text());
      expect(workflow).toContain('on:\n  pull_request:');
      expect(workflow).toContain('contents: read');
      expect(workflow).toContain('pull-requests: write');
      expect(workflow).toContain('uses: actions/checkout@');
      expect(workflow).toMatch(/uses: mbeacom\/adrkit@v\d+\.\d+\.\d+/);
    }
  });
});
