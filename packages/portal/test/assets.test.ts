/**
 * The generator writes the page bundle next to `portal-data.json` (ADR-0054 clauses 2 and 8),
 * from source and from the Node bundle the portal Action ships.
 *
 * The bundle case is the one that matters: `packages/ci/dist/portal-action.js` runs from a
 * directory with no page sources beside it, so the files must be embedded as text at build
 * time (`with { type: 'text' }`). The test bundles `src/generate.ts` with
 * `--target=node` into a temporary directory and runs that copy.
 *
 * ADR-0016 clause 2: observed failing, 2026-10-10, macOS, Bun 1.4.2. With `writePortalAssets`
 * reduced to `return [];`, "writes every page file next to the data file" and "the Node bundle
 * carries the page" both failed; with the `vendor/board-view.mjs` entry removed from
 * `PORTAL_ASSETS`, "every module the page imports is written" failed. Each was restored.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { writeHealthyCorpus } from '../../sdk/test/fixture.ts';
import { PORTAL_ASSETS } from '../src/page/assets.ts';
import { generatePortal } from '../src/generate.ts';

const SRC = resolve(import.meta.dir, '../src');
let root: string;
let bundleDir: string;

beforeAll(async () => {
  // Outside any git work tree: the table is `absent`, which is all this file needs.
  root = await mkdtemp(join(tmpdir(), 'adrkit-portal-assets-'));
  await writeHealthyCorpus(root);
  bundleDir = await mkdtemp(join(tmpdir(), 'adrkit-portal-bundle-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(bundleDir, { recursive: true, force: true });
});

async function expectBundleAt(out: string) {
  for (const { path, contents } of PORTAL_ASSETS) {
    expect({ path, same: (await readFile(join(out, path), 'utf8')) === contents }).toEqual({ path, same: true });
  }
  expect(JSON.parse(await readFile(join(out, 'portal-data.json'), 'utf8')).version).toBe('1');
}

describe('the page bundle', () => {
  test('writes every page file next to the data file', async () => {
    const result = await generatePortal({ cwd: root, out: 'site', asOf: '2026-07-05' });
    expect(result.exitCode).toBe(0);
    await expectBundleAt(join(root, 'site'));
  });

  test('the shipped files are the sources and the generated vendor copies, byte for byte', async () => {
    const out = join(root, 'site');
    expect(await readFile(join(out, 'page/app.mjs'), 'utf8')).toBe(await readFile(join(SRC, 'page/app.mjs'), 'utf8'));
    expect(await readFile(join(out, 'index.html'), 'utf8')).toBe(await readFile(join(SRC, 'page/index.html'), 'utf8'));
    for (const name of ['board-layout.mjs', 'board-view.mjs']) {
      expect(await readFile(join(out, 'vendor', name), 'utf8')).toBe(await readFile(join(SRC, 'vendor', name), 'utf8'));
    }
  });

  test('every module the page imports is written, and every file index.html names', async () => {
    const written = new Set(PORTAL_ASSETS.map((file) => file.path));
    const app = PORTAL_ASSETS.find((file) => file.path === 'page/app.mjs')!.contents;
    const html = PORTAL_ASSETS.find((file) => file.path === 'index.html')!.contents;
    const wanted = [
      ...[...app.matchAll(/^\s*import\b[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((match) => new URL(match[1]!, 'https://x.invalid/page/app.mjs').pathname.slice(1)),
      ...[...html.matchAll(/\b(?:href|src)="(\.\/[^"]+)"/g)].map((match) => new URL(match[1]!, 'https://x.invalid/index.html').pathname.slice(1)),
    ];
    expect(wanted.length).toBe(4);
    for (const path of wanted) expect({ path, written: written.has(path) }).toEqual({ path, written: true });
  });

  test('the Node bundle carries the page, with no source beside it', async () => {
    const built = await Bun.build({ entrypoints: [join(SRC, 'generate.ts')], target: 'node', outdir: bundleDir, naming: 'generate.js' });
    expect(built.success).toBe(true);
    const bundled = await import(join(bundleDir, 'generate.js'));
    expect(dirname(join(bundleDir, 'generate.js'))).not.toContain(SRC);
    const result = await bundled.generatePortal({ cwd: root, out: 'bundled-site', asOf: '2026-07-05' });
    expect(result.exitCode).toBe(0);
    await expectBundleAt(join(root, 'bundled-site'));
  });
});
