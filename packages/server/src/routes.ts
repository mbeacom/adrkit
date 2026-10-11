/**
 * The route table: every path this server answers, as data
 * ([ADR-0055](../../../docs/adr/0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-t.md)
 * clauses 1, 2, 9, and 11).
 *
 * The dispatcher matches against this table and nothing else, and `/openapi.json` is generated
 * from it, so the document cannot describe a route the server does not have or miss one it
 * does. Every row's `method` is `GET`; `HEAD` is answered for each as `GET` without a body, and
 * any other method is refused before routing. `test/methods.test.ts` fails on a row with any
 * other method.
 *
 * **`operationId`s are a contract.** APIM's "REST API as MCP server" names its tools after
 * them (clause 15), so renaming one is a break for remote agents.
 */

import { CORPUS_KEY } from './config.ts';
import { RECORD_ID } from './validate.ts';

export type RouteKind = 'json' | 'html' | 'css' | 'javascript';

export interface RouteParameter {
  readonly name: string;
  readonly in: 'path' | 'query';
  readonly required: boolean;
  readonly description: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export interface RouteDefinition {
  readonly operationId: string;
  readonly method: 'GET';
  /** OpenAPI path template. A `{name}` segment matches one non-empty path segment. */
  readonly path: string;
  readonly summary: string;
  readonly kind: RouteKind;
  readonly parameters: readonly RouteParameter[];
  /** Status code to description, for the OpenAPI document. */
  readonly responses: Readonly<Record<string, string>>;
}

const corpusParameter: RouteParameter = {
  name: 'corpus',
  in: 'path',
  required: true,
  description: 'A configured corpus key.',
  schema: { type: 'string', pattern: CORPUS_KEY.source },
};

const ENVELOPE = 'The data, as { corpus, commit, data }, with commit from the corpus .adrkit-corpus.json.';
const CORPUS_ERRORS = {
  '404': 'No corpus is configured under this key.',
  '503': 'The corpus has no valid .adrkit-corpus.json, could not be loaded, or resolves outside the root.',
} as const;

/** The page bundle's files below `/portal/{corpus}/`, beside `index.html` and `portal-data.json`. */
export const PORTAL_ASSET_ROUTES: Readonly<Record<string, { operationId: string; kind: RouteKind; summary: string }>> = Object.freeze({
  'app.css': { operationId: 'getPortalStylesheet', kind: 'css', summary: "The decision portal's stylesheet." },
  'page/app.mjs': { operationId: 'getPortalApp', kind: 'javascript', summary: "The decision portal's page module." },
  'vendor/board-layout.mjs': { operationId: 'getPortalBoardLayout', kind: 'javascript', summary: "The decision portal's graph layout module." },
  'vendor/board-view.mjs': { operationId: 'getPortalBoardView', kind: 'javascript', summary: "The decision portal's graph view module." },
});

function corpusRoute(operationId: string, suffix: string, summary: string, extra: Partial<RouteDefinition> = {}): RouteDefinition {
  return {
    operationId,
    method: 'GET',
    path: `/api/v1/corpora/{corpus}/${suffix}`,
    summary,
    kind: 'json',
    parameters: [corpusParameter],
    responses: { '200': ENVELOPE, ...CORPUS_ERRORS },
    ...extra,
  };
}

export const ROUTES: readonly RouteDefinition[] = Object.freeze([
  {
    operationId: 'getHealth',
    method: 'GET',
    path: '/healthz',
    summary: 'Liveness. The one route whose answer is not tied to a commit.',
    kind: 'json',
    parameters: [],
    responses: { '200': 'The process is serving.' },
  },
  {
    operationId: 'getOpenApi',
    method: 'GET',
    path: '/openapi.json',
    summary: "This server's OpenAPI document, generated from its route table.",
    kind: 'json',
    parameters: [],
    responses: { '200': 'The OpenAPI document.' },
  },
  {
    operationId: 'listCorpora',
    method: 'GET',
    path: '/api/v1/corpora',
    summary: 'List the configured decision corpora and the commit each is served at.',
    kind: 'json',
    parameters: [],
    responses: { '200': 'The configured keys, each with its commit, or null when it is not being served.' },
  },
  corpusRoute('listRecords', 'records', 'List the architecture decision records of one corpus, without their bodies.'),
  corpusRoute('getRecord', 'records/{id}', 'Get one architecture decision record by id, with its raw Markdown body.', {
    parameters: [
      corpusParameter,
      { name: 'id', in: 'path', required: true, description: 'A record id: four or more digits, or a ULID.', schema: { type: 'string', pattern: RECORD_ID.source } },
    ],
    responses: { '200': ENVELOPE, '400': 'The id is not a record id.', '404': 'No such corpus, or no such record in it.', '503': CORPUS_ERRORS['503'] },
  }),
  corpusRoute('getGraph', 'graph', 'Get the decision relationship graph of one corpus. Supersession edges only unless kinds says otherwise.', {
    parameters: [
      corpusParameter,
      {
        name: 'kinds',
        in: 'query',
        required: false,
        description: 'A comma-separated subset of supersedes, relatesTo, and conflictsWith. Default: supersedes.',
        schema: { type: 'string' },
      },
    ],
    responses: { '200': ENVELOPE, '400': 'kinds is empty, names an unknown kind, or is repeated.', ...CORPUS_ERRORS },
  }),
  corpusRoute('getQueue', 'queue', 'Get the architecture review queue of one corpus and the SLA state of each proposal.', {
    parameters: [
      corpusParameter,
      {
        name: 'asOf',
        in: 'query',
        required: false,
        description: 'UTC calendar date the SLA states are computed against, YYYY-MM-DD. Default: today (UTC), echoed as asOf.',
        schema: { type: 'string', format: 'date' },
      },
    ],
    responses: { '200': 'The queue, as { corpus, commit, asOf, data }.', '400': 'asOf is not a real calendar date, or is repeated.', ...CORPUS_ERRORS },
  }),
  corpusRoute('getIssues', 'issues', 'Get the corpus findings of one corpus (the lint view).'),
  corpusRoute('getGoverning', 'governing', 'Get the decisions whose affects matchers reach an explicitly supplied repository path.', {
    parameters: [
      corpusParameter,
      {
        name: 'path',
        in: 'query',
        required: true,
        description: 'A repository-relative path, at most 1024 characters. Matched against affects only; never read.',
        schema: { type: 'string', maxLength: 1024 },
      },
    ],
    responses: { '200': `${ENVELOPE} Resolution is withheld, with the corpus issues, when the corpus has errors.`, '400': 'path is missing, invalid, or repeated.', ...CORPUS_ERRORS },
  }),
  {
    operationId: 'getPortal',
    method: 'GET',
    path: '/',
    summary: 'The decision portal: a redirect to the one corpus portal, or a list of them when several are configured.',
    kind: 'html',
    parameters: [],
    responses: { '200': 'A list of corpus portals.', '302': 'A redirect to the only corpus portal.' },
  },
  {
    operationId: 'getCorpusPortal',
    method: 'GET',
    path: '/portal/{corpus}/',
    summary: 'The decision portal page of one corpus (ADR-0054).',
    kind: 'html',
    parameters: [corpusParameter],
    responses: { '200': 'The page.', '404': CORPUS_ERRORS['404'] },
  },
  {
    operationId: 'getCorpusPortalData',
    method: 'GET',
    path: '/portal/{corpus}/portal-data.json',
    summary: "The portal's portal-data.json, built from the same handle and commit as the API, with no path table.",
    kind: 'json',
    parameters: [corpusParameter],
    responses: { '200': 'portal-data.json version 1.', ...CORPUS_ERRORS },
  },
  ...Object.entries(PORTAL_ASSET_ROUTES).map(
    ([asset, route]): RouteDefinition => ({
      operationId: route.operationId,
      method: 'GET',
      path: `/portal/{corpus}/${asset}`,
      summary: route.summary,
      kind: route.kind,
      parameters: [corpusParameter],
      responses: { '200': 'The file.', '404': CORPUS_ERRORS['404'] },
    }),
  ),
]);

export interface RouteMatch {
  readonly route: RouteDefinition;
  /** Raw (still percent-encoded) path segments by parameter name. */
  readonly params: Readonly<Record<string, string>>;
}

const COMPILED = ROUTES.map((route) => ({ route, segments: route.path.split('/') }));

/** Match a URL pathname against the table. Literal segments match exactly; `{name}` matches one non-empty segment. */
export function matchRoute(pathname: string): RouteMatch | undefined {
  const segments = pathname.split('/');
  for (const { route, segments: template } of COMPILED) {
    if (template.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < template.length; index++) {
      const expected = template[index]!;
      const actual = segments[index]!;
      if (expected.startsWith('{') && expected.endsWith('}')) {
        if (actual.length === 0) {
          matched = false;
          break;
        }
        params[expected.slice(1, -1)] = actual;
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return undefined;
}
