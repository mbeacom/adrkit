/**
 * The committed portal Action bundle, `packages/ci/dist/portal-action.js`, run as GitHub runs
 * it: under Node, with `INPUT_*`, `GITHUB_EVENT_PATH`, `GITHUB_OUTPUT`, and `GITHUB_WORKSPACE`
 * (ADR-0054 clauses 2, 9, 10).
 *
 * - **No `Bun` global.** `bun build --target=node` emits a `Bun.*` reference verbatim, which is
 *   a `ReferenceError` on the runner while every Bun-run test passes (AGENTS.md, "Shipped
 *   source must be Node-compatible").
 * - **The page is embedded.** Each page asset's text is in the bundle, and running it writes
 *   every asset, byte for byte, plus `portal-data.json`, without reading anything beside the
 *   bundle.
 * - **Clause 10 holds in the bundle.** A private payload writes nothing and fails the step;
 *   `publish-private: true` publishes it.
 * - **It reads markers.** Governance by path comes from the SDK's `governing(path)`, which reads
 *   inbound `@adr` markers as `adr explain` does (clause 6: the table and `adr explain` agree),
 *   so the per-file marker reader is in this bundle, unlike the queue Action's.
 *
 * Git runs with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` (AGENTS.md).
 *
 * ADR-0016 clause 2: observed failing, 2026-10-10, macOS, Node 22.22.2, by editing the committed
 * bundle in place and then restoring it from git:
 * - `export const planted = () => Bun.version;` appended: "the bundle carries no Bun global"
 *   failed.
 * - The `index.html` entry removed from the bundle's asset list: "a public repository writes
 *   every page asset and portal-data.json" and "publish-private: true publishes a private
 *   repository" failed (index.html missing). "every page asset is embedded" still passed, as
 *   expected: the text itself was still in the bundle; it guards the embedding, the run
 *   guards the write.
 * - "publish-private with surrounding whitespace does not open the gate" failed against the
 *   bundle committed in 5ed19c0, before the entrypoint read the input with
 *   `trimWhitespace: false`: `' true '` exited 0 and wrote the bundle for a private payload.
 * - The `publishPrivate !== "true"` check replaced by `false`: "a private repository writes
 *   nothing and fails the step" and "a payload with no repository writes nothing" failed (the
 *   bundle was written and the step succeeded).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PORTAL_ASSETS } from '@adrkit/portal/src/page/assets.ts';
import { writeHealthyCorpus } from '../../sdk/test/fixture.ts';

const BUNDLE = resolve(import.meta.dir, '../dist/portal-action.js');
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

let scratch: string;
let repo: string;

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@test.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

interface BundleRun {
  status: number | null;
  stdout: string;
  outputs: string;
}

async function runBundle(name: string, repository: unknown, extraInputs: Record<string, string> = {}): Promise<BundleRun> {
  const eventPath = join(scratch, `${name}-event.json`);
  const outputPath = join(scratch, `${name}-output.txt`);
  await writeFile(eventPath, JSON.stringify(repository === undefined ? {} : { repository }));
  await writeFile(outputPath, '');
  const inputs: Record<string, string> = { INPUT_DIR: 'docs/adr', INPUT_OUT: name, 'INPUT_AS-OF': '2026-07-05', ...extraInputs };
  const result = spawnSync('node', [BUNDLE], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      ...GIT_ENV,
      GITHUB_WORKSPACE: repo,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputPath,
      ...inputs,
    },
  });
  return { status: result.status, stdout: result.stdout, outputs: await readFile(outputPath, 'utf8') };
}

function exitCodeOutput(outputs: string): string | null {
  const match = /exit-code<<(\S+)\n([^\n]*)\n\1/.exec(outputs);
  return match ? match[2]! : null;
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'adrkit-portal-bundle-'));
  repo = join(scratch, 'repo');
  await writeHealthyCorpus(repo);
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'fixture');
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('the committed portal Action bundle', () => {
  test('the bundle carries no Bun global and no bun import', () => {
    const code = readFileSync(BUNDLE, 'utf8');
    expect(/(^|[^.\w])Bun\s*\./.test(code)).toBe(false);
    expect(/from\s+["']bun(:[^"']*)?["']/.test(code)).toBe(false);
  });

  test('every page asset is embedded', () => {
    const code = readFileSync(BUNDLE, 'utf8');
    // The page module and the vendor copies are embedded verbatim as string literals; the
    // bundler escapes them, so check through JSON's escaping of a distinctive line of each.
    for (const asset of PORTAL_ASSETS.filter((entry) => entry.path !== 'app.css')) {
      const line = asset.contents.split('\n').find((candidate) => candidate.trim().length > 40);
      expect(line, asset.path).toBeDefined();
      const escaped = JSON.stringify(line!.trim()).slice(1, -1);
      expect(code.includes(line!.trim()) || code.includes(escaped), asset.path).toBe(true);
    }
  });

  test('the per-file marker reader is in the bundle (governance by path reads markers)', () => {
    const code = readFileSync(BUNDLE, 'utf8');
    for (const fragment of ['markers/read.ts', 'readSourceMarkers', 'resolveSourceMarkers', 'scanBoundedSourceMarkerWindow']) {
      expect(code, fragment).toContain(fragment);
    }
  });

  test('a public repository writes every page asset and portal-data.json', async () => {
    const run = await runBundle('public-site', { private: false, visibility: 'public' });
    expect(run.status).toBe(0);
    expect(exitCodeOutput(run.outputs)).toBe('0');
    const out = join(repo, 'public-site');
    for (const asset of PORTAL_ASSETS) {
      expect(await readFile(join(out, ...asset.path.split('/')), 'utf8'), asset.path).toBe(asset.contents);
    }
    const data = JSON.parse(await readFile(join(out, 'portal-data.json'), 'utf8')) as {
      version: string;
      asOf: string;
      dir: string;
      commit: string | null;
    };
    expect(data.version).toBe('1');
    expect(data.asOf).toBe('2026-07-05');
    expect(data.dir).toBe('docs/adr');
    expect(data.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  test('a private repository writes nothing and fails the step', async () => {
    const run = await runBundle('private-site', { private: true, visibility: 'private' });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain('::error::adrkit portal: this repository is private');
    expect(exitCodeOutput(run.outputs)).toBeNull();
    expect(existsSync(join(repo, 'private-site'))).toBe(false);
  });

  test('a payload with no repository writes nothing', async () => {
    const run = await runBundle('unknown-site', undefined);
    expect(run.status).not.toBe(0);
    expect(existsSync(join(repo, 'unknown-site'))).toBe(false);
  });

  // `core.getInput` trims by default, so `' true '` became `'true'` and passed the exact-string
  // gate (Copilot security review on #302). The entrypoint reads this one input untrimmed.
  test('publish-private with surrounding whitespace does not open the gate', async () => {
    for (const [name, value] of [
      ['padded-site', ' true '],
      ['newline-site', 'true\n'],
    ] as const) {
      const run = await runBundle(name, { private: true, visibility: 'private' }, { 'INPUT_PUBLISH-PRIVATE': value });
      expect(run.status, JSON.stringify(value)).not.toBe(0);
      expect(run.stdout).toContain('::error::adrkit portal: this repository is private');
      expect(exitCodeOutput(run.outputs)).toBeNull();
      expect(existsSync(join(repo, name))).toBe(false);
    }
  });

  test('publish-private: true publishes a private repository', async () => {
    const run = await runBundle('allowed-site', { private: true }, { 'INPUT_PUBLISH-PRIVATE': 'true' });
    expect(run.status).toBe(0);
    expect(exitCodeOutput(run.outputs)).toBe('0');
    expect(existsSync(join(repo, 'allowed-site', 'portal-data.json'))).toBe(true);
    expect(existsSync(join(repo, 'allowed-site', 'index.html'))).toBe(true);
  });

  test('a usage error fails the step with the generator message and writes nothing', async () => {
    const run = await runBundle('usage-site', { private: false }, { 'INPUT_AS-OF': '2026-07-05T00:00:00Z' });
    expect(run.status).not.toBe(0);
    expect(exitCodeOutput(run.outputs)).toBe('2');
    expect(run.stdout).toContain('::error::adrkit portal: asOf must be a UTC calendar date');
    expect(existsSync(join(repo, 'usage-site'))).toBe(false);
  });
});
