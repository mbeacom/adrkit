import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { loadServerConfig, type ServerConfig } from '../src/config.ts';
import { createAdrkitServer, type ServerOptions } from '../src/server.ts';
import { acceptedRecordMarkdown, recordMarkdown, supersededRecordMarkdown } from '../../core/test/helpers.ts';

export const COMMIT_A = 'a'.repeat(40);
export const COMMIT_B = 'b'.repeat(40);
export const FIXED_NOW = () => new Date('2026-10-10T12:00:00Z');

const OUTPUT = resolve(process.cwd(), '.test-output', 'server');

export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

/** A fresh, realpath'd scratch root for one test. */
export async function scratch(name: string): Promise<string> {
  const path = join(OUTPUT, name);
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  return realpath(path);
}

export async function removeScratch(name: string): Promise<void> {
  await rm(join(OUTPUT, name), { recursive: true, force: true });
}

/**
 * A healthy corpus under `<root>/<key>`: an accepted record governing `src/**`, one it
 * superseded, a proposed record in review that relates to the accepted one, and a sidecar.
 */
export async function writeCorpus(root: string, key: string, commit: string | null = COMMIT_A): Promise<string> {
  const dir = join(root, key);
  const adr = join(dir, 'docs/adr');
  await writeText(
    join(adr, '0001-use-a-decision-corpus.md'),
    supersededRecordMarkdown('0001', '0002', 'Use a decision corpus'),
  );
  await writeText(
    join(adr, '0002-govern-source.md'),
    acceptedRecordMarkdown('0002', 'Govern the source tree').replace(
      'affects: []',
      'affects:\n  - type: path\n    pattern: "src/**"',
    ).replace('relatesTo: []', 'relatesTo: []\nsupersedes:\n  - "0001"'),
  );
  await writeText(
    join(adr, '0003-review-a-proposal.md'),
    recordMarkdown('0003', 'Review a proposal')
      .replace('status: draft', 'status: proposed')
      .replace('deciders: []', 'deciders: ["@reviewer"]')
      .replace('relatesTo: []', 'relatesTo:\n  - "0002"\nreviewBy: 2026-10-20'),
  );
  if (commit !== null) await writeSidecar(dir, commit);
  return dir;
}

export async function writeSidecar(dir: string, commit: string): Promise<void> {
  await writeText(join(dir, '.adrkit-corpus.json'), `${JSON.stringify({ commit })}\n`);
}

export interface Running {
  readonly url: string;
  readonly config: ServerConfig;
  close(): Promise<void>;
}

/** Load the configuration as the binary does and listen on an ephemeral loopback port. */
export async function start(
  env: Record<string, string>,
  extra: Partial<Omit<ServerOptions, 'config'>> = {},
): Promise<Running> {
  const config = await loadServerConfig(env, process.cwd());
  const server = createAdrkitServer({ config, now: FIXED_NOW, ...extra });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    config,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

export async function getJson(url: string): Promise<{ status: number; body: any; text: string; headers: Headers }> {
  const response = await fetch(url);
  const text = await response.text();
  let body: unknown = undefined;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: response.status, body, text, headers: response.headers };
}
