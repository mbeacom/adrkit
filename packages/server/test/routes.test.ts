import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { COMMIT_A, getJson, removeScratch, scratch, start, writeCorpus, writeText, type Running } from './helpers.ts';
import { GOVERNING_TEXT } from '../src/shapes.ts';

const NAME = 'routes';
const running: Running[] = [];
afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  await removeScratch(NAME);
});

async function serve(): Promise<Running> {
  const root = await scratch(NAME);
  await writeCorpus(root, 'demo');
  const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
  running.push(server);
  return server;
}

describe('data routes answer { corpus, commit, data } from one SDK call', () => {
  test('listCorpora names each key with its commit', async () => {
    const { url } = await serve();
    const { status, body } = await getJson(`${url}/api/v1/corpora`);
    expect(status).toBe(200);
    expect(body).toEqual({ corpus: null, commit: null, data: [{ corpus: 'demo', commit: COMMIT_A }] });
  });

  test('listRecords lists every record without its body; getRecord adds the body', async () => {
    const { url } = await serve();
    const list = await getJson(`${url}/api/v1/corpora/demo/records`);
    expect(list.status).toBe(200);
    expect(list.body.corpus).toBe('demo');
    expect(list.body.commit).toBe(COMMIT_A);
    expect(list.body.data.map((record: { id: string }) => record.id)).toEqual(['0001', '0002', '0003']);
    expect(list.body.data[0]).toEqual({
      id: '0001',
      title: 'Use a decision corpus',
      status: 'superseded',
      standing: 'history',
      date: '2026-07-18',
      path: 'docs/adr/0001-use-a-decision-corpus.md',
      tags: [],
      supersedes: [],
      supersededBy: '0002',
    });
    expect('body' in list.body.data[0]).toBe(false);

    const one = await getJson(`${url}/api/v1/corpora/demo/records/0002`);
    expect(one.status).toBe(200);
    expect(one.body.data.id).toBe('0002');
    expect(one.body.data.body).toContain('# ADR-0002: Govern the source tree');
  });

  test('getRecord: a malformed id is 400, an unknown one 404, an unknown corpus 404', async () => {
    const { url } = await serve();
    expect((await getJson(`${url}/api/v1/corpora/demo/records/12`)).body.error.code).toBe('invalid-record-id');
    expect((await getJson(`${url}/api/v1/corpora/demo/records/..%2F..%2Fetc`)).status).toBe(400);
    expect((await getJson(`${url}/api/v1/corpora/demo/records/9999`)).body.error.code).toBe('record-not-found');
    const unknown = await getJson(`${url}/api/v1/corpora/nope/records`);
    expect([unknown.status, unknown.body.error.code]).toEqual([404, 'corpus-not-found']);
    expect((await getJson(`${url}/api/v1/corpora/Bad_Key/records`)).status).toBe(404);
  });

  test('getGraph defaults to supersession edges and takes kinds', async () => {
    const { url } = await serve();
    const plain = await getJson(`${url}/api/v1/corpora/demo/graph`);
    expect(plain.body.data.edges).toEqual([{ from: '0002', to: '0001', kind: 'supersedes' }]);
    expect(plain.body.data.nodes.map((node: { id: string }) => node.id)).toEqual(['0001', '0002', '0003']);
    const all = await getJson(`${url}/api/v1/corpora/demo/graph?kinds=relatesTo,supersedes`);
    expect(all.body.data.edges).toEqual([
      { from: '0002', to: '0001', kind: 'supersedes' },
      { from: '0003', to: '0002', kind: 'relatesTo' },
    ]);
  });

  test('getGraph refuses an empty, unknown, or repeated kinds with fixed text', async () => {
    const { url } = await serve();
    for (const query of ['kinds=', 'kinds=supersedes,', 'kinds=bogus', 'kinds=supersedes&kinds=relatesTo']) {
      const { status, body } = await getJson(`${url}/api/v1/corpora/demo/graph?${query}`);
      expect([query, status]).toEqual([query, 400]);
      expect(['invalid-kinds', 'invalid-query']).toContain(body.error.code);
    }
  });

  test('getQueue echoes asOf, defaulting to the UTC date of the clock', async () => {
    const { url } = await serve();
    const today = await getJson(`${url}/api/v1/corpora/demo/queue`);
    expect(today.body.asOf).toBe('2026-10-10');
    expect(today.body.data.entries.map((entry: { id: string }) => entry.id)).toEqual(['0003']);
    expect(today.body.data.entries[0].routingTargets).toEqual(['@reviewer']);
    const later = await getJson(`${url}/api/v1/corpora/demo/queue?asOf=2026-11-01`);
    expect(later.body.asOf).toBe('2026-11-01');
    expect(later.body.data.entries[0].slaState).not.toBe(today.body.data.entries[0].slaState);
  });

  test('getQueue refuses an impossible or non-calendar asOf', async () => {
    const { url } = await serve();
    for (const value of ['2026-02-30', '2026-13-01', '2026-10-10T00:00:00Z', 'today', '']) {
      const { status, body } = await getJson(`${url}/api/v1/corpora/demo/queue?asOf=${encodeURIComponent(value)}`);
      expect([value, status, body.error.code]).toEqual([value, 400, 'invalid-as-of']);
    }
  });

  test('getIssues is the corpus findings list', async () => {
    const { url } = await serve();
    const { status, body } = await getJson(`${url}/api/v1/corpora/demo/issues`);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.filter((issue: { severity: string }) => issue.severity === 'error')).toEqual([]);
  });
});

describe('getGoverning', () => {
  test('resolves affects matches only, and says so in a fixed field', async () => {
    const { url } = await serve();
    const { status, body } = await getJson(`${url}/api/v1/corpora/demo/governing?path=src/app.ts`);
    expect(status).toBe(200);
    expect(body.data.governing.map((decision: { id: string }) => decision.id)).toEqual(['0002']);
    expect(body.data.governing[0].matchedBy).toEqual([{ kind: 'affects', type: 'path', pattern: 'src/**', line: null }]);
    expect(body.data.evidence).toEqual({ markers: 'not-read', note: GOVERNING_TEXT.evidence });
    expect(body.data.resolution).toEqual({ state: 'resolved', note: null });
  });

  // ADR-0016 clause 2: observed failing with `{ readMarkers: false }` removed from the
  // getGoverning call in src/server.ts — the SDK then read the planted file and reported the
  // marker as evidence. The retained input is the planted marker file below.
  test('never reads the file at the path, even when one exists with an @adr marker', async () => {
    const root = await scratch(NAME);
    const dir = await writeCorpus(root, 'demo');
    await writeText(join(dir, 'lib/marked.ts'), '// @adr 0002\nexport const x = 1;\n');
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    const { body } = await getJson(`${server.url}/api/v1/corpora/demo/governing?path=lib/marked.ts`);
    expect(body.data.governing).toEqual([]);
    expect(body.data.issues).toEqual([]);
  });

  test('withholds resolution, with the corpus issues, when the corpus has errors', async () => {
    const root = await scratch(NAME);
    const dir = await writeCorpus(root, 'demo');
    await writeText(join(dir, 'docs/adr/0004-broken.md'), '---\nid: "0004"\n: not yaml\n---\n');
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    const { status, body } = await getJson(`${server.url}/api/v1/corpora/demo/governing?path=src/app.ts`);
    expect(status).toBe(200);
    expect(body.data.governing).toEqual([]);
    expect(body.data.resolution).toEqual({ state: 'withheld', note: GOVERNING_TEXT.withheld });
    expect(body.data.issues.some((issue: { severity: string }) => issue.severity === 'error')).toBe(true);
  });

  test('refuses a missing, absolute, parent-escaping, option-like, control, or overlong path', async () => {
    const { url } = await serve();
    const cases: Array<[string, string]> = [
      ['', 'missing-path'],
      ['path=', 'missing-path'],
      ['path=/etc/passwd', 'invalid-path'],
      ['path=src/../../etc', 'invalid-path'],
      ['path=..', 'invalid-path'],
      ['path=-rf', 'invalid-path'],
      ['path=C:/x', 'invalid-path'],
      [`path=${encodeURIComponent('a\u0000b')}`, 'invalid-path'],
      [`path=${encodeURIComponent('a\nb')}`, 'invalid-path'],
      [`path=${'a'.repeat(1025)}`, 'invalid-path'],
      ['path=a&path=b', 'invalid-query'],
    ];
    for (const [query, code] of cases) {
      const { status, body } = await getJson(`${url}/api/v1/corpora/demo/governing?${query}`);
      expect([query.slice(0, 40), status, body.error.code]).toEqual([query.slice(0, 40), 400, code]);
    }
  });
});

describe('determinism and caching (clause 3)', () => {
  test('two servers over the same corpus give byte-identical bodies and ETags', async () => {
    const first = await serve();
    const second = await start({ ADRKIT_SERVER_ROOT: first.config.root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(second);
    for (const path of [
      '/api/v1/corpora',
      '/api/v1/corpora/demo/records',
      '/api/v1/corpora/demo/records/0002',
      '/api/v1/corpora/demo/graph?kinds=conflictsWith,relatesTo',
      '/api/v1/corpora/demo/queue',
      '/api/v1/corpora/demo/issues',
      '/api/v1/corpora/demo/governing?path=src/a.ts',
      '/openapi.json',
      '/portal/demo/portal-data.json',
    ]) {
      const a = await fetch(first.url + path);
      const b = await fetch(second.url + path);
      expect([path, await a.text()]).toEqual([path, await b.text()]);
      expect([path, a.headers.get('etag')]).toEqual([path, b.headers.get('etag')]);
    }
  });

  test('the ETag follows the canonical query, and If-None-Match answers 304', async () => {
    const { url } = await serve();
    const a = await fetch(`${url}/api/v1/corpora/demo/graph?kinds=relatesTo,supersedes,relatesTo`);
    const b = await fetch(`${url}/api/v1/corpora/demo/graph?kinds=supersedes,relatesTo&ignored=1`);
    const c = await fetch(`${url}/api/v1/corpora/demo/graph`);
    expect(a.headers.get('etag')).toBe(b.headers.get('etag'));
    expect(a.headers.get('etag')).not.toBe(c.headers.get('etag'));
    const cached = await fetch(`${url}/api/v1/corpora/demo/graph`, { headers: { 'If-None-Match': c.headers.get('etag')! } });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
  });

  test('responses carry no Date-like or host value in the body', async () => {
    const { url } = await serve();
    const text = await (await fetch(`${url}/api/v1/corpora/demo/records`)).text();
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe('fixed routes', () => {
  test('healthz answers ok', async () => {
    const { url } = await serve();
    expect(await getJson(`${url}/healthz`)).toMatchObject({ status: 200, body: { status: 'ok' } });
  });

  test('an unknown path is a fixed 404', async () => {
    const { url } = await serve();
    for (const path of ['/nope', '/api/v1/corpora/', '/api/v1/corpora/demo', '/api/v2/corpora', '/portal/demo']) {
      const { status, body } = await getJson(url + path);
      expect([path, status, body.error.code]).toEqual([path, 404, 'not-found']);
    }
  });

  test('every response carries nosniff, no-referrer, a CSP with frame-ancestors none, and no CORS header', async () => {
    const { url } = await serve();
    for (const path of ['/healthz', '/api/v1/corpora/demo/records', '/nope', '/portal/demo/']) {
      const response = await fetch(url + path);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
});
