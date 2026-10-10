import { afterEach, describe, expect, test } from 'bun:test';
import { PORTAL_ASSETS } from '@adrkit/portal/src/page/assets.ts';
import { PORTAL_CSP } from '../src/server.ts';
import { COMMIT_A, getJson, removeScratch, scratch, start, writeCorpus, type Running } from './helpers.ts';

/** ADR-0055 clause 9: the portal bundle and its data file, from the same handle and commit as the API. */

const NAME = 'portal';
const running: Running[] = [];
afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  await removeScratch(NAME);
});

async function serve(corpora = 'demo'): Promise<Running> {
  const root = await scratch(NAME);
  for (const key of corpora.split(',')) await writeCorpus(root, key);
  const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: corpora });
  running.push(server);
  return server;
}

describe('the portal', () => {
  // ADR-0016 clause 2: observed failing with `frame-ancestors 'none'` removed from PORTAL_CSP
  // in src/server.ts. The retained input is the directive, asserted below on every portal file.
  test("every portal file carries the page's CSP plus frame-ancestors 'none', nosniff, and no-referrer", async () => {
    const { url } = await serve();
    for (const path of ['/portal/demo/', '/portal/demo/portal-data.json', ...PORTAL_ASSETS.filter((a) => a.path !== 'index.html').map((a) => `/portal/demo/${a.path}`)]) {
      const response = await fetch(url + path);
      expect([path, response.status]).toEqual([path, 200]);
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).toBe(PORTAL_CSP);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("default-src 'none'");
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  test('serves the bundle files verbatim, with their content types', async () => {
    const { url } = await serve();
    const types: Record<string, string> = { 'index.html': 'text/html', 'app.css': 'text/css' };
    for (const asset of PORTAL_ASSETS) {
      const response = await fetch(`${url}/portal/demo/${asset.path === 'index.html' ? '' : asset.path}`);
      expect(await response.text()).toBe(asset.contents);
      expect(response.headers.get('content-type')).toStartWith(types[asset.path] ?? 'text/javascript');
    }
  });

  test('portal-data.json is built at the sidecar commit with an absent path table', async () => {
    const { url } = await serve();
    const { body, headers } = await getJson(`${url}/portal/demo/portal-data.json`);
    expect(headers.get('content-type')).toStartWith('application/json');
    expect(body.version).toBe('1');
    expect(body.commit).toBe(COMMIT_A);
    expect(body.dir).toBe('docs/adr');
    expect(body.asOf).toBe('2026-10-10');
    expect(body.pathTable).toEqual({ state: 'absent' });
    expect(body.records.map((record: { id: string }) => record.id)).toEqual(['0001', '0002', '0003']);
    const records = await getJson(`${url}/api/v1/corpora/demo/records`);
    expect(records.body.commit).toBe(body.commit);
  });

  test('/ redirects relatively to the only corpus portal', async () => {
    const { url } = await serve();
    const response = await fetch(`${url}/`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('./portal/demo/');
  });

  test('/ lists the corpus portals, with relative links, when several are configured', async () => {
    const { url } = await serve('beta,alpha');
    const response = await fetch(`${url}/`, { redirect: 'manual' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(PORTAL_CSP);
    const html = await response.text();
    expect(html).toContain('<a href="./portal/alpha/">alpha</a>');
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('beta'));
    expect(html).not.toMatch(/<script|<style|style=|\son\w+=/i);
  });

  test('an unknown corpus has no portal', async () => {
    const { url } = await serve();
    for (const path of ['/portal/nope/', '/portal/nope/app.css', '/portal/nope/portal-data.json']) {
      expect([path, (await fetch(url + path)).status]).toEqual([path, 404]);
    }
  });
});
