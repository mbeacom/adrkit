/**
 * One configured corpus: its sidecar, its loaded handle, and the swap between handles
 * ([ADR-0055](../../../docs/adr/0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-th.md)
 * clauses 4 and 5).
 *
 * **The sidecar contract, worded as in ADR-0055 clause 4 and ADR-0056 clause 4:**
 * `.adrkit-corpus.json` is a JSON object holding at least `{ "commit": "<40 hex>" }`, where
 * `commit` is the full 40-hex SHA of the tree written; the populator is its only writer,
 * writes it last, into a tree written aside and swapped in whole; a field added later is
 * additive.
 *
 * Every request reads the sidecar (one small file). The handle is reopened only when the
 * commit changes, with `openDecisions` alone, and kept only if the sidecar still names the
 * same commit after the load; a request already holding the old handle finishes on it.
 *
 * Two states keep serving the last good handle, both named by ADR-0056 clause 4's two-move
 * swap: the corpus directory briefly absent between the moves, and a load that failed or saw
 * the commit move. A directory that is present with a missing or invalid sidecar is not
 * served: clause 4 forbids an answer without a commit, and a stale one would be a lie about
 * the tree on disk. A directory that now resolves outside the root is not served either.
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DecisionSet } from '@adrkit/sdk/src/index.ts';
import { type CorpusConfig, isInside, isNotFound } from './config.ts';

export const SIDECAR_NAME = '.adrkit-corpus.json';
export const SIDECAR_COMMIT = /^[0-9a-f]{40}$/;
/** A sidecar is a few dozen bytes; anything past this is not one. */
const SIDECAR_MAX_BYTES = 64 * 1024;

export type SidecarRead =
  | { readonly state: 'valid'; readonly commit: string }
  | { readonly state: 'missing' }
  | { readonly state: 'invalid' }
  | { readonly state: 'directory-absent' };

/** Read and validate `<dir>/.adrkit-corpus.json`. Never throws. */
export async function readSidecar(dir: string): Promise<SidecarRead> {
  const path = join(dir, SIDECAR_NAME);
  let text: string;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > SIDECAR_MAX_BYTES) return { state: 'invalid' };
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (!isNotFound(error)) return { state: 'invalid' };
    try {
      await stat(dir);
      return { state: 'missing' };
    } catch (dirError) {
      return isNotFound(dirError) ? { state: 'directory-absent' } : { state: 'missing' };
    }
  }
  return parseSidecar(text);
}

/** Pure: the sidecar's commit, when `text` is a valid sidecar. */
export function parseSidecar(text: string): SidecarRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'invalid' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { state: 'invalid' };
  const commit = (parsed as { commit?: unknown }).commit;
  if (typeof commit !== 'string' || !SIDECAR_COMMIT.test(commit)) return { state: 'invalid' };
  return { state: 'valid', commit };
}

/** The handle methods the server calls. `governing` is called with `readMarkers: false` only. */
export type CorpusHandle = Pick<DecisionSet, 'records' | 'issues' | 'get' | 'queue' | 'graph' | 'governing'>;

/** `openDecisions`, or a stand-in in tests. */
export type CorpusOpener = (options: { cwd: string; dir: string }) => Promise<CorpusHandle>;

/** A corpus loaded at one commit. Immutable once built, except its per-`asOf` portal cache. */
export interface LoadedCorpus {
  readonly key: string;
  readonly commit: string;
  readonly adrDir: string;
  readonly handle: CorpusHandle;
  /** Serialized `portal-data.json` by `asOf`; a function of commit and `asOf` (clause 9). */
  readonly portal: Map<string, string>;
}

export type UnavailableCode = 'sidecar-missing' | 'sidecar-invalid' | 'corpus-unreadable' | 'corpus-escapes-root' | 'corpus-changing';

export type CorpusState = { readonly ok: true; readonly corpus: LoadedCorpus } | { readonly ok: false; readonly code: UnavailableCode };

export class CorpusHolder {
  readonly key: string;
  readonly #dir: string;
  readonly #adrDir: string;
  readonly #root: string;
  readonly #open: CorpusOpener;
  #loaded: LoadedCorpus | undefined;
  #pending: { readonly commit: string; readonly promise: Promise<CorpusState> } | undefined;

  constructor(config: CorpusConfig, root: string, open: CorpusOpener) {
    this.key = config.key;
    this.#dir = config.dir;
    this.#adrDir = config.adrDir;
    this.#root = root;
    this.#open = open;
  }

  /** The corpus as of its current sidecar, loading it when the commit changed. Never throws. */
  async current(): Promise<CorpusState> {
    const placement = await this.#placement();
    if (placement === 'escapes') return { ok: false, code: 'corpus-escapes-root' };
    const sidecar: SidecarRead = placement === 'absent' ? { state: 'directory-absent' } : await readSidecar(this.#dir);
    if (sidecar.state !== 'valid') {
      if (sidecar.state === 'directory-absent' && this.#loaded) return { ok: true, corpus: this.#loaded };
      return { ok: false, code: sidecar.state === 'invalid' ? 'sidecar-invalid' : 'sidecar-missing' };
    }
    if (this.#loaded?.commit === sidecar.commit) return { ok: true, corpus: this.#loaded };
    return this.#load(sidecar.commit);
  }

  /** Re-check confinement before every read: a directory swapped for a symlink out of the root is refused. */
  async #placement(): Promise<'inside' | 'absent' | 'escapes'> {
    try {
      return isInside(this.#root, await realpath(this.#dir)) ? 'inside' : 'escapes';
    } catch (error) {
      return isNotFound(error) ? 'absent' : 'escapes';
    }
  }

  #load(commit: string): Promise<CorpusState> {
    if (this.#pending?.commit === commit) return this.#pending.promise;
    const promise = this.#loadOnce(commit).finally(() => {
      if (this.#pending?.promise === promise) this.#pending = undefined;
    });
    this.#pending = { commit, promise };
    return promise;
  }

  async #loadOnce(commit: string): Promise<CorpusState> {
    const fallback = (code: UnavailableCode): CorpusState =>
      this.#loaded ? { ok: true, corpus: this.#loaded } : { ok: false, code };
    let handle: CorpusHandle;
    try {
      handle = await this.#open({ cwd: this.#dir, dir: this.#adrDir });
    } catch {
      return fallback('corpus-unreadable');
    }
    const after = await readSidecar(this.#dir);
    if (after.state !== 'valid' || after.commit !== commit) return fallback('corpus-changing');
    if (this.#loaded?.commit !== commit) {
      this.#loaded = Object.freeze({ key: this.key, commit, adrDir: this.#adrDir, handle, portal: new Map<string, string>() });
    }
    return { ok: true, corpus: this.#loaded };
  }
}
