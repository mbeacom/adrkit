/**
 * The read-only HTTP server
 * ([ADR-0055](../../../docs/adr/0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-th.md)).
 *
 * `node:http` and nothing else (clause 10). The handler:
 *
 * 1. refuses every method but `GET` and `HEAD` with 405 and `Allow: GET, HEAD`, before
 *    routing, and never reads a request body (clause 2);
 * 2. matches the path against the route table, the same table `/openapi.json` is built from;
 * 3. answers each data route with one SDK call and a serialization, as
 *    `{ corpus, commit, data }` in canonical JSON, so the same commit and parameters always
 *    give the same bytes (clause 3);
 * 4. answers every error from the fixed table in `messages.ts`, whatever was thrown (clause 8).
 *
 * It writes no access log: a request line would carry caller-supplied paths, and clause 8
 * keeps those out of the log as well as out of responses.
 */

import { createHash } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { openDecisions } from '@adrkit/sdk/src/index.ts';
import { buildPortalData, canonicalJson, serializePortalData } from '@adrkit/portal/src/data/build.ts';
import { PORTAL_ASSETS } from '@adrkit/portal/src/page/assets.ts';
import type { ServerConfig } from './config.ts';
import { CORPUS_KEY } from './config.ts';
import { CorpusHolder, type CorpusOpener, type LoadedCorpus } from './corpus.ts';
import { ERRORS, type ErrorCode } from './messages.ts';
import { buildOpenApi } from './openapi.ts';
import { matchRoute, PORTAL_ASSET_ROUTES, type RouteDefinition } from './routes.ts';
import { edgeOf, governingOf, issueOf, queueOf, recordOf, recordSummaryOf } from './shapes.ts';
import { parseAsOf, parseKinds, RECORD_ID, utcDate, validateGoverningPath } from './validate.ts';

/** The CSP of the portal's own meta policy, plus `frame-ancestors 'none'`, which a meta policy cannot carry (clause 9). */
export const PORTAL_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/** Everything else: nothing may load, and nothing may frame it. */
export const API_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const CONTENT_TYPES = Object.freeze({
  json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  javascript: 'text/javascript; charset=utf-8',
});

export interface ServerOptions {
  readonly config: Pick<ServerConfig, 'root' | 'corpora'>;
  /** Clock for the default queue and portal `asOf`. Tests pass a fixed one. */
  readonly now?: () => Date;
  /** Corpus loader. Defaults to `openDecisions`. */
  readonly open?: CorpusOpener;
}

interface Reply {
  readonly status: number;
  readonly kind: keyof typeof CONTENT_TYPES;
  readonly body: string;
  readonly csp: string;
  readonly etag?: string;
  readonly location?: string;
}

interface RequestContext {
  readonly route: RouteDefinition;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly pathname: string;
}

class Refusal {
  constructor(readonly code: ErrorCode) {}
}

const OPENAPI_BODY = `${canonicalJson(buildOpenApi())}\n`;
const ASSET_BODIES = new Map(PORTAL_ASSETS.map((asset) => [asset.path, asset.contents]));

function etagOf(...parts: string[]): string {
  return `"${createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 40)}"`;
}

function errorReply(code: ErrorCode): Reply {
  const { status, message } = ERRORS[code];
  return { status, kind: 'json', csp: API_CSP, body: `${canonicalJson({ error: { code, message } })}\n` };
}

function jsonReply(value: unknown, etag?: string): Reply {
  return { status: 200, kind: 'json', csp: API_CSP, body: `${canonicalJson(value)}\n`, etag };
}

/** Read one query parameter: absent, or exactly once. Unknown parameters are ignored. */
function single(query: URLSearchParams, name: string): string | undefined {
  const values = query.getAll(name);
  if (values.length > 1) throw new Refusal('invalid-query');
  return values[0];
}

/** Build the request handler. Exported for tests that want no socket. */
export function createRequestHandler(options: ServerOptions): (request: IncomingMessage, response: ServerResponse) => void {
  const now = options.now ?? (() => new Date());
  const open: CorpusOpener = options.open ?? ((args) => openDecisions(args));
  const holders = new Map(options.config.corpora.map((corpus) => [corpus.key, new CorpusHolder(corpus, options.config.root, open)]));
  const keys = [...holders.keys()];

  async function loaded(ctx: RequestContext): Promise<LoadedCorpus> {
    const key = ctx.params.corpus ?? '';
    const holder = CORPUS_KEY.test(key) ? holders.get(key) : undefined;
    if (!holder) throw new Refusal('corpus-not-found');
    const state = await holder.current();
    if (!state.ok) throw new Refusal(state.code);
    return state.corpus;
  }

  /** The configured corpus key in the path, without loading it (the static portal files need no commit). */
  function knownKey(ctx: RequestContext): string {
    const key = ctx.params.corpus ?? '';
    if (!CORPUS_KEY.test(key) || !holders.has(key)) throw new Refusal('corpus-not-found');
    return key;
  }

  function envelope(ctx: RequestContext, corpus: LoadedCorpus, data: unknown, canonicalQuery = '', extra: Record<string, string> = {}): Reply {
    return jsonReply(
      { corpus: corpus.key, commit: corpus.commit, ...extra, data },
      etagOf(ctx.route.operationId, ctx.pathname, canonicalQuery, corpus.commit),
    );
  }

  async function handle(ctx: RequestContext): Promise<Reply> {
    switch (ctx.route.operationId) {
      case 'getHealth':
        return jsonReply({ status: 'ok' });
      case 'getOpenApi':
        return { status: 200, kind: 'json', csp: API_CSP, body: OPENAPI_BODY, etag: etagOf(OPENAPI_BODY) };
      case 'listCorpora': {
        const data = [];
        for (const [key, holder] of holders) {
          const state = await holder.current();
          data.push({ corpus: key, commit: state.ok ? state.corpus.commit : null });
        }
        return jsonReply({ corpus: null, commit: null, data });
      }
      case 'listRecords': {
        const corpus = await loaded(ctx);
        return envelope(ctx, corpus, corpus.handle.records.map(recordSummaryOf));
      }
      case 'getRecord': {
        const id = ctx.params.id ?? '';
        if (!RECORD_ID.test(id)) throw new Refusal('invalid-record-id');
        const corpus = await loaded(ctx);
        const record = corpus.handle.get(id);
        if (!record) throw new Refusal('record-not-found');
        return envelope(ctx, corpus, recordOf(record));
      }
      case 'getGraph': {
        const raw = single(ctx.query, 'kinds');
        let kinds: readonly ('supersedes' | 'relatesTo' | 'conflictsWith')[] | undefined;
        if (raw !== undefined) {
          const parsed = parseKinds(raw);
          if (!parsed.ok) throw new Refusal('invalid-kinds');
          kinds = parsed.value;
        }
        const corpus = await loaded(ctx);
        const graph = sdkCall(() => corpus.handle.graph(kinds === undefined ? {} : { kinds }), 'invalid-kinds');
        return envelope(
          ctx,
          corpus,
          { nodes: graph.nodes.map(recordSummaryOf), edges: graph.edges.map(edgeOf) },
          kinds === undefined ? '' : `kinds=${kinds.join(',')}`,
        );
      }
      case 'getQueue': {
        const raw = single(ctx.query, 'asOf');
        let asOf = utcDate(now());
        if (raw !== undefined) {
          const parsed = parseAsOf(raw);
          if (!parsed.ok) throw new Refusal('invalid-as-of');
          asOf = parsed.value;
        }
        const corpus = await loaded(ctx);
        const view = sdkCall(() => corpus.handle.queue({ asOf }), 'invalid-as-of');
        return envelope(ctx, corpus, queueOf(view), `asOf=${view.asOf}`, { asOf: view.asOf });
      }
      case 'getIssues': {
        const corpus = await loaded(ctx);
        return envelope(ctx, corpus, corpus.handle.issues.map(issueOf));
      }
      case 'getGoverning': {
        const raw = single(ctx.query, 'path');
        if (raw === undefined || raw.length === 0) throw new Refusal('missing-path');
        const path = validateGoverningPath(raw);
        if (!path.ok) throw new Refusal('invalid-path');
        const corpus = await loaded(ctx);
        // Clause 7: never read the file. The server holds the corpus, not the source tree.
        const answer = await corpus.handle.governing(path.value, { readMarkers: false });
        const hasErrors = corpus.handle.issues.some((issue) => issue.severity === 'error');
        return envelope(ctx, corpus, governingOf(answer, hasErrors), `path=${path.value}`);
      }
      case 'getPortal':
        return portalIndex();
      case 'getCorpusPortal': {
        knownKey(ctx);
        return staticFile('index.html', 'html');
      }
      case 'getCorpusPortalData': {
        const corpus = await loaded(ctx);
        const asOf = utcDate(now());
        let body = corpus.portal.get(asOf);
        if (body === undefined) {
          body = serializePortalData(
            buildPortalData(corpus.handle, { dir: corpus.adrDir, commit: corpus.commit, asOf, pathTable: { state: 'absent' } }),
          );
          corpus.portal.clear();
          corpus.portal.set(asOf, body);
        }
        return {
          status: 200,
          kind: 'json',
          csp: PORTAL_CSP,
          body,
          etag: etagOf(ctx.route.operationId, ctx.pathname, `asOf=${asOf}`, corpus.commit),
        };
      }
      default: {
        const asset = Object.entries(PORTAL_ASSET_ROUTES).find(([, route]) => route.operationId === ctx.route.operationId);
        if (!asset) throw new Refusal('not-found');
        knownKey(ctx);
        return staticFile(asset[0], asset[1].kind as Reply['kind']);
      }
    }
  }

  function staticFile(path: string, kind: Reply['kind']): Reply {
    const body = ASSET_BODIES.get(path);
    if (body === undefined) throw new Refusal('not-found');
    return { status: 200, kind, csp: PORTAL_CSP, body, etag: etagOf('asset', path, body) };
  }

  /** `/`: the one corpus portal, by a relative redirect so a gateway's base path survives; or a list of them. */
  function portalIndex(): Reply {
    if (keys.length === 1) {
      return { status: 302, kind: 'html', csp: PORTAL_CSP, body: '', location: `./portal/${keys[0]}/` };
    }
    const items = keys.map((key) => `<li><a href="./portal/${key}/">${key}</a></li>`).join('\n');
    const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Decision portals</title>
</head>
<body>
<h1>Decision portals</h1>
<ul>
${items}
</ul>
<p>Read-only. This server changes nothing.</p>
</body>
</html>
`;
    return { status: 200, kind: 'html', csp: PORTAL_CSP, body, etag: etagOf('index', body) };
  }

  return (request, response) => {
    respond(request, response).catch(() => {
      // Only a socket that failed mid-write reaches here; nothing about it is reported.
      response.destroy();
    });
  };

  async function respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? '';
    const head = method === 'HEAD';
    let reply: Reply;
    const extraHeaders: Record<string, string> = {};
    if (method !== 'GET' && !head) {
      // Clause 2: refused before routing; the body is never read, and the connection is
      // closed so an unread body cannot be taken for the next request.
      reply = errorReply('method-not-allowed');
      extraHeaders.Allow = 'GET, HEAD';
      extraHeaders.Connection = 'close';
    } else {
      reply = await route(request);
    }
    write(response, reply, head, request.headers['if-none-match'], extraHeaders);
  }

  async function route(request: IncomingMessage): Promise<Reply> {
    try {
      let url: URL;
      try {
        url = new URL(request.url ?? '/', 'http://adrkit.invalid');
      } catch {
        return errorReply('not-found');
      }
      const match = matchRoute(url.pathname);
      if (!match) return errorReply('not-found');
      return await handle({ route: match.route, params: match.params, query: url.searchParams, pathname: url.pathname });
    } catch (error) {
      return errorReply(error instanceof Refusal ? error.code : 'internal');
    }
  }
}

/** An SDK call whose `RangeError` is the caller's bad value, not a server fault. */
function sdkCall<T>(call: () => T, code: ErrorCode): T {
  try {
    return call();
  } catch (error) {
    if (error instanceof RangeError) throw new Refusal(code);
    throw error;
  }
}

function write(response: ServerResponse, reply: Reply, head: boolean, ifNoneMatch: string | undefined, extra: Record<string, string>): void {
  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPES[reply.kind],
    'Content-Security-Policy': reply.csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
    ...extra,
  };
  if (reply.location !== undefined) headers.Location = reply.location;
  if (reply.etag !== undefined) {
    headers.ETag = reply.etag;
    if (reply.status === 200 && ifNoneMatch !== undefined && ifNoneMatch.split(',').some((tag) => tag.trim() === reply.etag)) {
      response.writeHead(304, headers);
      response.end();
      return;
    }
  }
  const body = Buffer.from(reply.body, 'utf8');
  headers['Content-Length'] = String(body.byteLength);
  response.writeHead(reply.status, headers);
  response.end(head ? undefined : body);
}

/** An `http.Server` over {@link createRequestHandler}, not yet listening. */
export function createAdrkitServer(options: ServerOptions): Server {
  const server = createHttpServer(createRequestHandler(options));
  // No request may hold a socket open indefinitely.
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
