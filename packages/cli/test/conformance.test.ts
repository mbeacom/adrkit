/**
 * The conformance fixture (ADR-0030 clause 5, ADR-0031 action item 6): the CLI run over the
 * committed corpus must reproduce both goldens byte for byte, with the manifest's exit codes.
 *
 * This is the half of the fixture a downstream repository runs against a pinned `adr`. The
 * other half, `packages/sdk/test/conformance.test.ts`, holds `@adrkit/sdk` to the same goldens.
 *
 * ADR-0016: observed failing. Changing one byte of `queue.json` (the `asOf` date) failed the
 * queue case, and changing the manifest's check exit code to 1 failed the check case; both
 * were reverted.
 */

import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const FIXTURE = resolve(process.cwd(), 'packages/core/test/conformance/golden');

interface ManifestCommand {
  args: string[];
  exitCode: number;
  golden: string;
}

interface Manifest {
  fixture: string;
  version: number;
  cwd: string;
  commands: Record<'queue' | 'check', ManifestCommand>;
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(resolve(FIXTURE, 'manifest.json'), 'utf8')) as Manifest;
}

async function runAdr(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('conformance fixture — the CLI reproduces the goldens', () => {
  for (const name of ['queue', 'check'] as const) {
    test(`adr ${name} matches ${name}.json byte for byte`, async () => {
      const manifest = await readManifest();
      const command = manifest.commands[name];
      const result = await runAdr(command.args, resolve(FIXTURE, manifest.cwd));
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(command.exitCode);
      expect(result.stdout).toBe(await readFile(resolve(FIXTURE, command.golden), 'utf8'));
    });
  }

  test('the manifest names exactly the two commands ADR-0030 clause 5 specifies', async () => {
    const manifest = await readManifest();
    expect(Object.keys(manifest.commands).sort()).toEqual(['check', 'queue']);
    expect(manifest.commands.queue.args).toContain('--as-of');
  });
});
