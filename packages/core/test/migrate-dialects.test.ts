/**
 * Regression tests for adrkit#40 — `migrate --from madr` read status and date only
 * from YAML frontmatter, so MADR 2.x header bullets and Nygard `## Status` sections
 * silently imported as `proposed` dated `1970-01-01`.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractMadrBodyFields, migrateMadr } from '../src/import/index.ts';
import { parseFrontmatter } from '../src/parse/frontmatter.ts';
import { cleanupTestDir, resetTestDir, writeText } from './helpers.ts';

const DIR_NAME = 'migrate-dialects';

async function migratedFrontmatter(root: string, file: string): Promise<Record<string, unknown>> {
  const parsed = parseFrontmatter(await readFile(join(root, 'docs/adr', file), 'utf8'));
  return parsed.data as Record<string, unknown>;
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('extractMadrBodyFields', () => {
  test('reads the MADR 2.x header bullets', () => {
    expect(extractMadrBodyFields('# Use PostgreSQL\n\n* Status: accepted\n* Date: 2025-03-14\n')).toEqual({
      status: 'accepted',
      date: '2025-03-14',
    });
  });

  test('reads a dash bullet and bold field labels', () => {
    expect(extractMadrBodyFields('# T\n\n- **Status**: accepted\n- **Date**: 2025-03-14\n')).toEqual({
      status: 'accepted',
      date: '2025-03-14',
    });
  });

  test('reads the Nygard section form', () => {
    expect(extractMadrBodyFields('# Use PostgreSQL\n\n## Status\n\nAccepted\n\n## Context\n\nx\n')).toEqual({
      status: 'Accepted',
    });
  });

  test('ignores a Status-shaped line in prose below the header region', () => {
    const body = '# T\n\n## Context\n\n* Status: this sentence is not the record status\n';
    expect(extractMadrBodyFields(body)).toEqual({});
  });

  test('an empty Status section yields nothing rather than an empty string', () => {
    expect(extractMadrBodyFields('# T\n\n## Status\n\n## Context\n\nx\n')).toEqual({});
  });

  test('a pathological value is capped rather than driving the cleanup regexes', () => {
    const body = `# T\n\n* Status: accepted ${'['.repeat(200_000)}\n`;
    const started = performance.now();

    const fields = extractMadrBodyFields(body);

    expect(performance.now() - started).toBeLessThan(1000);
    expect(fields.status).toBeDefined();
    expect(fields.status!.length).toBeLessThanOrEqual(512);
  });
});

describe('migrate --from madr across MADR dialects (#40)', () => {
  test('preserves accepted status in all three dialects', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(join(dir, '0001-yaml.md'), '---\nstatus: accepted\ndate: 2025-03-14\n---\n# Use PostgreSQL\n');
    await writeText(join(dir, '0002-bullet.md'), '# Use PostgreSQL\n\n* Status: accepted\n* Date: 2025-03-14\n');
    await writeText(join(dir, '0003-nygard.md'), '# Use PostgreSQL\n\n## Status\n\naccepted\n');

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });

    expect((await migratedFrontmatter(root, '0001-yaml.md')).status).toBe('accepted');
    expect((await migratedFrontmatter(root, '0002-bullet.md')).status).toBe('accepted');
    expect((await migratedFrontmatter(root, '0003-nygard.md')).status).toBe('accepted');
    expect(result.findings.filter((f) => f.rule === 'import-status-unrecognized')).toEqual([]);
  });

  test('reads the declared date from a header bullet instead of writing the epoch', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-bullet.md'),
      '# Use PostgreSQL\n\n* Status: accepted\n* Date: 2025-03-14\n',
    );

    await migrateMadr({ cwd: root, dir: 'docs/adr' });

    expect((await migratedFrontmatter(root, '0001-bullet.md')).date).toBe('2025-03-14');
  });

  test('a genuinely dateless source still gets the epoch, but is reported', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/0001-nodate.md'), '# Use PostgreSQL\n\n* Status: accepted\n');

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });

    expect((await migratedFrontmatter(root, '0001-nodate.md')).date).toBe('1970-01-01');
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: 'import-date-missing', severity: 'warn', field: 'date' }),
    );
  });

  test('`superseded by <ref>` resolves against the migrated corpus', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(
      join(dir, '0001-old.md'),
      '# Use MySQL\n\n* Status: superseded by [ADR-0005](0005-use-postgresql.md)\n* Date: 2024-01-02\n',
    );
    await writeText(join(dir, '0005-new.md'), '# Use PostgreSQL\n\n* Status: accepted\n* Date: 2025-03-14\n');

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const frontmatter = await migratedFrontmatter(root, '0001-old.md');

    expect(frontmatter.status).toBe('superseded');
    expect(frontmatter.supersededBy).toBe('0005');
    expect(result.findings.filter((f) => f.rule === 'import-status-unrecognized')).toEqual([]);
  });

  test('a reference to an id this run does not write is rejected, not pointed at a stranger', async () => {
    const root = await resetTestDir(DIR_NAME);
    // The source corpus is unnumbered, so its "ADR-0001" is in a different id space
    // than the ids migration allocates. Writing it verbatim would fabricate an edge.
    await writeText(
      join(root, 'docs/adr/drop-mysql.md'),
      '# Drop MySQL\n\n* Status: superseded by [ADR-0001](use-postgres.md)\n',
    );
    await writeText(join(root, 'docs/adr/use-postgres.md'), '# Use PostgreSQL\n\n* Status: accepted\n');

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const frontmatter = await migratedFrontmatter(root, 'drop-mysql.md');

    expect(frontmatter.status).toBe('proposed');
    expect(frontmatter.supersededBy).toBeUndefined();
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: 'import-status-unrecognized', severity: 'warn' }),
    );
  });

  test('a record never supersedes itself', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/0001-self.md'), '# Use MySQL\n\n* Status: superseded by ADR-0001\n');

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const frontmatter = await migratedFrontmatter(root, '0001-self.md');

    expect(frontmatter.status).toBe('proposed');
    expect(frontmatter.supersededBy).toBeUndefined();
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: 'import-status-unrecognized', severity: 'warn' }),
    );
  });

  test('resolves against a successor imported by an earlier run', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(join(dir, '0005-new.md'), '# Use PostgreSQL\n\n* Status: accepted\n* Date: 2025-03-14\n');

    // First run imports only the successor; it is `unchanged` on the second run.
    await migrateMadr({ cwd: root, dir: 'docs/adr' });
    await writeText(
      join(dir, '0001-old.md'),
      '# Use MySQL\n\n* Status: superseded by [ADR-0005](0005-new.md)\n* Date: 2024-01-02\n',
    );
    const second = await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const frontmatter = await migratedFrontmatter(root, '0001-old.md');

    expect(second.results.find((r) => r.path.endsWith('0005-new.md'))?.outcome).toBe('unchanged');
    expect(frontmatter.status).toBe('superseded');
    expect(frontmatter.supersededBy).toBe('0005');
    expect(second.findings.filter((f) => f.rule === 'import-status-unrecognized')).toEqual([]);
  });

  test('`superseded by` with no recoverable id stays unrecognized rather than being coerced', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'docs/adr/0001-old.md'), '# Use MySQL\n\n* Status: superseded by a later decision\n');

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });

    expect((await migratedFrontmatter(root, '0001-old.md')).status).toBe('proposed');
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: 'import-status-unrecognized', severity: 'warn' }),
    );
  });

  test('frontmatter status wins over a conflicting body bullet, so re-migration is a no-op', async () => {
    const root = await resetTestDir(DIR_NAME);
    const file = join(root, 'docs/adr/0001-bullet.md');
    await writeText(file, '# Use PostgreSQL\n\n* Status: accepted\n* Date: 2025-03-14\n');

    await migrateMadr({ cwd: root, dir: 'docs/adr' });
    const afterFirst = await readFile(file, 'utf8');
    await migrateMadr({ cwd: root, dir: 'docs/adr' });

    expect(await readFile(file, 'utf8')).toBe(afterFirst);
  });

  test('the MADR 2.x template placeholder is not mistaken for a real status', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-placeholder.md'),
      '# Use PostgreSQL\n\n* Status: [proposed | rejected | accepted | deprecated]\n',
    );

    const result = await migrateMadr({ cwd: root, dir: 'docs/adr' });

    expect((await migratedFrontmatter(root, '0001-placeholder.md')).status).toBe('proposed');
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: 'import-status-unrecognized', severity: 'warn' }),
    );
  });
});
