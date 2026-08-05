/**
 * T065 — SC-007: **observed failing for rules 1–14 only.**
 *
 * For each of rules 1 through 14, a pattern that violates *that* rule and **no
 * earlier one**, observed producing that rule's exact rejection reason.
 *
 * # Rule 15 is exempt, and that exemption is conformance rather than a gap
 *
 * `glob-dialect.md` §3 rule 15 describes `"invalid-glob-compile-failure"` as
 * "expected to never occur in practice, given rules 1–14's exhaustiveness; present
 * only as a defensive backstop". SC-007 accordingly requires only rules 1–14 to be
 * exercised and states that a run which never produces rule 15's rejection **is
 * conformant and MUST NOT be reported as a coverage gap**.
 *
 * Rule 15's `"accepted"` outcome **is** exercised here, by the valid patterns that
 * reach it. What is not exercised — and is not required to be — is its rejection.
 * This file says so explicitly rather than leaving a reader to infer that fourteen
 * out of fifteen means something is missing.
 *
 * **Fifteen rules is not fourteen required exercises, and neither is the trigger
 * count** (`data-model.md` §7.1: "Do not conflate the two numbers").
 *
 * # "and no earlier one" is the load-bearing half
 *
 * A pattern violating two rules must report the earlier one, so a fixture chosen
 * carelessly would exercise the wrong rule while appearing to exercise the right
 * one. Each fixture below is therefore checked twice: that it produces its own
 * rule's reason, and that it violates none of the rules before it.
 *
 * ADR-0016 evidence:
 * `specs/010-catalog-backstage/evidence/negative-cases/glob-rules/`.
 */

import { describe, expect, test } from 'bun:test';
import { createGlobCompiler } from '../src/glob/dialect.ts';
import {
  GLOB_RULES_REQUIRING_EXERCISE,
  GLOB_RULE_COUNT,
  type GlobOutcome,
  validateGlobPattern,
} from '../src/glob/validate.ts';

/**
 * One fixture per rule, 1–14, each violating that rule and no earlier one.
 *
 * The reasons are transcribed from `glob-dialect.md` §3's numbered list.
 */
const RULE_FIXTURES: readonly {
  readonly rule: number;
  readonly pattern: string;
  readonly outcome: GlobOutcome;
}[] = [
  { rule: 1, pattern: '', outcome: 'empty' },
  { rule: 2, pattern: '/packages/**', outcome: 'leading-slash' },
  { rule: 3, pattern: 'C:/packages/**', outcome: 'absolute-or-drive-or-unc' },
  { rule: 4, pattern: 'packages\\payments', outcome: 'backslash' },
  { rule: 5, pattern: 'packages/\u0000/payments', outcome: 'nul-or-control-char' },
  { rule: 6, pattern: 'packages/{a}/**', outcome: 'brace' },
  { rule: 7, pattern: 'packages/[ab]/**', outcome: 'bracket' },
  { rule: 8, pattern: 'packages/(a)/**', outcome: 'parenthesis' },
  { rule: 9, pattern: 'packages/a,b/**', outcome: 'comma' },
  { rule: 10, pattern: '!packages/**', outcome: 'leading-bang' },
  { rule: 11, pattern: 'packages/../etc', outcome: 'traversal-segment' },
  { rule: 12, pattern: 'packages//payments', outcome: 'empty-segment' },
  { rule: 13, pattern: 'packages/@scope/**', outcome: 'disallowed-character' },
  { rule: 14, pattern: 'packages/**bar', outcome: 'malformed-double-star' },
];

describe('T065 — the rule set', () => {
  test('there are fifteen rules', () => {
    expect(GLOB_RULE_COUNT).toBe(15);
  });

  test('fourteen of them require exercise', () => {
    expect(GLOB_RULES_REQUIRING_EXERCISE).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(GLOB_RULES_REQUIRING_EXERCISE).toHaveLength(14);
  });

  test('a fixture exists for every rule requiring exercise, and for no other', () => {
    expect(RULE_FIXTURES.map((fixture) => fixture.rule)).toEqual([
      ...GLOB_RULES_REQUIRING_EXERCISE,
    ]);
  });

  test('the fourteen outcomes are fourteen distinct values', () => {
    expect(new Set(RULE_FIXTURES.map((fixture) => fixture.outcome)).size).toBe(14);
  });
});

describe('T065 — each of rules 1\u201314, observed firing', () => {
  test.each(RULE_FIXTURES.map((fixture) => [fixture.rule, fixture.pattern, fixture] as const))(
    'rule %d on %j',
    (_rule, _pattern, fixture) => {
      const result = validateGlobPattern(fixture.pattern);
      expect(result.outcome).toBe(fixture.outcome);
      expect(result.rule).toBe(fixture.rule);
      expect(result.raw).toBe(fixture.pattern);
    },
  );

  test.each(RULE_FIXTURES.map((fixture) => [fixture.rule, fixture.pattern, fixture] as const))(
    'rule %d\u2019s fixture %j violates no earlier rule',
    (_rule, _pattern, fixture) => {
      // If it did, the reported reason would be the earlier rule's, and this fixture
      // would be exercising a rule it was not chosen for.
      const result = validateGlobPattern(fixture.pattern);
      expect(result.rule).not.toBeLessThan(fixture.rule);
      expect(result.rule).toBe(fixture.rule);
    },
  );
});

describe('T065 — first-match-wins, demonstrated where it matters', () => {
  test('\u00a73\u2019s worked example: the brace/traversal near-miss', () => {
    // "`packages/{a,..}/**` is rejected at rule 6 (`"brace"`) — braces are rejected
    // outright regardless of their contents, so this pattern never reaches rule 11."
    const braced = validateGlobPattern('packages/{a,..}/**');
    expect(braced.outcome).toBe('brace');
    expect(braced.rule).toBe(6);

    // "A brace-free pattern containing a bare `..` segment, e.g. `packages/../etc`,
    // is rejected at rule 11 (`"traversal-segment"`) instead."
    const traversal = validateGlobPattern('packages/../etc');
    expect(traversal.outcome).toBe('traversal-segment');
    expect(traversal.rule).toBe(11);

    // "The two rejection reasons remain independently distinguishable."
    expect(braced.outcome).not.toBe(traversal.outcome);
  });

  test('a leading slash reports rule 2, not rule 12\u2019s empty segment', () => {
    // `/a/b` splits to `['', 'a', 'b']` — an empty segment. Rule 2 is earlier.
    expect(validateGlobPattern('/a/b').rule).toBe(2);
  });

  test('a drive prefix reports rule 3, not rule 4\u2019s backslash or rule 13', () => {
    // `C:\Windows` violates rules 3, 4 and 13. Rule 3 is earliest.
    expect(validateGlobPattern('C:\\Windows').rule).toBe(3);
  });

  test('a UNC path reports rule 3, not rule 4', () => {
    expect(validateGlobPattern('\\\\host\\share').rule).toBe(3);
  });

  test('a brace with a comma reports rule 6, not rule 9', () => {
    expect(validateGlobPattern('packages/{a,b}/**').rule).toBe(6);
  });

  test('a leading bang on an otherwise disallowed pattern reports rule 10, not 13', () => {
    expect(validateGlobPattern('!packages/@scope').rule).toBe(10);
  });

  test('a pattern violating several rules reports the same one every time', () => {
    const outcomes = Array.from({ length: 5 }, () =>
      validateGlobPattern('C:\\{a,b}/[x]/(y)/../@'),
    );
    expect(new Set(outcomes.map((o) => `${o.rule}:${o.outcome}`)).size).toBe(1);
    expect(outcomes[0]?.rule).toBe(3);
  });
});

describe('T065 — rule 13 closes the gap a blacklist cannot (\u00a73)', () => {
  test.each(['@', '#', '%', '~', '+', '=', ':', ';', '<', '>', '|', '&', '^', '\u00e9', '\u4e2d'])(
    '%j violates none of rules 1\u201312 and is caught by rule 13',
    (character) => {
      const result = validateGlobPattern(`packages/a${character}b/**`);
      expect(result.outcome).toBe('disallowed-character');
      expect(result.rule).toBe(13);
    },
  );

  test('a colon not at position 2 is rule 13, not rule 3\u2019s drive prefix', () => {
    // Rule 3's regex is anchored: `^[A-Za-z]:`. A colon elsewhere is rule 13.
    expect(validateGlobPattern('packages/a:b').rule).toBe(13);
    expect(validateGlobPattern('C:/packages').rule).toBe(3);
  });
});

describe('T065 — rule 14: only a whole-segment `**` is allowed', () => {
  test.each(['a**b', '**b', 'a**', 'foo/**bar', 'foo/a**/b'])(
    '%j is `malformed-double-star`',
    (pattern) => {
      const result = validateGlobPattern(pattern);
      expect(result.outcome).toBe('malformed-double-star');
      expect(result.rule).toBe(14);
    },
  );

  test('a segment that is exactly `**` is the allowed form', () => {
    for (const pattern of ['**', 'packages/**', 'packages/**/src', '**/*.ts']) {
      expect(validateGlobPattern(pattern).outcome).toBe('accepted');
    }
  });

  test('a single `*` is unaffected', () => {
    expect(validateGlobPattern('packages/*/src').outcome).toBe('accepted');
    expect(validateGlobPattern('docs/*.md').outcome).toBe('accepted');
  });
});

describe('T065 — rule 15\u2019s `accepted` outcome is exercised; its rejection is not required', () => {
  test.each([
    'packages/payments/**',
    'packages/**',
    '**',
    'docs/*.md',
    'src/a?c.ts',
    '.github/**',
    'a-b_c.d/**',
  ])('%j is accepted at rule 15', (pattern) => {
    const result = validateGlobPattern(pattern);
    expect(result.outcome).toBe('accepted');
    expect(result.rule).toBe(15);
  });

  test('rule 15 not firing its rejection is conformant, and is not a coverage gap', () => {
    // Asserted as a statement about the exercised set rather than left implicit,
    // because "14 of 15" invites a reader to record a gap that SC-007 explicitly
    // forbids recording.
    const exercisedRejections = new Set(
      RULE_FIXTURES.map((fixture) => fixture.outcome),
    );
    expect(exercisedRejections.has('invalid-glob-compile-failure')).toBe(false);
    expect(exercisedRejections.size).toBe(14);
    expect(GLOB_RULE_COUNT - exercisedRejections.size).toBe(1);
  });

  test('the compile really is invoked, so `accepted` is a compile result', () => {
    // Without this, `accepted` could be reached by rule 14 falling through without
    // rule 15 running at all, and the "backstop" would be absent rather than unfired.
    const compiler = createGlobCompiler();
    expect(compiler.compileCount).toBe(0);
    validateGlobPattern('packages/**', compiler);
    expect(compiler.compileCount).toBe(1);
  });

  test('a rejected pattern never reaches the compile', () => {
    const compiler = createGlobCompiler();
    validateGlobPattern('packages/{a}/**', compiler);
    expect(compiler.compileCount).toBe(0);
  });
});
