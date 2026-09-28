/**
 * Schema v0.2.0 (#235, ADR-0043): every `IsoDateTime` field is an RFC 3339
 * `date-time` with **mandatory seconds**. v0.1.0 also accepted a minutes-only
 * time; zod 4.5 dropped that (colinhacks/zod#6457), and the field's own
 * `format: date-time` never allowed it.
 *
 * A record declaring `schemaVersion: 0.1.0` is validated by the current rules,
 * not by v0.1.0's: `schemaVersion` is recorded, not dispatched on. That is the
 * decision ADR-0043 records, and the last test pins it so a change to it is a
 * visible, reviewed change rather than a silent one.
 */
import { describe, expect, test } from 'bun:test';
import { SCHEMA_VERSION } from '../src/schema/adr.schema.ts';
import { validateAdrFrontmatter } from '../src/validate/contract.ts';

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: '0001',
    title: 'Use a valid test record',
    status: 'proposed',
    date: '2026-07-18',
    ...overrides,
  };
}

const FIELDS: ReadonlyArray<[string, (value: string) => Record<string, unknown>]> = [
  ['provenance.importedFrom.importedAt', (v) => ({
    provenance: { importedFrom: { sourceKind: 'madr', sourceRef: 'x.md', fingerprint: 'f', importedAt: v } },
  })],
  ['review.queuedAt', (v) => ({ review: { queuedAt: v } })],
  ['review.escalatedAt', (v) => ({ review: { escalatedAt: v } })],
  ['review.decidedAt', (v) => ({ review: { decidedAt: v } })],
  ['evaluation.ranAt', (v) => ({ evaluation: { ranAt: v } })],
];

describe('IsoDateTime requires seconds (schema v0.2.0)', () => {
  test('the schema version is 0.2.0', () => {
    expect(SCHEMA_VERSION).toBe('0.2.0');
  });

  for (const [field, place] of FIELDS) {
    test(`${field}: minutes-only is rejected with the migration in the message`, () => {
      const { findings } = validateAdrFrontmatter(record(place('2026-01-01T12:30Z')), 'r.md');
      expect(findings).toHaveLength(1);
      expect(findings[0]?.field).toBe(field);
      expect(findings[0]?.message).toContain('2026-01-01T12:30:00Z');
    });

    test(`${field}: seconds, fractions and offsets are accepted`, () => {
      for (const value of ['2026-01-01T12:30:00Z', '2026-01-01T12:30:00.123Z', '2026-01-01T12:30:00+05:30']) {
        expect(validateAdrFrontmatter(record(place(value)), 'r.md').findings).toEqual([]);
      }
    });
  }

  test('a record declaring schemaVersion 0.1.0 is held to the current rule', () => {
    const minutesOnly = record({ schemaVersion: '0.1.0', review: { queuedAt: '2026-01-01T12:30Z' } });
    expect(validateAdrFrontmatter(minutesOnly, 'r.md').findings).toHaveLength(1);

    const migrated = record({ schemaVersion: '0.1.0', review: { queuedAt: '2026-01-01T12:30:00Z' } });
    expect(validateAdrFrontmatter(migrated, 'r.md').findings).toEqual([]);
  });
});
