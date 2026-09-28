/**
 * ADR-0011 action item 6: a `SCHEMA_VERSION` bump must keep every previously
 * published version path serving its exact bytes.
 *
 * The pin below is the SHA-256 of `schema/adr.schema.json` as published at
 * v0.1.0 — the value `packages/catalog-envelope/test/protected-surfaces.json`
 * carried before #235 re-pinned it to v0.2.0. It is a specific observed value
 * (ADR-0016), not "whatever the file currently contains": if the retained file
 * is ever edited, regenerated, or removed, this fails.
 *
 * `bun run check:schema` in `.github/workflows/site.yml` then asserts that the
 * built site serves those same bytes; this test proves the planner routes them
 * to `/schema/adr/v0.1.0/adr.schema.json` in the first place, and that the
 * "never repoint" rules fire.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { planAllServedSchemas, writeServed, checkServed } from './sync-schema.ts';

const repoRoot = resolve(import.meta.dir, '..', '..');
const V0_1_0_SHA256 = '1e1841151174cc5a8ed22dadae070f087477e5068bd928d5292c3acd2e2681cc';

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'adrkit-sync-schema-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function schemaWithVersion(version: string, extra = ''): string {
  return `${JSON.stringify(
    { $id: `https://adrkit.dev/schema/adr/v${version}/adr.schema.json`, title: `t${extra}` },
    null,
    2,
  )}\n`;
}

describe('retained schema versions (ADR-0011 item 6)', () => {
  test('the retained v0.1.0 file is byte-identical to the published v0.1.0 schema', () => {
    const bytes = readFileSync(join(repoRoot, 'schema', 'versions', 'v0.1.0', 'adr.schema.json'));
    expect(sha256(bytes)).toBe(V0_1_0_SHA256);
  });

  test('the site serves v0.1.0 unchanged at its $id path after the bump', () => {
    const publicDir = tempDir();
    const { current, retained } = planAllServedSchemas({
      canonicalPath: join(repoRoot, 'schema', 'adr.schema.json'),
      retainedDir: join(repoRoot, 'schema', 'versions'),
      publicDir,
    });

    expect(current.version).not.toBe('0.1.0');
    const v010 = retained.find((plan) => plan.version === '0.1.0');
    expect(v010?.servedPathname).toBe('/schema/adr/v0.1.0/adr.schema.json');

    for (const plan of [current, ...retained]) writeServed(plan);
    const served = readFileSync(join(publicDir, 'schema', 'adr', 'v0.1.0', 'adr.schema.json'));
    expect(sha256(served)).toBe(V0_1_0_SHA256);

    // The current version is served too, from the canonical file.
    const currentServed = readFileSync(current.servedPath, 'utf8');
    expect(currentServed).toBe(readFileSync(join(repoRoot, 'schema', 'adr.schema.json'), 'utf8'));
  });

  test('--check fails when a retained version is missing from the served output', () => {
    const publicDir = tempDir();
    const { current, retained } = planAllServedSchemas({
      canonicalPath: join(repoRoot, 'schema', 'adr.schema.json'),
      retainedDir: join(repoRoot, 'schema', 'versions'),
      publicDir,
    });
    writeServed(current);
    expect(retained.length).toBeGreaterThan(0);
    for (const plan of retained) expect(() => checkServed(plan)).toThrow(/missing/);
  });

  test('a retained file whose $id names another version is refused', () => {
    const root = tempDir();
    writeFileSync(join(root, 'canonical.json'), schemaWithVersion('0.3.0'));
    mkdirSync(join(root, 'versions', 'v0.1.0'), { recursive: true });
    writeFileSync(join(root, 'versions', 'v0.1.0', 'adr.schema.json'), schemaWithVersion('0.2.0'));
    expect(() =>
      planAllServedSchemas({
        canonicalPath: join(root, 'canonical.json'),
        retainedDir: join(root, 'versions'),
        publicDir: join(root, 'public'),
      }),
    ).toThrow(/declares \$id version v0\.2\.0/);
  });

  test('changing a published version in place is refused (never repoint)', () => {
    const root = tempDir();
    writeFileSync(join(root, 'canonical.json'), schemaWithVersion('0.1.0', 'changed'));
    mkdirSync(join(root, 'versions', 'v0.1.0'), { recursive: true });
    writeFileSync(join(root, 'versions', 'v0.1.0', 'adr.schema.json'), schemaWithVersion('0.1.0'));
    expect(() =>
      planAllServedSchemas({
        canonicalPath: join(root, 'canonical.json'),
        retainedDir: join(root, 'versions'),
        publicDir: join(root, 'public'),
      }),
    ).toThrow(/immutable/);
  });

  test('a canonical version identical to a retained one is served once', () => {
    const root = tempDir();
    writeFileSync(join(root, 'canonical.json'), schemaWithVersion('0.1.0'));
    mkdirSync(join(root, 'versions', 'v0.1.0'), { recursive: true });
    writeFileSync(join(root, 'versions', 'v0.1.0', 'adr.schema.json'), schemaWithVersion('0.1.0'));
    const { retained } = planAllServedSchemas({
      canonicalPath: join(root, 'canonical.json'),
      retainedDir: join(root, 'versions'),
      publicDir: join(root, 'public'),
    });
    expect(retained).toEqual([]);
  });

  test('anything other than a v<semver> directory under schema/versions is refused', () => {
    const root = tempDir();
    writeFileSync(join(root, 'canonical.json'), schemaWithVersion('0.2.0'));
    mkdirSync(join(root, 'versions'), { recursive: true });
    writeFileSync(join(root, 'versions', 'adr.schema.json'), schemaWithVersion('0.1.0'));
    expect(() =>
      planAllServedSchemas({
        canonicalPath: join(root, 'canonical.json'),
        retainedDir: join(root, 'versions'),
        publicDir: join(root, 'public'),
      }),
    ).toThrow(/Unexpected entry/);
  });
});
