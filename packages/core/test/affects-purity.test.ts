import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolveAffects } from '../src/affects/index.ts';
import { AdrFrontmatter, type Adr } from '../src/schema/adr.schema.ts';

function record(): Adr {
  return {
    frontmatter: AdrFrontmatter.parse({
      schemaVersion: '0.1.0',
      id: '0001',
      title: 'Use pure affects resolution',
      status: 'draft',
      date: '2026-07-18',
      deciders: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      affects: [{ type: 'path', pattern: 'packages/core/**' }],
      provenance: { authoredBy: 'human' },
    }),
    body: '',
    path: 'docs/adr/0001-pure.md',
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

describe('resolution-is-pure', () => {
  test('identical inputs produce identical outputs without mutating observable state', () => {
    const input = {
      records: [record()],
      changedFiles: ['packages/core/src/affects/index.ts'],
      snapshots: { changedDependencies: [{ name: 'react', version: '19.1.0' }] },
    };
    const envBefore = { ...process.env };

    const first = resolveAffects(input);
    const second = resolveAffects(input);

    expect(second).toEqual(first);
    expect(process.env).toEqual(envBefore);
  });

  test('affects resolver sources import or use no filesystem, process, network, or clock APIs', async () => {
    const sourceRoot = resolve(process.cwd(), 'packages/core/src/affects');
    const files = await listSourceFiles(sourceRoot);
    const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
    const combined = sources.join('\n');
    const forbiddenBuiltins =
      'fs|fs\\/promises|child_process|http|https|net|tls|dgram|dns|worker_threads|perf_hooks|os|process';
    const forbiddenBuiltinSpecifier = new RegExp(
      String.raw`(?:\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?|\brequire\(\s*|\bimport\(\s*)['"](?:node:)?(?:${forbiddenBuiltins})['"]`,
    );

    expect(combined).not.toMatch(forbiddenBuiltinSpecifier);
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
});
