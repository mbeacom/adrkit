import { afterEach, describe, expect, test } from 'bun:test';
import { rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { openDecisions } from '@adrkit/sdk/src/index.ts';
import { CorpusHolder, parseSidecar, type CorpusOpener } from '../src/corpus.ts';
import { ERRORS } from '../src/messages.ts';
import { COMMIT_A, COMMIT_B, getJson, removeScratch, scratch, start, writeCorpus, writeSidecar, writeText, type Running } from './helpers.ts';

const NAME = 'sidecar';
const running: Running[] = [];
afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  await removeScratch(NAME);
});

describe('parseSidecar (the ADR-0055 clause 4 / ADR-0056 clause 4 contract)', () => {
  test('accepts a JSON object whose commit is 40 lowercase hex, extra fields included', () => {
    expect(parseSidecar(JSON.stringify({ commit: COMMIT_A }))).toEqual({ state: 'valid', commit: COMMIT_A });
    expect(parseSidecar(JSON.stringify({ commit: COMMIT_A, syncedAt: 'later', ref: 'main' }))).toEqual({ state: 'valid', commit: COMMIT_A });
  });

  test('refuses anything else', () => {
    for (const text of [
      '',
      'not json',
      'null',
      '[]',
      JSON.stringify(COMMIT_A),
      JSON.stringify({}),
      JSON.stringify({ commit: COMMIT_A.toUpperCase() }),
      JSON.stringify({ commit: COMMIT_A.slice(1) }),
      JSON.stringify({ commit: 'c'.repeat(64) }),
      JSON.stringify({ commit: ` ${COMMIT_A}` }),
      JSON.stringify({ commit: 1 }),
    ]) {
      expect([text, parseSidecar(text).state]).toEqual([text, 'invalid']);
    }
  });
});

describe('a corpus without a valid sidecar is not served (clause 4)', () => {
  test('missing sidecar: every corpus route is a fixed 503', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo', null);
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    for (const path of ['records', 'records/0001', 'graph', 'queue', 'issues', 'governing?path=src/a.ts']) {
      const { status, body } = await getJson(`${server.url}/api/v1/corpora/demo/${path}`);
      expect([path, status, body]).toEqual([path, 503, { error: { code: 'sidecar-missing', message: ERRORS['sidecar-missing'].message } }]);
    }
    expect((await getJson(`${server.url}/portal/demo/portal-data.json`)).status).toBe(503);
    expect((await getJson(`${server.url}/api/v1/corpora`)).body.data).toEqual([{ corpus: 'demo', commit: null }]);
  });

  test('an invalid sidecar is a 503 too, never an answer without a commit', async () => {
    const root = await scratch(NAME);
    const dir = await writeCorpus(root, 'demo', null);
    await writeText(join(dir, '.adrkit-corpus.json'), '{"commit":"HEAD"}');
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    const { status, body } = await getJson(`${server.url}/api/v1/corpora/demo/records`);
    expect([status, body.error.code]).toEqual([503, 'sidecar-invalid']);
  });

  test('a directory the populator has not written yet is 503 until it appears', async () => {
    const root = await scratch(NAME);
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'later' });
    running.push(server);
    expect((await getJson(`${server.url}/api/v1/corpora/later/records`)).status).toBe(503);
    await writeCorpus(root, 'later');
    expect((await getJson(`${server.url}/api/v1/corpora/later/records`)).body.commit).toBe(COMMIT_A);
  });
});

describe('a new sync becomes visible by swap (clause 5)', () => {
  // ADR-0016 clause 2: observed failing with the commit comparison in
  // CorpusHolder.current() replaced by `if (this.#loaded) return …` (the first handle kept
  // forever): the second request answered COMMIT_A with two records.
  test('a changed sidecar commit opens a fresh handle; the same commit never reopens', async () => {
    const root = await scratch(NAME);
    const dir = await writeCorpus(root, 'demo');
    let opens = 0;
    const open: CorpusOpener = (args) => {
      opens++;
      return openDecisions(args);
    };
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' }, { open });
    running.push(server);
    const first = await getJson(`${server.url}/api/v1/corpora/demo/records`);
    await getJson(`${server.url}/api/v1/corpora/demo/issues`);
    expect([first.body.commit, first.body.data.length, opens]).toEqual([COMMIT_A, 3, 1]);

    await rm(join(dir, 'docs/adr/0003-review-a-proposal.md'));
    // The populator writes the sidecar last; until then the old commit (and handle) stands.
    expect((await getJson(`${server.url}/api/v1/corpora/demo/records`)).body.data.length).toBe(3);
    await writeSidecar(dir, COMMIT_B);
    const second = await getJson(`${server.url}/api/v1/corpora/demo/records`);
    expect([second.body.commit, second.body.data.length, opens]).toEqual([COMMIT_B, 2, 2]);
  });

  test('a load during which the commit moved is not kept; the old handle keeps serving', async () => {
    const root = await scratch(NAME);
    const dir = await writeCorpus(root, 'demo');
    let moveDuringLoad = false;
    const open: CorpusOpener = async (args) => {
      const handle = await openDecisions(args);
      if (moveDuringLoad) {
        moveDuringLoad = false;
        await writeSidecar(dir, 'c'.repeat(40));
      }
      return handle;
    };
    const holder = new CorpusHolder({ key: 'demo', dir, adrDir: 'docs/adr' }, root, open);
    const first = await holder.current();
    expect(first.ok && first.corpus.commit).toBe(COMMIT_A);

    await writeSidecar(dir, COMMIT_B);
    moveDuringLoad = true;
    const during = await holder.current();
    expect(during.ok && during.corpus.commit).toBe(COMMIT_A);
    const after = await holder.current();
    expect(after.ok && after.corpus.commit).toBe('c'.repeat(40));
  });

  test('a first load during which the commit moved is a 503, not an answer at either commit', async () => {
    const root = await scratch(NAME);
    const dir = await writeCorpus(root, 'demo');
    const open: CorpusOpener = async (args) => {
      const handle = await openDecisions(args);
      await writeSidecar(dir, COMMIT_B);
      return handle;
    };
    const holder = new CorpusHolder({ key: 'demo', dir, adrDir: 'docs/adr' }, root, open);
    expect(await holder.current()).toEqual({ ok: false, code: 'corpus-changing' });
  });

  test('concurrent requests at a new commit share one load', async () => {
    const root = await scratch(NAME);
    const dir = await writeCorpus(root, 'demo');
    let opens = 0;
    const holder = new CorpusHolder({ key: 'demo', dir, adrDir: 'docs/adr' }, root, (args) => {
      opens++;
      return openDecisions(args);
    });
    const states = await Promise.all([holder.current(), holder.current(), holder.current()]);
    expect(states.every((state) => state.ok)).toBe(true);
    expect(opens).toBe(1);
  });

  test('the two-move window (directory briefly absent) keeps serving the last handle', async () => {
    const root = await scratch(NAME);
    const dir = await writeCorpus(root, 'demo');
    const holder = new CorpusHolder({ key: 'demo', dir, adrDir: 'docs/adr' }, root, (args) => openDecisions(args));
    expect((await holder.current()).ok).toBe(true);
    await rename(dir, join(root, 'demo.old'));
    const during = await holder.current();
    expect(during.ok && during.corpus.commit).toBe(COMMIT_A);
  });

  test('a failed load keeps the old handle, and a failed first load is a 503', async () => {
    const root = await scratch(NAME);
    const dir = await writeCorpus(root, 'demo');
    let fail = false;
    const holder = new CorpusHolder({ key: 'demo', dir, adrDir: 'docs/adr' }, root, async (args) => {
      if (fail) throw new Error('boom');
      return openDecisions(args);
    });
    expect((await holder.current()).ok).toBe(true);
    fail = true;
    await writeSidecar(dir, COMMIT_B);
    const kept = await holder.current();
    expect(kept.ok && kept.corpus.commit).toBe(COMMIT_A);

    const fresh = new CorpusHolder({ key: 'demo', dir, adrDir: 'docs/adr' }, root, async () => {
      throw new Error('boom');
    });
    expect(await fresh.current()).toEqual({ ok: false, code: 'corpus-unreadable' });
  });

  test('a directory replaced by a symlink out of the root is refused, old handle or not', async () => {
    const root = await scratch(NAME);
    const outside = await scratch(`${NAME}-outside`);
    try {
      const dir = await writeCorpus(root, 'demo');
      await writeCorpus(outside, 'elsewhere');
      const holder = new CorpusHolder({ key: 'demo', dir, adrDir: 'docs/adr' }, root, (args) => openDecisions(args));
      expect((await holder.current()).ok).toBe(true);
      await rm(dir, { recursive: true });
      await symlink(join(outside, 'elsewhere'), dir);
      expect(await holder.current()).toEqual({ ok: false, code: 'corpus-escapes-root' });
    } finally {
      await removeScratch(`${NAME}-outside`);
    }
  });
});
