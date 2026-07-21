import { describe, expect, test } from 'bun:test';
import { canonicalStringify, fingerprintOf, type Adr, type Finding } from '@adrkit/core';

/**
 * Permanent byte-compatibility guard for the fingerprint helpers promoted from
 * `@adrkit/mcp` to `@adrkit/core`. The reference vector below was computed once from
 * the current MCP private `fingerprintOf` projection over the inline fixture in this
 * file (records: [Adr], findings: [Finding], recordCount: 1, excludedCount: 0). The
 * promoted `@adrkit/core` implementation MUST reproduce it byte-for-byte forever.
 */
const REFERENCE_FINGERPRINT = '8a2752a34b09379f12886f252aebb02fd446054957ff00149e6f0939a29d4fcf';

const fixtureRecords = [
  {
    path: 'docs/adr/0001-x.md',
    frontmatter: {
      id: '0001',
      title: 'X',
      status: 'proposed',
      slaDays: 14,
      deciders: ['@alice'],
    },
    body: 'Body text.',
  },
] as unknown as Adr[];

const fixtureFindings: Finding[] = [
  { rule: 'demo-rule', severity: 'info', message: 'demo message', path: 'docs/adr/0001-x.md' },
];

describe('fingerprintOf (promoted to @adrkit/core)', () => {
  test('reproduces the frozen MCP reference vector byte-for-byte', () => {
    expect(fingerprintOf(fixtureRecords, fixtureFindings, 1, 0)).toBe(REFERENCE_FINGERPRINT);
  });

  test('is deterministic: two calls with identical input produce identical hex', () => {
    const first = fingerprintOf(fixtureRecords, fixtureFindings, 1, 0);
    const second = fingerprintOf(fixtureRecords, fixtureFindings, 1, 0);
    expect(first).toBe(second);
  });

  test('is key-order independent: reordered frontmatter keys hash identically', () => {
    const reordered = [
      {
        body: 'Body text.',
        path: 'docs/adr/0001-x.md',
        frontmatter: {
          deciders: ['@alice'],
          status: 'proposed',
          title: 'X',
          slaDays: 14,
          id: '0001',
        },
      },
    ] as unknown as Adr[];
    expect(fingerprintOf(reordered, fixtureFindings, 1, 0)).toBe(REFERENCE_FINGERPRINT);
  });

  test('returns 64 lowercase hex characters', () => {
    expect(fingerprintOf(fixtureRecords, fixtureFindings, 1, 0)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('canonicalStringify (promoted to @adrkit/core)', () => {
  test('sorts object keys by code-unit order at every level and omits undefined', () => {
    expect(canonicalStringify({ b: 1, a: { d: undefined, c: 2 } })).toBe('{"a":{"c":2},"b":1}');
  });

  test('serializes arrays in given order without sorting elements', () => {
    expect(canonicalStringify(['b', 'a', 'c'])).toBe('["b","a","c"]');
  });
});
