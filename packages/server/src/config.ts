/**
 * The server's configuration
 * ([ADR-0055](../../../docs/adr/0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-th.md)
 * clauses 6 and 14), read from the environment once at start.
 *
 * | Variable                | Default      | Meaning                                                            |
 * | ----------------------- | ------------ | ------------------------------------------------------------------ |
 * | `ADRKIT_SERVER_CORPORA` | (required)   | The corpora, as `key[=dir],...` or as a JSON object (below).       |
 * | `ADRKIT_SERVER_ROOT`    | process cwd  | The root every corpus directory must stay inside.                  |
 * | `ADRKIT_SERVER_HOST`    | `127.0.0.1`  | Address to bind. A non-loopback value logs one fixed warning.      |
 * | `ADRKIT_SERVER_PORT`    | `8080`       | Port to bind.                                                      |
 *
 * `ADRKIT_SERVER_CORPORA` takes either form; both reach the same validated shape:
 *
 * - **List:** `adrkit,platform=repos/platform`. A bare `key` means `<root>/<key>`; `key=dir`
 *   names the directory, relative to the root or absolute inside it.
 * - **JSON:** `{"adrkit":"adrkit","platform":{"dir":"repos/platform","adrDir":"decisions"}}`.
 *   A value is the directory, or an object with `dir` (default `<root>/<key>`) and `adrDir`.
 *   No other key is accepted.
 *
 * A key is the `{corpus}` path segment and matches `^[a-z0-9][a-z0-9-]{0,63}$`. A corpus
 * directory is the tree a populator writes: it holds `.adrkit-corpus.json` at its top and the
 * records under `adrDir` (default `docs/adr`), so record paths read as they do in the
 * repository. Each directory is `realpath`-resolved at start (when it exists yet) and must stay
 * inside the root; the corpus holder checks that again before every load.
 */

import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const CORPUS_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const DEFAULT_ADR_DIR = 'docs/adr';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8080;

/** One configured corpus. */
export interface CorpusConfig {
  /** The `{corpus}` path segment. */
  readonly key: string;
  /** Absolute path of the corpus directory: its `realpath` at start, or the lexical path if it did not exist yet. */
  readonly dir: string;
  /** Records directory inside {@link dir}, POSIX, no leading `./` or trailing `/`. */
  readonly adrDir: string;
}

export interface ServerConfig {
  /** `realpath` of the confinement root. */
  readonly root: string;
  /** Sorted by key, in code-unit order. Never empty. */
  readonly corpora: readonly CorpusConfig[];
  readonly host: string;
  readonly port: number;
}

/** Fixed startup messages, looked up by code. No path or value from the environment is echoed. */
export const CONFIG_MESSAGES = Object.freeze({
  'corpora-missing': 'ADRKIT_SERVER_CORPORA is not set. Name at least one corpus, e.g. ADRKIT_SERVER_CORPORA=adrkit=.',
  'corpora-malformed': 'ADRKIT_SERVER_CORPORA is malformed. Use key[=dir],... or a JSON object of key to dir or {"dir","adrDir"}.',
  'corpus-key-invalid': 'A corpus key in ADRKIT_SERVER_CORPORA does not match ^[a-z0-9][a-z0-9-]{0,63}$.',
  'corpus-key-duplicate': 'A corpus key appears twice in ADRKIT_SERVER_CORPORA.',
  'corpus-dir-invalid': 'A corpus directory in ADRKIT_SERVER_CORPORA is empty, too long, or contains a control character.',
  'adr-dir-invalid': 'An adrDir in ADRKIT_SERVER_CORPORA must be a relative path with no ".." segment and no control character.',
  'corpus-escapes-root': 'A corpus directory resolves outside ADRKIT_SERVER_ROOT.',
  'root-unreadable': 'ADRKIT_SERVER_ROOT does not exist or cannot be resolved.',
  'port-invalid': 'ADRKIT_SERVER_PORT must be an integer from 0 to 65535.',
  'host-invalid': 'ADRKIT_SERVER_HOST must be a non-empty address with no whitespace or control character.',
});

export type ConfigErrorCode = keyof typeof CONFIG_MESSAGES;

export class ConfigError extends Error {
  readonly code: ConfigErrorCode;
  /** The offending corpus key, only when it already passed the key grammar. */
  readonly key: string | undefined;
  constructor(code: ConfigErrorCode, key?: string) {
    super(key === undefined ? CONFIG_MESSAGES[code] : `${CONFIG_MESSAGES[code]} (corpus "${key}")`);
    this.name = 'ConfigError';
    this.code = code;
    this.key = key;
  }
}

interface CorpusSpec {
  readonly key: string;
  readonly dir: string | undefined;
  readonly adrDir: string;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Parse `ADRKIT_SERVER_CORPORA` into specs, sorted by key. Pure. */
export function parseCorporaSpec(value: string | undefined): CorpusSpec[] {
  const text = (value ?? '').trim();
  if (text.length === 0) throw new ConfigError('corpora-missing');
  const raw = text.startsWith('{') ? specsFromJson(text) : specsFromList(text);
  if (raw.length === 0) throw new ConfigError('corpora-missing');
  const seen = new Set<string>();
  const specs: CorpusSpec[] = [];
  for (const entry of raw) {
    if (!CORPUS_KEY.test(entry.key)) throw new ConfigError('corpus-key-invalid');
    if (seen.has(entry.key)) throw new ConfigError('corpus-key-duplicate', entry.key);
    seen.add(entry.key);
    if (entry.dir !== undefined && (entry.dir.length === 0 || entry.dir.length > 4096 || CONTROL.test(entry.dir))) {
      throw new ConfigError('corpus-dir-invalid', entry.key);
    }
    specs.push({ key: entry.key, dir: entry.dir, adrDir: normalizeAdrDir(entry.adrDir ?? DEFAULT_ADR_DIR, entry.key) });
  }
  return specs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

interface RawSpec {
  key: string;
  dir: string | undefined;
  adrDir: string | undefined;
}

function specsFromList(text: string): RawSpec[] {
  return text.split(',').map((item) => {
    const entry = item.trim();
    if (entry.length === 0) throw new ConfigError('corpora-malformed');
    const at = entry.indexOf('=');
    if (at === -1) return { key: entry, dir: undefined, adrDir: undefined };
    const dir = entry.slice(at + 1).trim();
    if (dir.length === 0) throw new ConfigError('corpora-malformed');
    return { key: entry.slice(0, at).trim(), dir, adrDir: undefined };
  });
}

function specsFromJson(text: string): RawSpec[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigError('corpora-malformed');
  }
  if (!isPlainObject(parsed)) throw new ConfigError('corpora-malformed');
  return Object.entries(parsed).map(([key, value]): RawSpec => {
    if (typeof value === 'string') return { key, dir: value, adrDir: undefined };
    if (!isPlainObject(value)) throw new ConfigError('corpora-malformed');
    for (const field of Object.keys(value)) {
      if (field !== 'dir' && field !== 'adrDir') throw new ConfigError('corpora-malformed');
    }
    const { dir, adrDir } = value;
    if ((dir !== undefined && typeof dir !== 'string') || (adrDir !== undefined && typeof adrDir !== 'string')) {
      throw new ConfigError('corpora-malformed');
    }
    return { key, dir, adrDir };
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAdrDir(value: string, key: string): string {
  const trimmed = value.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  const normalized = trimmed.length === 0 ? '.' : trimmed;
  if (
    normalized.length > 1024 ||
    CONTROL.test(normalized) ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new ConfigError('adr-dir-invalid', key);
  }
  return normalized;
}

/** Whether `candidate` is `root` or below it. Both must already be absolute. */
export function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** `ADRKIT_SERVER_PORT`, or the default. */
export function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(value.trim())) throw new ConfigError('port-invalid');
  const port = Number(value.trim());
  if (port > 65535) throw new ConfigError('port-invalid');
  return port;
}

/** `ADRKIT_SERVER_HOST`, or the loopback default. */
export function parseHost(value: string | undefined): string {
  if (value === undefined) return DEFAULT_HOST;
  const host = value.trim();
  if (host.length === 0 || host.length > 255 || /[\s]/.test(host) || CONTROL.test(host)) {
    throw new ConfigError('host-invalid');
  }
  return host;
}

/**
 * Whether `host` names only the local machine. Anything else, `0.0.0.0` and `::` included,
 * is a non-loopback bind and gets the clause 14 warning.
 */
export function isLoopbackHost(host: string): boolean {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return (
    bare.toLowerCase() === 'localhost' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare) ||
    bare === '::1' ||
    /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.test(bare)
  );
}

/**
 * Read and validate the whole configuration. The only I/O is `realpath`: of the root, which
 * must exist, and of each corpus directory that exists yet. A directory a populator has not
 * written yet is accepted on its lexical path, which must already be inside the root.
 */
export async function loadServerConfig(env: Readonly<Record<string, string | undefined>>, cwd: string): Promise<ServerConfig> {
  const specs = parseCorporaSpec(env.ADRKIT_SERVER_CORPORA);
  const host = parseHost(env.ADRKIT_SERVER_HOST);
  const port = parsePort(env.ADRKIT_SERVER_PORT);

  let root: string;
  try {
    root = await realpath(resolve(cwd, env.ADRKIT_SERVER_ROOT ?? '.'));
  } catch {
    throw new ConfigError('root-unreadable');
  }

  const corpora: CorpusConfig[] = [];
  for (const spec of specs) {
    const lexical = resolve(root, spec.dir ?? spec.key);
    if (!isInside(root, lexical)) throw new ConfigError('corpus-escapes-root', spec.key);
    let dir: string;
    try {
      dir = await realpathOfExistingPrefix(lexical);
    } catch {
      throw new ConfigError('corpus-escapes-root', spec.key);
    }
    if (!isInside(root, dir)) throw new ConfigError('corpus-escapes-root', spec.key);
    corpora.push({ key: spec.key, dir, adrDir: spec.adrDir });
  }
  return { root, corpora, host, port };
}

/**
 * `realpath` of `path`, or, when it does not exist yet, `realpath` of its nearest existing
 * ancestor joined with the rest. A directory not yet written below a symlink that leaves the
 * root therefore still resolves outside it.
 */
async function realpathOfExistingPrefix(path: string): Promise<string> {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(await realpath(current), ...missing);
    } catch (error) {
      const parent = dirname(current);
      if (!isNotFound(error) || parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

export function isNotFound(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
