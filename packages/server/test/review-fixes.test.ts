import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openDecisions } from '@adrkit/sdk/src/index.ts';
import { CorpusHolder, type CorpusOpener } from '../src/corpus.ts';
import { parseAsOf } from '../src/validate.ts';
import { getJson, removeScratch, scratch, start, writeCorpus, type Running } from './helpers.ts';

/**
 * Fixes for review findings on PR #314. ADR-0016 clause 2: each test below was observed
 * failing against the code before its fix (noted per test); the retained inputs are the
 * fixtures here.
 */

const NAME = 'review-fixes';
const running: Running[] = [];
const children: Array<ReturnType<typeof Bun.spawn>> = [];
afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  for (const child of children.splice(0)) {
    child.kill('SIGTERM');
    await child.exited;
  }
  await removeScratch(NAME);
  await removeScratch(`${NAME}-outside`);
  await removeScratch(`${NAME}-bundle`);
});

describe('the records directory is confined too', () => {
  // Observed failing before the fix: the holder confined only the corpus directory, so a
  // `docs/adr` symlink out of the root loaded and served the outside records.
  test('a docs/adr symlink out of the root is refused, on first open and on reopen', async () => {
    const root = await scratch(NAME);
    const outside = await scratch(`${NAME}-outside`);
    const dir = await writeCorpus(root, 'demo');
    await writeCorpus(outside, 'elsewhere');
    await rm(join(dir, 'docs/adr'), { recursive: true });
    await symlink(join(outside, 'elsewhere/docs/adr'), join(dir, 'docs/adr'));
    const holder = new CorpusHolder({ key: 'demo', dir, adrDir: 'docs/adr' }, root, (args) => openDecisions(args));
    expect(await holder.current()).toEqual({ ok: false, code: 'corpus-escapes-root' });

    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    const { status, body } = await getJson(`${server.url}/api/v1/corpora/demo/records`);
    expect([status, body.error.code]).toEqual([503, 'corpus-escapes-root']);
  });

  test('a records directory swapped for an escaping symlink after a good load is refused on reopen', async () => {
    const root = await scratch(NAME);
    const outside = await scratch(`${NAME}-outside`);
    const dir = await writeCorpus(root, 'demo');
    await writeCorpus(outside, 'elsewhere');
    const holder = new CorpusHolder({ key: 'demo', dir, adrDir: 'docs/adr' }, root, (args) => openDecisions(args));
    expect((await holder.current()).ok).toBe(true);
    await rm(join(dir, 'docs/adr'), { recursive: true });
    await symlink(join(outside, 'elsewhere/docs/adr'), join(dir, 'docs/adr'));
    await Bun.write(join(dir, '.adrkit-corpus.json'), JSON.stringify({ commit: 'b'.repeat(40) }));
    expect(await holder.current()).toEqual({ ok: false, code: 'corpus-escapes-root' });
  });
});

describe('ETag covers the body', () => {
  // Observed failing before the fix: the ETag hashed only route, query, and commit, so a
  // different body at the same commit (an upgrade) kept the validator and answered 304.
  test('a different body at the same commit changes the ETag and never answers 304', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const env = { ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' };
    const before = await start(env);
    running.push(before);
    const renamed: CorpusOpener = async (args) => {
      const handle = await openDecisions(args);
      const records = handle.records.map((record) => ({ ...record, title: `${record.title} (upgraded)` }));
      return { ...handle, records, get: handle.get, queue: handle.queue, graph: handle.graph, governing: handle.governing, issues: handle.issues };
    };
    const after = await start(env, { open: renamed });
    running.push(after);
    const a = await fetch(`${before.url}/api/v1/corpora/demo/records`);
    const b = await fetch(`${after.url}/api/v1/corpora/demo/records`);
    expect(a.headers.get('etag')).not.toBe(b.headers.get('etag'));
    const stale = await fetch(`${after.url}/api/v1/corpora/demo/records`, { headers: { 'If-None-Match': a.headers.get('etag')! } });
    expect(stale.status).toBe(200);
  });
});

describe('If-None-Match', () => {
  // Observed failing before the fix: only exact strong tags matched, so W/"…" and * answered 200.
  test('weak comparison, *, lists, and a mismatch', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    const url = `${server.url}/api/v1/corpora/demo/records`;
    const etag = (await fetch(url)).headers.get('etag')!;
    const cases: Array<[string, number]> = [
      [etag, 304],
      [`W/${etag}`, 304],
      ['*', 304],
      [`"nope", W/${etag}`, 304],
      [`"nope",${etag}`, 304],
      ['"nope"', 200],
      ['W/"nope", "other"', 200],
    ];
    for (const [header, status] of cases) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(url, { method, headers: { 'If-None-Match': header } });
        expect([header, method, response.status]).toEqual([header, method, status]);
        if (status === 304) expect(response.headers.get('etag')).toBe(etag);
      }
    }
  });

  test('* does not turn an error into a 304', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    expect((await fetch(`${server.url}/api/v1/corpora/demo/records/9999`, { headers: { 'If-None-Match': '*' } })).status).toBe(404);
  });
});

describe('asOf years 0000 to 0099', () => {
  // Observed failing before the fix: Date.UTC maps years 0-99 to 1900-1999, so these were
  // refused although DecisionSet.queue accepts them.
  test('parseAsOf accepts them exactly as the SDK does', async () => {
    for (const value of ['0000-01-01', '0001-02-28', '0050-06-15', '0099-12-31', '0004-02-29']) {
      expect([value, parseAsOf(value).ok]).toEqual([value, true]);
    }
    for (const value of ['0001-02-29', '0099-13-01', '0000-00-10']) expect([value, parseAsOf(value).ok]).toEqual([value, false]);
  });

  test('the queue route serves them', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    const { status, body } = await getJson(`${server.url}/api/v1/corpora/demo/queue?asOf=0050-06-15`);
    expect([status, body.asOf]).toEqual([200, '0050-06-15']);
  });
});

async function ipv6LoopbackAvailable(): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(0, '::1', () => probe.close(() => done(true)));
  });
}

describe('a bracketed IPv6 host', () => {
  // Observed failing before the fix: `[::1]` passed config but Node's `listen` refused it
  // (ENOTFOUND), and the binary exited "could not listen". Bun's listen accepts the brackets,
  // so this runs the bundled server under Node, as the image does.
  test('[::1] binds ::1 under Node and prints the bracketed URL', async () => {
    if (!(await ipv6LoopbackAvailable())) {
      console.warn('skipped: IPv6 loopback (::1) is not available on this machine');
      return;
    }
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const out_ = await scratch(`${NAME}-bundle`);
    const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, '../src/bin.ts')], target: 'node', conditions: ['bun'], outdir: out_, naming: 'server.js' });
    expect(built.success).toBe(true);
    const child = Bun.spawn(['node', join(out_, 'server.js')], {
      env: { PATH: process.env.PATH ?? '', ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo', ADRKIT_SERVER_PORT: '0', ADRKIT_SERVER_HOST: '[::1]' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.push(child);
    const out = await Promise.race([
      (async () => {
        const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
        let text = '';
        while (!text.includes('\n')) {
          const { value, done } = await reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
        }
        reader.releaseLock();
        return text;
      })(),
      child.exited.then(() => ''),
    ]);
    const match = /^adrkit-server: listening on http:\/\/\[::1\]:(\d+) /.exec(out);
    expect(match).not.toBeNull();
    expect((await fetch(`http://[::1]:${match![1]}/healthz`)).status).toBe(200);
  });
});
