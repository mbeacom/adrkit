/**
 * `portal-data.json` v1's shape (ADR-0054 clauses 3 and 5), asserted on a file built from a
 * real SDK handle, so the renderer agent can rely on the exact key sets below.
 *
 * Clause 5: the queue shows raw review facts and no verdict, and the portal's own strings
 * never carry the ratifying command or a review verb as a command. Repository text (titles,
 * bodies) may, and is shown as data.
 *
 * ADR-0016 clause 2: observed failing. With `ready: entry.approvalCount >= (entry.quorum ?? 1)`
 * added to `queueEntryOf` in `src/data/build.ts`, "a queue entry carries the review facts and
 * no verdict" and "no key anywhere names a verdict" failed; the retained input is that line,
 * removed.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDecisions } from '@adrkit/sdk/src/index.ts';
import { cleanupTestDir, resetTestDir } from '../../core/test/helpers.ts';
import { writeHealthyCorpus } from '../../sdk/test/fixture.ts';
import { buildPathTable, buildPortalData, serializePortalData } from '../src/data/build.ts';
import { PORTAL_DATA_FILE, PORTAL_DATA_VERSION } from '../src/data/contract.ts';

const NAME = 'portal-contract';
let json: Record<string, any>;

beforeAll(async () => {
  const root = await resetTestDir(NAME);
  await writeHealthyCorpus(root);
  const handle = await openDecisions({ cwd: root });
  const table = buildPathTable([await handle.governing('src/sync/retry.ts')]);
  json = JSON.parse(
    serializePortalData(buildPortalData(handle, { dir: 'docs/adr', commit: null, asOf: '2026-07-05', pathTable: table })),
  );
});

afterAll(async () => {
  await cleanupTestDir(NAME);
});

const keys = (value: object) => Object.keys(value).sort();

describe('portal-data.json v1', () => {
  test('version and file name', () => {
    expect(PORTAL_DATA_VERSION).toBe('1');
    expect(PORTAL_DATA_FILE).toBe('portal-data.json');
    expect(json.version).toBe('1');
  });

  test('top-level keys', () => {
    expect(keys(json)).toEqual(['asOf', 'commit', 'dir', 'graph', 'issues', 'pathTable', 'queue', 'records', 'version']);
    expect(json.commit).toBeNull();
    expect('generatedAt' in json).toBe(false);
  });

  test('every record has the same key set, with null rather than absent supersededBy', () => {
    for (const record of json.records) {
      expect(keys(record)).toEqual(['body', 'date', 'id', 'path', 'standing', 'status', 'supersededBy', 'supersedes', 'tags', 'title']);
    }
  });

  test('issues, graph nodes and edges', () => {
    expect(keys(json.issues[0])).toEqual(['code', 'message', 'path', 'severity']);
    expect(keys(json.graph)).toEqual(['edges', 'nodes']);
    expect(keys(json.graph.nodes[0])).toEqual(['id', 'status', 'title']);
    expect(keys(json.graph.edges[0])).toEqual(['from', 'kind', 'to']);
    expect(new Set(json.graph.edges.map((edge: { kind: string }) => edge.kind))).toEqual(
      new Set(['supersedes', 'relatesTo', 'conflictsWith']),
    );
  });

  test('a queue entry carries the review facts and no verdict', () => {
    for (const entry of json.queue) {
      expect(keys(entry)).toEqual([
        'approvalCount',
        'deadline',
        'id',
        'itemFindingCount',
        'path',
        'quorum',
        'resolvedObjectionCount',
        'routingTargets',
        'slaState',
        'tier',
        'title',
        'unresolvedObjectionCount',
      ]);
    }
  });

  test('the path table and its entries', () => {
    expect(keys(json.pathTable)).toEqual(['capped', 'caps', 'entries', 'governedPathCount', 'state']);
    expect(keys(json.pathTable.caps)).toEqual(['bytes', 'count']);
    expect(json.pathTable.entries).toEqual([
      {
        path: 'src/sync/retry.ts',
        governing: [
          { id: '0001', evidence: ['affects'] },
          { id: '0002', evidence: ['marker'] },
        ],
        activeProposals: [{ id: '0005', evidence: ['affects'] }],
        history: [{ id: '0003', evidence: ['affects'] }],
      },
    ]);
  });

  test('no key anywhere names a verdict', () => {
    const found: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (/ready|eligib|ratif|verdict|approved|canAccept/i.test(key)) found.push(key);
          walk(child);
        }
      }
    };
    walk(json);
    expect(found).toEqual([]);
  });
});

describe('clause 5: the portal\'s own strings', () => {
  const srcDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src');

  async function sourceStrings(): Promise<Array<{ file: string; literal: string }>> {
    const entries = await readdir(srcDir, { withFileTypes: true, recursive: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => join(entry.parentPath ?? srcDir, entry.name))
      // The generated copies are checked by their own test (ADR-0054 clause 11).
      .filter((file) => !file.includes(`${join('src', 'vendor')}`));
    const literals: Array<{ file: string; literal: string }> = [];
    for (const file of files) {
      const code = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
      for (const match of code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)) {
        literals.push({ file, literal: match[0] });
      }
    }
    return literals;
  }

  test('never name the ratifying command, a review command, or a readiness word', async () => {
    const literals = await sourceStrings();
    expect(literals.length).toBeGreaterThan(20);
    const offenders = literals.filter(
      ({ literal }) =>
        /\badr\W+(accept|approve|object|resolve)\b/i.test(literal) || /\b(ready|eligible|ratifiable)\b/i.test(literal),
    );
    expect(offenders).toEqual([]);
  });
});
