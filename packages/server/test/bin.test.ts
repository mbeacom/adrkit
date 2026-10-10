import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { CONFIG_MESSAGES } from '../src/config.ts';
import { NON_LOOPBACK_WARNING, USAGE } from '../src/messages.ts';
import { removeScratch, scratch, writeCorpus } from './helpers.ts';

/** ADR-0055 clause 14: bind loopback by default; warn, once and in fixed words, on anything else. */

const BIN = resolve(import.meta.dir, '../src/bin.ts');
const NAME = 'bin';
const children: Array<ReturnType<typeof Bun.spawn>> = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill('SIGTERM');
    await child.exited;
  }
  await removeScratch(NAME);
});

/** Start the binary and wait for its listening line. */
async function launch(env: Record<string, string>): Promise<{ line: string; stderr: () => Promise<string>; child: ReturnType<typeof Bun.spawn> }> {
  const child = Bun.spawn([process.execPath, BIN], {
    env: { PATH: process.env.PATH ?? '', ADRKIT_SERVER_PORT: '0', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  children.push(child);
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  let line = '';
  while (!line.includes('\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    line += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return { line: line.trim(), child, stderr: () => new Response(child.stderr as ReadableStream).text() };
}

describe('adrkit-server', () => {
  test('binds 127.0.0.1 by default and prints no warning', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const { line, child, stderr } = await launch({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    expect(line).toMatch(/^adrkit-server: listening on http:\/\/127\.0\.0\.1:\d+ \(1 corpus\)$/);
    const port = /:(\d+) /.exec(line)![1];
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    child.kill('SIGTERM');
    expect(await child.exited).toBe(0);
    expect(await stderr()).toBe('');
  });

  // ADR-0016 clause 2: observed failing with the `isLoopbackHost` guard in src/bin.ts
  // inverted (the warning printed on loopback binds only). The retained input is the
  // non-loopback bind below.
  test('a non-loopback bind prints the fixed warning once', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const { line, child, stderr } = await launch({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo', ADRKIT_SERVER_HOST: '0.0.0.0' });
    expect(line).toMatch(/^adrkit-server: listening on http:\/\/0\.0\.0\.0:\d+/);
    child.kill('SIGTERM');
    await child.exited;
    expect(await stderr()).toBe(`${NON_LOOPBACK_WARNING}\n`);
    expect(NON_LOOPBACK_WARNING).toContain('This server authenticates no one');
  });

  test('a bad configuration exits 2 with fixed text and no path', async () => {
    const root = await scratch(NAME);
    const child = Bun.spawn([process.execPath, BIN], {
      env: { PATH: process.env.PATH ?? '', ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: `a=${join('..', 'escape-SENTINEL')}` },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await child.exited).toBe(2);
    const stderr = await new Response(child.stderr).text();
    expect(stderr).toBe(`adrkit-server: ${CONFIG_MESSAGES['corpus-escapes-root']} (corpus "a")\n`);
    expect(stderr).not.toContain('SENTINEL');
    expect(stderr).not.toContain(root);
  });

  test('--help prints the usage; any other argument is a usage error', async () => {
    const help = Bun.spawn([process.execPath, BIN, '--help'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await help.exited).toBe(0);
    expect(await new Response(help.stdout).text()).toBe(USAGE);
    const bad = Bun.spawn([process.execPath, BIN, 'serve'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await bad.exited).toBe(2);
    expect(await new Response(bad.stderr).text()).toBe(USAGE);
  });
});
