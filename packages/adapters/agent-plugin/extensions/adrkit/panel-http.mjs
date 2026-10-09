// @ts-check
/**
 * The HTTP hardening both canvases share: `decision-review` (ADR-0046) and
 * `decision-board` (ADR-0050). One copy, so a panel cannot drift looser than
 * the other.
 *
 * A panel is a loopback HTTP page, and any local process or page can reach a
 * loopback port. Each open instance has its own server and a 32-byte token that
 * every route checks in constant time; a state-changing POST must also carry
 * the token in a header (which a foreign page cannot set without a CORS
 * preflight these servers never answer) and must not come from a foreign
 * `Origin`. Every response carries the same security headers.
 */

import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

/**
 * @import { IncomingMessage, ServerResponse } from 'node:http'
 */

/**
 * `frame-ancestors *` because the host frames the page; no `X-Frame-Options`.
 *
 * `style-src` allows inline style on purpose: the app applies its theme by
 * inserting `<style>` elements that define the documented tokens, and without
 * this every token falls back to the light-theme default. It costs nothing
 * here, because the pages build no style from data and have no HTML sink that
 * could insert one. Script stays `'self'` only. Do not "tighten" the style rule.
 */
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
  "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors *";

/** Request bodies are tiny; anything past this is refused. */
export const BODY_LIMIT = 64 * 1024;

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

/**
 * Compare a presented token with the instance's in constant time. A length
 * mismatch still runs one comparison, so a wrong length is not measurably
 * quicker to reject than a wrong value.
 *
 * @param {string} expected
 * @param {unknown} given
 * @param {(a: Buffer, b: Buffer) => boolean} [compare]
 */
export function tokenMatches(expected, given, compare = timingSafeEqual) {
  const want = Buffer.from(expected, 'utf8');
  const got = typeof given === 'string' ? Buffer.from(given, 'utf8') : null;
  if (got === null || got.length !== want.length) {
    compare(want, want);
    return false;
  }
  return compare(want, got);
}

export class BodyTooLarge extends Error {}

/**
 * Read a request body, refusing more than `limit` bytes without buffering it.
 *
 * @param {IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<string>}
 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) return reject(new BodyTooLarge());
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners('data');
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Every response goes through here, so the security headers are on all of
 * them: pages, assets, JSON, errors, and refusals.
 *
 * @param {ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @param {string} [type]
 * @param {Record<string, string>} [extra]
 */
export function reply(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': String(Buffer.byteLength(body)),
    ...extra,
  });
  res.end(body);
}

/** @param {ServerResponse} res @param {number} status @param {unknown} data */
export const replyJson = (res, status, data) => reply(res, status, JSON.stringify(data), 'application/json; charset=utf-8');

/** @param {string | string[] | undefined} value */
export const singleHeader = (value) => (Array.isArray(value) ? undefined : value);

/**
 * The checks a state-changing request must pass beyond the URL token: the same
 * token in a header, and no foreign `Origin`. A URL can leak (history, a
 * screenshot); the header cannot be set by another origin without a preflight.
 *
 * @param {{ token: string, origin: string }} instance
 * @param {IncomingMessage} req
 */
export function postAllowed(instance, req) {
  if (!tokenMatches(instance.token, singleHeader(req.headers['x-adrkit-token']))) return false;
  const origin = req.headers['origin'];
  return origin === undefined || origin === instance.origin;
}
