import { afterEach, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyReimport, migrateMadr } from '../src/import/index.ts';
import type { Adr } from '../src/schema/adr.schema.ts';
import { cleanupTestDir, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'reimport-classify';

function importedRecord(id: string, sourceRef: string, fingerprint: string): Adr {
  return {
    path: sourceRef,
    body: '# Body\n',
    frontmatter: {
      schemaVersion: '0.1.0',
      id,
      title: `Imported ${id}`,
      status: 'proposed',
      date: '2026-07-18',
      deciders: [],
      consulted: [],
      informed: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      supersedes: [],
      relatesTo: [],
      conflictsWith: [],
      affects: [],
      assertions: [],
      provenance: {
        authoredBy: 'human',
        importedFrom: { sourceKind: 'madr', sourceRef, fingerprint },
      },
      externalRefs: [],
      complianceControls: [],
    },
  };
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
  await cleanupTestDir(`${DIR_NAME}-updated`);
});

describe('re-import classification', () => {
  test('classifies the full new/updated/diverged/unchanged matrix and is pure', () => {
    const sources = [
      { sourceRef: 'new.md', fingerprint: 'n' },
      { sourceRef: 'updated.md', fingerprint: 'new-updated' },
      { sourceRef: 'diverged.md', fingerprint: 'new-diverged' },
      { sourceRef: 'unchanged.md', fingerprint: 'same' },
    ];
    const records = [
      importedRecord('0002', 'updated.md', 'old-updated'),
      importedRecord('0003', 'diverged.md', 'old-diverged'),
      importedRecord('0004', 'unchanged.md', 'same'),
    ];
    const edited = (id: string) => id === '0003';

    const first = classifyReimport(sources, records, edited);
    const second = classifyReimport(sources, records, edited);

    expect(first).toEqual(second);
    expect(first).toEqual([
      { sourceRef: 'diverged.md', bucket: 'diverged', recordId: '0003' },
      { sourceRef: 'new.md', bucket: 'new' },
      { sourceRef: 'unchanged.md', bucket: 'unchanged', recordId: '0004' },
      { sourceRef: 'updated.md', bucket: 'updated', recordId: '0002' },
    ]);
  });


  test('updates unchanged local records when the source body changes', async () => {
    const root = await resetTestDir(`${DIR_NAME}-updated`);
    const path = join(root, 'docs/adr/0001-update.md');
    await writeText(
      path,
      '---\ntitle: Update from source\nstatus: proposed\ndate: 2026-07-18\n---\n# Update from source\n\nOriginal upstream body.\n',
    );
    await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const imported = await readFile(path, 'utf8');
    const oldFingerprint = /fingerprint: ([a-f0-9]{64})/.exec(imported)?.[1];
    await writeFile(path, imported.replace('Original upstream body.', 'Updated upstream body.'), 'utf8');

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const updated = await readFile(path, 'utf8');
    const newFingerprint = /fingerprint: ([a-f0-9]{64})/.exec(updated)?.[1];

    expect(result.results).toEqual([expect.objectContaining({ outcome: 'updated', path: 'docs/adr/0001-update.md' })]);
    expect(newFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(newFingerprint).not.toBe(oldFingerprint);
    expect(updated).toContain('Updated upstream body.');
  });

  test('leaves diverged records byte-identical on disk', async () => {
    const root = await resetTestDir(DIR_NAME);
    const path = join(root, 'docs/adr/0001-diverge.md');
    await writeText(
      path,
      '---\ntitle: Keep diverged local edits\nstatus: proposed\ndate: 2026-07-18\n---\n# Keep diverged local edits\n\nOriginal body.\n',
    );
    await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const imported = await readFile(path, 'utf8');
    await writeFile(path, imported.replace('Original body.', 'Locally edited body.'), 'utf8');
    const beforeReimport = await readFile(path, 'utf8');

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr', recordEdited: (id) => id === '0001' });
    const afterReimport = await readFile(path, 'utf8');

    expect(result.results).toEqual([{ outcome: 'diverged', path: 'docs/adr/0001-diverge.md' }]);
    expect(result.divergence).toEqual([{ path: 'docs/adr/0001-diverge.md', sourceRef: 'docs/adr/0001-diverge.md' }]);
    expect(afterReimport).toBe(beforeReimport);
  });
});
