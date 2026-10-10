import { afterEach, describe, expect, test } from 'bun:test';
import { PORTAL_ASSETS } from '@adrkit/portal/src/page/assets.ts';
import { buildOpenApi } from '../src/openapi.ts';
import { matchRoute, PORTAL_ASSET_ROUTES, ROUTES, type RouteDefinition } from '../src/routes.ts';
import { removeScratch, scratch, start, writeCorpus, type Running } from './helpers.ts';

/** ADR-0055 clause 11: the document and the route table agree; `operationId`s are stable. */

const NAME = 'openapi';
const running: Running[] = [];
afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  await removeScratch(NAME);
});

/**
 * The operationIds remote agents see as tool names through APIM (clause 15). The first nine
 * are the names adrkit-azure's placeholder document already wires; renaming any is a break.
 */
const STABLE_IDS = [
  'listCorpora',
  'listRecords',
  'getRecord',
  'getGraph',
  'getQueue',
  'getIssues',
  'getGoverning',
  'getOpenApi',
  'getPortal',
  'getHealth',
  'getCorpusPortal',
  'getCorpusPortalData',
  'getPortalStylesheet',
  'getPortalApp',
  'getPortalBoardLayout',
  'getPortalBoardView',
];

type Doc = ReturnType<typeof buildOpenApi>;

/** Every disagreement between a document and a route table, as strings. */
function disagreements(doc: Doc, routes: readonly RouteDefinition[]): string[] {
  const problems: string[] = [];
  const documented = new Map<string, string>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (method !== 'get') problems.push(`non-get operation ${method} ${path}`);
      documented.set(`${path} ${(operation as { operationId: string }).operationId}`, method);
    }
  }
  for (const route of routes) {
    if (!documented.delete(`${route.path} ${route.operationId}`)) problems.push(`undocumented route ${route.operationId} ${route.path}`);
  }
  for (const key of documented.keys()) problems.push(`documented route the table lacks: ${key}`);
  return problems;
}

describe('the OpenAPI document', () => {
  test('describes exactly the route table, as get operations only', () => {
    expect(disagreements(buildOpenApi(), ROUTES)).toEqual([]);
  });

  // ADR-0016 clause 2: observed failing with the served document in src/server.ts built from
  // `buildOpenApi(ROUTES.slice(1))` (one route dropped): `the served document is the
  // generated one` failed. The retained input is the slice, checked here against the same
  // function.
  test('the agreement check catches a dropped or extra operation', () => {
    expect(disagreements(buildOpenApi(ROUTES.slice(1)), ROUTES)).toEqual(['undocumented route getHealth /healthz']);
    const extra = buildOpenApi([...ROUTES, { ...ROUTES[0]!, operationId: 'postThing', path: '/thing' }]);
    expect(disagreements(extra, ROUTES)).toEqual(['documented route the table lacks: /thing postThing']);
  });

  test('operationIds are unique and the stable set is exactly the table', () => {
    const ids = ROUTES.map((route) => route.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...STABLE_IDS].sort());
  });

  test('every page asset of the portal bundle has a route', () => {
    const served = new Set(['index.html', ...Object.keys(PORTAL_ASSET_ROUTES)]);
    expect(PORTAL_ASSETS.map((asset) => asset.path).filter((path) => !served.has(path))).toEqual([]);
  });

  test('each template matches its own path and no other route shadows it', () => {
    for (const route of ROUTES) {
      const concrete = route.path.replace('{corpus}', 'demo').replace('{id}', '0001');
      expect([concrete, matchRoute(concrete)?.route.operationId]).toEqual([concrete, route.operationId]);
    }
  });

  test('the served document is the generated one, byte for byte', async () => {
    const root = await scratch(NAME);
    await writeCorpus(root, 'demo');
    const server = await start({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo' });
    running.push(server);
    const served = (await (await fetch(`${server.url}/openapi.json`)).json()) as Doc;
    expect(disagreements(served, ROUTES)).toEqual([]);
    expect(served).toEqual(JSON.parse(JSON.stringify(buildOpenApi())));
    expect(served.openapi).toBe('3.0.3');
  });
});
