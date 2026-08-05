/**
 * T066 — FR-031: rule-specific rejection reasons hold when a **mixed batch** of
 * patterns is validated, each pattern evaluated in isolation so no pattern's
 * outcome influences another's.
 *
 * `glob-dialect.md` §3 fixes per-pattern classification; `atomic-fail-closed.md` §2
 * separates that from whole-operation atomicity. This file tests the former, and
 * says plainly that it is not testing the latter: the whole-operation abort is
 * Phase E's, behind Barrier B.
 */

import { describe, expect, test } from 'bun:test';
import { createGlobCompiler } from '../src/glob/dialect.ts';
import { validateGlobPattern, validateGlobPatterns } from '../src/glob/validate.ts';
import { classifyPatterns } from '../src/ownership/derive.ts';

/** One pattern per distinct violation, plus two valid ones, deliberately interleaved. */
const MIXED = [
  'packages/payments/**',
  '',
  '/leading',
  'C:/drive',
  'back\\slash',
  'nul/\u0000/char',
  'braces/{a}',
  'brackets/[a]',
  'parens/(a)',
  'comma/a,b',
  '!bang',
  'traverse/../etc',
  'empty//segment',
  'disallowed/@scope',
  'malformed/**star',
  'docs/*.md',
] as const;

const EXPECTED = [
  'accepted',
  'empty',
  'leading-slash',
  'absolute-or-drive-or-unc',
  'backslash',
  'nul-or-control-char',
  'brace',
  'bracket',
  'parenthesis',
  'comma',
  'leading-bang',
  'traversal-segment',
  'empty-segment',
  'disallowed-character',
  'malformed-double-star',
  'accepted',
] as const;

describe('T066 — a mixed batch classifies each pattern individually', () => {
  test('every pattern gets its own rule-specific outcome', () => {
    expect(validateGlobPatterns(MIXED).map((pattern) => pattern.outcome)).toEqual([...EXPECTED]);
  });

  test('the batch contains all fourteen rejection reasons plus `accepted`', () => {
    const outcomes = new Set<string>(EXPECTED);
    expect(outcomes.size).toBe(15);
    expect(outcomes.has('accepted')).toBe(true);
    expect(outcomes.has('invalid-glob-compile-failure')).toBe(false);
  });

  test('each pattern\u2019s batch outcome equals its outcome validated alone', () => {
    // The operational content of "evaluated in isolation": batching changes nothing.
    const inBatch = validateGlobPatterns(MIXED);
    for (const [index, pattern] of MIXED.entries()) {
      expect(inBatch[index]).toEqual(validateGlobPattern(pattern));
    }
  });

  test('reordering the batch does not change any pattern\u2019s outcome', () => {
    const forward = new Map(
      validateGlobPatterns(MIXED).map((pattern) => [pattern.raw, pattern.outcome]),
    );
    const reversed = new Map(
      validateGlobPatterns([...MIXED].reverse()).map((pattern) => [pattern.raw, pattern.outcome]),
    );
    expect(reversed).toEqual(forward);
  });

  test('a valid pattern surrounded by invalid ones is still accepted', () => {
    const results = validateGlobPatterns(['', 'packages/**', '{bad}']);
    expect(results.map((pattern) => pattern.outcome)).toEqual(['empty', 'accepted', 'brace']);
  });

  test('an invalid pattern surrounded by valid ones still reports its own rule', () => {
    const results = validateGlobPatterns(['packages/**', 'traverse/../etc', 'docs/*.md']);
    expect(results.map((pattern) => pattern.outcome)).toEqual([
      'accepted',
      'traversal-segment',
      'accepted',
    ]);
  });

  test('a repeated pattern reports the same outcome both times', () => {
    // The shared compiler is a cache keyed by pattern; a cache that could change a
    // verdict on a second lookup would be exactly the cross-pattern influence
    // FR-031 forbids.
    const results = validateGlobPatterns(['braces/{a}', 'packages/**', 'braces/{a}']);
    expect(results[0]?.outcome).toBe('brace');
    expect(results[2]?.outcome).toBe('brace');
    expect(results[0]).toEqual(results[2] as (typeof results)[0]);
  });

  test('sharing a compiler across batches does not leak a verdict between them', () => {
    const compiler = createGlobCompiler();
    const first = validateGlobPatterns(['packages/**', 'bad/{a}'], compiler);
    const second = validateGlobPatterns(['bad/{a}', 'packages/**'], compiler);
    expect(first.map((p) => p.outcome)).toEqual(['accepted', 'brace']);
    expect(second.map((p) => p.outcome)).toEqual(['brace', 'accepted']);
  });
});

describe('T066 — the annotation-level batch classifier agrees', () => {
  test('`classifyPatterns` reports every pattern, not only the first rejection', () => {
    const classified = classifyPatterns([...MIXED]);
    expect(classified.map((pattern) => pattern.outcome)).toEqual([...EXPECTED]);
  });

  test('it is a reporting surface, distinct from derivation\u2019s stop-at-first', () => {
    // `deriveOwnership` stops at the first rejection because a derivation cannot
    // proceed past one. `classifyPatterns` does not, because a *report* that named
    // only the earliest offender would hide the rest.
    const classified = classifyPatterns(['', '/leading', 'braces/{a}']);
    expect(classified).toHaveLength(3);
    expect(classified.map((pattern) => pattern.outcome)).toEqual([
      'empty',
      'leading-slash',
      'brace',
    ]);
  });
});

describe('T066 — what this file does NOT demonstrate', () => {
  test('per-pattern classification is not whole-operation atomicity', () => {
    // `atomic-fail-closed.md` §2: the two are separate properties and "a future
    // execution session MUST test both properties independently; passing User Story
    // 1's per-rule tests does not itself demonstrate this contract."
    //
    // The whole-operation abort belongs to the assembled generator, which is
    // Phase E — behind Barrier B. Nothing here claims it.
    const results = validateGlobPatterns(['packages/**', 'bad/{a}']);
    expect(results.some((pattern) => pattern.outcome === 'accepted')).toBe(true);
    expect(results.some((pattern) => pattern.outcome !== 'accepted')).toBe(true);
  });
});
