import { afterEach, describe, expect, test } from 'bun:test';
import { request } from 'node:http';
import { ROUTES, type RouteDefinition } from '../src/routes.ts';
import { removeScratch, scratch, start, writeCorpus, type Running } from './helpers.ts';

/**
 * ADR-0055 clause 2, first half: no write route. Only `GET` (and `HEAD`, answered as `GET`)
 * is routed; anything else is 405 with `Allow: GET, HEAD`, and no request body is read.
 */

const NAME = 'methods';
const running: Running[] = [];
afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  await removeScratch(NAME);
});

/** The route-table check, as a function so the plant below can run it against a bad table. */
function nonGetRoutes(routes: readonly RouteDefinition[]): string[] {
  return routes.filter((route) => route.method !== 'GET').map((route) => `${route.method} ${route.path}`);
}

describe('the route table holds GET routes only', () => {
  test('every row is GET', () => {
    expect(ROUTES.length).toBeGreaterThan(10);
    expect(nonGetRoutes(ROUTES)).toEqual([]);
  });

  // ADR-0016 clause 2: observed failing against a planted row. With a row whose `method` is
  // `'POST'` (cast past the type) appended to ROUTES in src/routes.ts, `every row is GET`
  // failed. The retained input is a planted row, checked here against the same function.
  test('the check catches a planted write route', () => {
    const planted = [...ROUTES, { ...ROUTES[0]!, method: 'POST' } as unknown as RouteDefinition];
    expect(nonGetRoutes(planted)).toEqual(['POST /healthz']);
  });
});

/** Send a raw request with a body and report what came back, without the client reading our body for us. */
function send(url: string, method: string, body: string): Promise<{ status: number; allow: string | undefined; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, allow: res.headers.allow, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('live method guard', () => {
  test('every other method is 405 with Allow: GET, HEAD on every route and on unknown paths', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    const paths = ['/', '/healthz', '/api/v1/corpora', '/api/v1/corpora/demo/records', '/api/v1/corpora/demo/records/0002', '/nope'];
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      for (const path of paths) {
        const { status, allow, text } = await send(server.url + path, method, '{"status":"accepted"}');
        expect([method, path, status, allow]).toEqual([method, path, 405, 'GET, HEAD']);
        expect(JSON.parse(text).error.code).toBe('method-not-allowed');
      }
    }
  });

  test('HEAD answers the GET headers with no body', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    for (const path of ['/api/v1/corpora/demo/records', '/portal/demo/', '/nope']) {
      const get = await fetch(server.url + path);
      const head = await fetch(server.url + path, { method: 'HEAD' });
      expect([path, head.status]).toEqual([path, get.status]);
      expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
      expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
      expect(await head.text()).toBe('');
    }
  });

  test('a GET that carries a body is answered without reading it, and nothing changes on disk', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    const { status } = await send(`${server.url}/api/v1/corpora/demo/records`, 'GET', '{"status":"accepted"}');
    expect(status).toBe(200);
    const after = await (await fetch(`${server.url}/api/v1/corpora/demo/records/0003`)).json();
    expect((after as { data: { status: string } }).data.status).toBe('proposed');
  });
});
