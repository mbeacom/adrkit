/**
 * T050 — FR-017: the separator rule.
 *
 * ADR-0015, quoted: `isValidPrefixAndOrSuffix` "splits on `/` and **rejects any
 * value containing two or more separators**, and a value with **no** separator is
 * validated against the suffix predicate alone — so a bare `v1` passes without the
 * subdomain rule ever being consulted."
 *
 * Both branches are observed here, because they fail in opposite directions: an
 * implementation splitting on the first `/` accepts `a/b/c`; one requiring a prefix
 * rejects the `v1` ADR-0015 says passes.
 */

import { describe, expect, test } from 'bun:test';
import { splitOnSeparator } from '../src/admissibility/separator.ts';
import { validateApiVersion } from '../src/admissibility/validators.ts';

describe('T050 — two or more separators is rejected outright', () => {
  test('the split reports the count rather than a prefix and suffix', () => {
    expect(splitOnSeparator('backstage.io/v1/alpha')).toEqual({
      kind: 'too-many-separators',
      separatorCount: 2,
    });
    expect(splitOnSeparator('a/b/c/d')).toEqual({
      kind: 'too-many-separators',
      separatorCount: 3,
    });
  });

  test('rejection does not depend on what the parts contain', () => {
    // Every part below is individually valid: `backstage.io` is a DNS subdomain and
    // `v1`/`alpha` both satisfy the suffix predicate. The value is still rejected,
    // because the count is decided before the parts are looked at.
    expect(validateApiVersion('backstage.io/v1/alpha')).toBe(false);
    expect(validateApiVersion('backstage.io/v1alpha1')).toBe(true);
    expect(validateApiVersion('v1')).toBe(true);
  });

  test('a leading or trailing slash is two segments, and is rejected on its own terms', () => {
    // `/v1` splits into `['', 'v1']` — one separator, so the prefix rule applies to
    // the empty string and fails there. This is a different rejection path from the
    // two-separator one and must not be confused with it.
    expect(splitOnSeparator('/v1')).toEqual({ kind: 'prefix-and-suffix', prefix: '', suffix: 'v1' });
    expect(validateApiVersion('/v1')).toBe(false);

    expect(splitOnSeparator('v1/')).toEqual({ kind: 'prefix-and-suffix', prefix: 'v1', suffix: '' });
    expect(validateApiVersion('v1/')).toBe(false);
  });
});

describe('T050 — no separator is evaluated by the suffix predicate alone', () => {
  test('the split reports suffix-only, with no prefix at all', () => {
    expect(splitOnSeparator('v1')).toEqual({ kind: 'suffix-only', suffix: 'v1' });
  });

  test('a bare `v1` passes', () => {
    expect(validateApiVersion('v1')).toBe(true);
  });

  test('the subdomain rule is never consulted for an unseparated value', () => {
    // `V1` is not a valid DNS subdomain (uppercase), yet it satisfies the suffix
    // predicate `/^[a-z0-9A-Z]+$/`. It passes — which is only possible if the
    // subdomain rule really was skipped.
    expect(validateApiVersion('V1')).toBe(true);
    expect(validateApiVersion('V1/v1')).toBe(false);
  });

  test('the suffix predicate still applies to an unseparated value', () => {
    // "Evaluated by the suffix predicate alone" is not "unchecked".
    expect(validateApiVersion('v1-alpha')).toBe(false);
    expect(validateApiVersion('v1.alpha')).toBe(false);
    expect(validateApiVersion('a'.repeat(64))).toBe(false);
    expect(validateApiVersion('a'.repeat(63))).toBe(true);
  });
});

describe('T050 — exactly one separator consults both rules', () => {
  test('the split reports prefix and suffix separately', () => {
    expect(splitOnSeparator('backstage.io/v1alpha1')).toEqual({
      kind: 'prefix-and-suffix',
      prefix: 'backstage.io',
      suffix: 'v1alpha1',
    });
  });

  test('either half failing rejects the whole value', () => {
    expect(validateApiVersion('backstage.io/v1alpha1')).toBe(true);
    expect(validateApiVersion('Backstage.io/v1alpha1')).toBe(false);
    expect(validateApiVersion('backstage.io/v1-alpha1')).toBe(false);
  });
});
