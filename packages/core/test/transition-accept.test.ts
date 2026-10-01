import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acceptAdrSource, parseFrontmatter } from '@adrkit/core';

const DECIDED_AT = '2026-09-30T12:00:00Z';

function record(lines: { status?: string; provenance?: string; review?: string; extra?: string } = {}): string {
  return [
    '---',
    'schemaVersion: 0.2.0',
    'id: "0007"',
    'title: "Adopt a thing"',
    `status: ${lines.status ?? 'proposed'}`,
    'date: 2026-09-01',
    'deciders: ["@alice"]',
    'tags: [cli]',
    'scope: component',
    'reversibility: two-way-door',
    'blastRadius: component',
    'affects: []',
    ...(lines.provenance === undefined ? ['provenance:', '  authoredBy: agent-drafted'] : lines.provenance ? [lines.provenance] : []),
    ...(lines.review ? [lines.review] : []),
    ...(lines.extra ? [lines.extra] : []),
    '---',
    '',
    '# ADR-0007: Adopt a thing',
    '',
  ].join('\n');
}

function accept(source: string, by = '@bob') {
  return acceptAdrSource({ source, by, decidedAt: DECIDED_AT, path: 'docs/adr/0007-adopt.md' });
}

function changedLines(before: string, after: string): string[] {
  const old = new Set(before.split('\n'));
  return after.split('\n').filter((line) => !old.has(line));
}

describe('acceptAdrSource', () => {
  test('changes exactly status, provenance.ratifiedBy, and review.decidedAt', () => {
    const source = record({ review: 'review:\n  tier: async\n  tierReason: >-\n    Folded text\n    that must survive.' });
    const result = accept(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(changedLines(source, result.content)).toEqual([
      'status: accepted',
      '  ratifiedBy: "@bob"',
      `  decidedAt: ${DECIDED_AT}`,
    ]);
    expect(result.content.split('\n').length).toBe(source.split('\n').length + 2);
    const data = parseFrontmatter(result.content).data as Record<string, any>;
    expect(data.status).toBe('accepted');
    expect(data.provenance).toEqual({ authoredBy: 'agent-drafted', ratifiedBy: '@bob' });
    expect(data.review.decidedAt).toBe(DECIDED_AT);
    expect(data.review.tierReason).toBe('Folded text that must survive.');
  });

  test('keeps the body, inserts a child before the next key, and appends an absent block', () => {
    const source = record({ extra: 'reviewBy: 2027-01-01' });
    const result = accept(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('provenance:\n  authoredBy: agent-drafted\n  ratifiedBy: "@bob"\nreviewBy: 2027-01-01\nreview:\n  decidedAt: 2026-09-30T12:00:00Z\n---\n');
    expect(result.content.endsWith('# ADR-0007: Adopt a thing\n')).toBe(true);
  });

  test('adds both blocks when a human-authored record has neither', () => {
    const result = accept(record({ provenance: '' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('affects: []\nprovenance:\n  ratifiedBy: "@bob"\nreview:\n  decidedAt: 2026-09-30T12:00:00Z\n---');
  });

  test('replaces an existing value and keeps its quote style', () => {
    const result = accept(record({ provenance: "provenance:\n  authoredBy: agent\n  ratifiedBy: '@carol'" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain("  ratifiedBy: '@bob'");
    expect(result.content).not.toContain('@carol');
  });

  test('preserves CRLF line endings', () => {
    const source = record().replace(/\n/g, '\r\n');
    const result = accept(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.replace(/\r\n/g, '')).not.toContain('\n');
  });

  test('refuses a record that is not proposed', () => {
    expect(accept(record({ status: 'draft' }))).toMatchObject({ ok: false, code: 'not-proposed' });
    expect(accept(record({ status: 'rejected' }))).toMatchObject({ ok: false, code: 'not-proposed' });
  });

  test('refuses unresolved objections and an unmet quorum, and never counts --by as an approval', () => {
    expect(
      accept(record({ review: 'review:\n  objections:\n    - by: "@dan"\n      resolved: false' })),
    ).toMatchObject({ ok: false, code: 'unresolved-objections' });
    expect(accept(record({ review: 'review:\n  quorum: 2\n  approvals: ["@bob"]' }), '@bob')).toMatchObject({
      ok: false,
      code: 'quorum-not-met',
    });
    expect(accept(record({ review: 'review:\n  quorum: 1\n  approvals: ["@erin"]\n  objections:\n    - by: "@dan"\n      resolved: true' })).ok).toBe(true);
  });

  test('refuses a result the schema rejects, such as an accepted record with no deciders', () => {
    const source = record().replace('deciders: ["@alice"]', 'deciders: []');
    expect(accept(source)).toMatchObject({ ok: false, code: 'invalid-result' });
  });

  test('refuses flow-style blocks instead of reformatting them', () => {
    expect(accept(record({ provenance: 'provenance: { authoredBy: agent-drafted }' }))).toMatchObject({
      ok: false,
      code: 'unsupported-layout',
    });
  });

  test('validates its own inputs', () => {
    expect(accept(record(), 'bob')).toMatchObject({ ok: false, code: 'invalid-identity' });
    expect(acceptAdrSource({ source: record(), by: '@bob', decidedAt: '2026-09-30T12:00Z', path: 'x.md' })).toMatchObject({
      ok: false,
      code: 'invalid-decided-at',
    });
    expect(accept('no frontmatter')).toMatchObject({ ok: false, code: 'invalid-record' });
  });

  test('never changes a field it does not own, across every accepted record in this corpus', () => {
    // Real layouts — flow arrays, folded scalars, comments, nested maps — are the
    // point. Each accepted record is rolled back to `proposed` and accepted again.
    const dir = resolve(import.meta.dir, '../../../docs/adr');
    const files = readdirSync(dir).filter((file) => /^\d{4}-.+\.md$/.test(file));
    let exercised = 0;
    for (const file of files) {
      const original = readFileSync(join(dir, file), 'utf8');
      if (!/^status: accepted$/m.test(original)) continue;
      const proposed = original.replace(/^status: accepted$/m, 'status: proposed');
      const result = acceptAdrSource({ source: proposed, by: '@bob', decidedAt: DECIDED_AT, path: file });
      if (!result.ok) throw new Error(`${file}: ${result.code}: ${result.message}`);
      // status, ratifiedBy, decidedAt — plus a `review:` header when the block is new.
      const budget = /^review:/m.test(proposed) ? 3 : 4;
      const added = changedLines(proposed, result.content);
      if (added.length > budget) throw new Error(`${file} changed ${added.length} lines: ${added.join(' | ')}`);
      expect(result.content.split('\n').length - proposed.split('\n').length).toBeLessThanOrEqual(budget - 1);
      exercised += 1;
    }
    expect(exercised).toBeGreaterThan(20);
  });
});

describe('acceptAdrSource insertion order', () => {
  test('a child of an existing last block stays inside it when another block is appended', () => {
    // No provenance, and review is the last block: both insertions share the final offset.
    const source = record({ provenance: '', review: 'review:\n  tier: async' });
    const result = accept(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('review:\n  tier: async\n  decidedAt: 2026-09-30T12:00:00Z\nprovenance:\n  ratifiedBy: "@bob"\n---');
  });
});
