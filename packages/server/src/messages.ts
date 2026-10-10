/**
 * Every error the server answers with, as fixed text looked up by code
 * ([ADR-0055](../../../docs/adr/0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-th.md)
 * clause 8). No stderr, exception message, stack, or file system path reaches a response:
 * an error body is built from this table and nothing else.
 */

export const ERRORS = Object.freeze({
  'not-found': { status: 404, message: 'No route matches this path.' },
  'method-not-allowed': { status: 405, message: 'This server is read-only. Only GET and HEAD are supported.' },
  'corpus-not-found': { status: 404, message: 'No corpus is configured under this key.' },
  'record-not-found': { status: 404, message: 'No record with this id loaded from the corpus.' },
  'invalid-record-id': { status: 400, message: 'The record id must be four or more digits or a ULID.' },
  'missing-path': { status: 400, message: 'The path query parameter is required.' },
  'invalid-path': {
    status: 400,
    message: 'The path must be relative, at most 1024 characters, with no ".." segment, no leading "-", and no control character.',
  },
  'invalid-kinds': { status: 400, message: 'kinds must be a comma-separated subset of supersedes, relatesTo, and conflictsWith.' },
  'invalid-as-of': { status: 400, message: 'asOf must be a real UTC calendar date in YYYY-MM-DD form.' },
  'invalid-query': { status: 400, message: 'A query parameter was given more than once.' },
  'sidecar-missing': {
    status: 503,
    message: 'This corpus has no .adrkit-corpus.json naming its commit, so it is not served.',
  },
  'sidecar-invalid': {
    status: 503,
    message: 'This corpus has an .adrkit-corpus.json that is not a JSON object with a 40-hex commit, so it is not served.',
  },
  'corpus-unreadable': { status: 503, message: 'This corpus could not be loaded, so it is not served.' },
  'corpus-escapes-root': { status: 503, message: 'This corpus directory resolves outside the configured root, so it is not served.' },
  'corpus-changing': { status: 503, message: 'This corpus changed while it was loading. Retry shortly.' },
  internal: { status: 500, message: 'The server could not answer this request.' },
} as const satisfies Record<string, { status: number; message: string }>);

export type ErrorCode = keyof typeof ERRORS;

/** `adrkit-server --help`. */
export const USAGE = `usage: adrkit-server

A read-only REST API and decision portal over one or more adrkit corpora (ADR-0055).
This server authenticates no one. Run it on localhost or behind a gateway that does.

environment:
  ADRKIT_SERVER_CORPORA  required. key[=dir],... or a JSON object, e.g.
                         adrkit,platform=repos/platform
                         {"adrkit":"adrkit","platform":{"dir":"repos/platform","adrDir":"decisions"}}
                         A bare key means <root>/<key>. Each directory holds
                         .adrkit-corpus.json ({"commit":"<40 hex>"}) and its
                         records under adrDir (default docs/adr).
  ADRKIT_SERVER_ROOT     every corpus directory must stay inside it (default: cwd)
  ADRKIT_SERVER_HOST     address to bind (default 127.0.0.1)
  ADRKIT_SERVER_PORT     port to bind (default 8080)
`;

export const NON_LOOPBACK_WARNING =
  'adrkit-server: warning: This server authenticates no one, and it is bound to a non-loopback address. Anyone who can reach this port can read every configured corpus. Put an authenticating gateway in front of it.';
