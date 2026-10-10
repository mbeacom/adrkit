import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { CorpusHandle, CorpusOpener } from '../src/corpus.ts';
import { ERRORS } from '../src/messages.ts';
import { ROUTES } from '../src/routes.ts';
import { removeScratch, scratch, start, writeCorpus, writeText, type Running } from './helpers.ts';

/**
 * ADR-0055 clause 8: errors are fixed text. A sentinel is planted in a thrown error (from the
 * loader and from every handle method), in an invalid sidecar, and in a corpus directory name,
 * and must appear in no response body or header — as
 * `packages/adapters/agent-plugin/test/error-text.test.ts` does for the plugin.
 *
 * ADR-0016 clause 2: observed failing with the catch-all in `route()` (src/server.ts) changed
 * to answer `{ error: { code: 'internal', message: String(error) } }`: the sentinel then
 * appeared in the 500 bodies below. The retained input is the throwing handle.
 */

const SENTINEL = 'SENTINEL-7f3a-stack-and-stderr';
const NAME = 'error-text';
const running: Running[] = [];
afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  await removeScratch(NAME);
});

function boom(): never {
  const error = new Error(`${SENTINEL} at /secret/path/${SENTINEL}`);
  error.stack = `Error: ${SENTINEL}\n    at handler (/opt/${SENTINEL}/server.js:1:1)`;
  throw error;
}

const throwingHandle: CorpusHandle = {
  get records(): never {
    return boom();
  },
  get issues(): never {
    return boom();
  },
  get: () => boom(),
  queue: () => boom(),
  graph: () => boom(),
  governing: async () => boom(),
};

/** Every concrete GET path the table has, plus error-provoking variants. */
function paths(key: string): string[] {
  const concrete = ROUTES.map((route) => route.path.replace('{corpus}', key).replace('{id}', '0002'));
  return [
    ...concrete,
    `/api/v1/corpora/${key}/governing?path=src/a.ts`,
    `/api/v1/corpora/${key}/graph?kinds=${SENTINEL}`,
    `/api/v1/corpora/${key}/queue?asOf=${SENTINEL}`,
    `/api/v1/corpora/${key}/governing?path=/${SENTINEL}`,
    `/api/v1/corpora/${key}/records/${SENTINEL}`,
    `/api/v1/corpora/${SENTINEL.toLowerCase()}/records`,
    `/${SENTINEL}`,
  ];
}

async function assertNoSentinel(url: string, key: string): Promise<Set<number>> {
  const statuses = new Set<number>();
  for (const path of paths(key)) {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(url + path, { method, redirect: 'manual' });
      statuses.add(response.status);
      const text = await response.text();
      const headers = [...response.headers.entries()].map(([name, value]) => `${name}: ${value}`).join('\n');
      expect({ path, method, leaked: text.includes(SENTINEL) || headers.includes(SENTINEL) }).toEqual({ path, method, leaked: false });
      if (response.status >= 400) {
        const body = JSON.parse(text) as { error: { code: keyof typeof ERRORS; message: string } };
        expect(body.error.message).toBe(ERRORS[body.error.code].message);
      }
    }
  }
  return statuses;
}

describe('no exception, stack, or path text reaches a response', () => {
  test('a handle whose every method throws answers fixed 500s', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const open: CorpusOpener = async () => throwingHandle;
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' }, { open });
    running.push(server);
    const statuses = await assertNoSentinel(server.url, 'demo');
    expect(statuses.has(500)).toBe(true);
  });

  test('a loader that throws answers a fixed 503', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const open: CorpusOpener = async () => boom();
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' }, { open });
    running.push(server);
    const statuses = await assertNoSentinel(server.url, 'demo');
    expect(statuses.has(503)).toBe(true);
  });

  test('a sidecar and a directory name carrying the sentinel stay out of every response', async () => {
    const root = await scratch(NAME);
    const dir = await writeCorpus(root, `dir-${SENTINEL}`, null);
    await writeText(join(dir, '.adrkit-corpus.json'), JSON.stringify({ commit: SENTINEL }));
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: `demo=dir-${SENTINEL}` });
    running.push(server);
    const statuses = await assertNoSentinel(server.url, 'demo');
    expect(statuses.has(503)).toBe(true);
  });

  test('a corpus directory that does not exist under the root stays out of every response', async () => {
    const root = await scratch(NAME);
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: `demo=missing-${SENTINEL}` });
    running.push(server);
    await assertNoSentinel(server.url, 'demo');
  });
});
