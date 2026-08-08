import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolveSourceMarkers, scanSourceMarkers } from '../src/markers/index.ts';
import { AdrFrontmatter, type Adr } from '../src/schema/adr.schema.ts';

/**
 * The mirror of `affects-purity.test.ts` for the inbound edge.
 *
 * `markers/read.ts` is the *one* file allowed to touch the filesystem, and that is the
 * whole design: the grammar is testable as text because the read is somewhere else. A
 * claim like that is worth nothing unless something checks it, so this file checks both
 * halves — the pure layer stays pure, and the boundary stays exactly one file wide.
 */
const MARKERS_ROOT = resolve(process.cwd(), 'packages/core/src/markers');

/** The deliberate filesystem boundary. Widening this list is the thing under test. */
const FILESYSTEM_BOUNDARY = ['read.ts'];

function record(id: string): Adr {
  return {
    frontmatter: AdrFrontmatter.parse({
      schemaVersion: '0.1.0',
      id,
      title: 'Use pure marker resolution',
      status: 'draft',
      date: '2026-07-18',
      deciders: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      affects: [],
      provenance: { authoredBy: 'human' },
    }),
    body: '',
    path: `docs/adr/${id}-pure.md`,
  };
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? listSourceFiles(path) : [path];
    }),
  );
  return files.flat().filter((path) => path.endsWith('.ts')).sort();
}

const FORBIDDEN_BUILTINS =
  'fs|fs\\/promises|child_process|http|https|net|tls|dgram|dns|worker_threads|perf_hooks|os|process';

const FORBIDDEN_BUILTIN_SPECIFIER = new RegExp(
  String.raw`(?:\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?|\brequire\(\s*|\bimport\(\s*)['"](?:node:)?(?:${FORBIDDEN_BUILTINS})['"]`,
);

describe('marker-resolution-is-pure', () => {
  test('identical inputs produce identical outputs without mutating observable state', () => {
    const source = ['// @adr 0001', '/* @adr 0002, 0003 */', 'const x = 1; // @adr 0009'].join('\n');
    const envBefore = { ...process.env };

    const firstScan = scanSourceMarkers(source, 'src/sync.ts');
    const secondScan = scanSourceMarkers(source, 'src/sync.ts');
    expect(secondScan).toEqual(firstScan);

    const input = { records: [record('0001'), record('0002')], markers: firstScan.markers };
    const first = resolveSourceMarkers(input);
    const second = resolveSourceMarkers(input);

    expect(second).toEqual(first);
    expect(process.env).toEqual(envBefore);
  });

  test('scanning does not mutate the markers a previous scan handed back', () => {
    const scan = scanSourceMarkers('// @adr 0001', 'src/sync.ts');
    const snapshot = structuredClone(scan.markers);

    resolveSourceMarkers({ records: [record('0001')], markers: scan.markers });

    expect(scan.markers).toEqual(snapshot);
  });

  test('the marker sources outside the read boundary use no filesystem, process, network, or clock APIs', async () => {
    const files = await listSourceFiles(MARKERS_ROOT);
    const pure = files.filter((file) => !FILESYSTEM_BOUNDARY.includes(file.slice(MARKERS_ROOT.length + 1)));
    const combined = (await Promise.all(pure.map((file) => readFile(file, 'utf8')))).join('\n');

    expect(combined).not.toMatch(FORBIDDEN_BUILTIN_SPECIFIER);
    expect(combined).not.toMatch(/\bnew\s+Date\s*\(/);
    expect(combined).not.toMatch(/\bDate\.now\s*\(/);
    expect(combined).not.toMatch(/\bperformance\./);
    expect(combined).not.toMatch(/\bMath\.random\s*\(/);
    expect(combined).not.toMatch(/\bfetch\s*\(/);
    expect(combined).not.toMatch(/\bWebSocket\b/);
    expect(combined).not.toMatch(/\bXMLHttpRequest\b/);
    expect(combined).not.toMatch(/\bprocess\./);
    expect(combined).not.toMatch(/\bBun\./);
  });

  test('the filesystem boundary is exactly the files declared to be it', async () => {
    const files = await listSourceFiles(MARKERS_ROOT);
    const touchesFilesystem = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (FORBIDDEN_BUILTIN_SPECIFIER.test(source)) touchesFilesystem.push(file.slice(MARKERS_ROOT.length + 1));
    }

    // Asserting the observed set, not a count: a new fs-importing module has to be
    // declared here deliberately rather than slipping in under a passing check.
    expect(touchesFilesystem.sort()).toEqual([...FILESYSTEM_BOUNDARY].sort());
  });
});
