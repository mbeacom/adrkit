/**
 * T064 — the **fifteen** ordered rules, first-match-wins.
 *
 * `glob-dialect.md` §3: "Validate each decoded string in **exactly** this order,
 * stopping at the first rule that matches, so a pattern violating multiple rules
 * always reports the same one reason regardless of implementation."
 *
 * # Fifteen rules; fourteen required exercises
 *
 * Rule 15 is the engine compile. Its `"invalid-glob-compile-failure"` outcome is,
 * in §3's own words, "expected to never occur in practice, given rules 1–14's
 * exhaustiveness; present only as a defensive backstop". SC-007 accordingly
 * requires rules **1–14** each to be exercised, and states that a run which never
 * produces rule 15's rejection **is conformant and MUST NOT be reported as a
 * coverage gap**. Rule 15's `"accepted"` outcome *is* exercised, by every valid
 * pattern reaching it.
 *
 * **Fifteen rules is not fourteen required exercises, and neither number is the
 * trigger count** — that is fifteen too, for an unrelated reason
 * (`data-model.md` §8). Three numbers, easy to fuse, and `data-model.md` §7.1 says
 * plainly: "Do not conflate the two numbers."
 *
 * # Why order is load-bearing rather than stylistic
 *
 * §3's worked example: `packages/{a,..}/**` is rejected at rule 6 (`"brace"`) —
 * braces are rejected outright regardless of their contents, so this pattern never
 * reaches rule 11. A brace-free pattern containing a bare `..` segment, e.g.
 * `packages/../etc`, is rejected at rule 11 (`"traversal-segment"`) instead. The two
 * remain independently distinguishable in the evidence bundle, which they would not
 * be if the order floated.
 *
 * @see `specs/009-catalog-binding-viability/contracts/glob-dialect.md` §2, §3
 * @see `specs/010-catalog-backstage/data-model.md` §7.1
 */

import { type GlobCompiler, createGlobCompiler } from './dialect.ts';

/** `data-model.md` §7.1. Fifteen outcomes: fourteen rejections plus `accepted`. */
export type GlobOutcome =
  | 'accepted'
  | 'empty'
  | 'leading-slash'
  | 'absolute-or-drive-or-unc'
  | 'backslash'
  | 'nul-or-control-char'
  | 'brace'
  | 'bracket'
  | 'parenthesis'
  | 'comma'
  | 'leading-bang'
  | 'traversal-segment'
  | 'empty-segment'
  | 'disallowed-character'
  | 'malformed-double-star'
  | 'invalid-glob-compile-failure';

/** `data-model.md` §7.1. */
export interface RestrictedGlobPattern {
  readonly raw: string;
  readonly outcome: GlobOutcome;
  /** Which of the fifteen rules decided. 1-based, matching §3's numbering. */
  readonly rule: number;
}

/**
 * `glob-dialect.md` §2's positive allowlist: `A-Z`, `a-z`, `0-9`, `_`, `-`, `.`,
 * `/`, `*`, `?`.
 *
 * This is rule 13, and §3 explains why a blacklist alone (rules 1–12) is
 * insufficient: `@`, `#`, `%`, `~`, `+`, `=`, `:`, `;`, `<`, `>`, `|`, `&`, `^` and
 * any non-ASCII literal "violate none of rules 1–12 individually but are still
 * excluded by ADR-0012's own *positive* grammar".
 */
const ALLOWED_CHARACTER = /^[A-Za-z0-9_\-./*?]$/u;

/** Rules 1–14 in §3's order. Rule 15 is the compile and is applied separately. */
const RULES: readonly {
  readonly rule: number;
  readonly outcome: Exclude<GlobOutcome, 'accepted' | 'invalid-glob-compile-failure'>;
  readonly violates: (pattern: string) => boolean;
}[] = [
  { rule: 1, outcome: 'empty', violates: (p) => p === '' },
  { rule: 2, outcome: 'leading-slash', violates: (p) => p.startsWith('/') },
  {
    rule: 3,
    outcome: 'absolute-or-drive-or-unc',
    violates: (p) => /^[A-Za-z]:/u.test(p) || p.startsWith('\\\\'),
  },
  { rule: 4, outcome: 'backslash', violates: (p) => p.includes('\\') },
  {
    rule: 5,
    outcome: 'nul-or-control-char',
    violates: (p) =>
      [...p].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 0x20 || code === 0x7f;
      }),
  },
  { rule: 6, outcome: 'brace', violates: (p) => p.includes('{') || p.includes('}') },
  { rule: 7, outcome: 'bracket', violates: (p) => p.includes('[') || p.includes(']') },
  { rule: 8, outcome: 'parenthesis', violates: (p) => p.includes('(') || p.includes(')') },
  { rule: 9, outcome: 'comma', violates: (p) => p.includes(',') },
  { rule: 10, outcome: 'leading-bang', violates: (p) => p.startsWith('!') },
  {
    rule: 11,
    outcome: 'traversal-segment',
    violates: (p) => p.split('/').some((segment) => segment === '.' || segment === '..'),
  },
  {
    rule: 12,
    outcome: 'empty-segment',
    // Rule 2 has already rejected a leading `/`, so any empty segment reaching here
    // is an internal `//` or a trailing `/`, exactly as §3 describes.
    violates: (p) => p.split('/').some((segment) => segment === ''),
  },
  {
    rule: 13,
    outcome: 'disallowed-character',
    violates: (p) => [...p].some((character) => !ALLOWED_CHARACTER.test(character)),
  },
  {
    rule: 14,
    outcome: 'malformed-double-star',
    // "Only a segment that is *exactly* `**` is the allowed whole-segment
    // double-star." `a**b`, `**b`, `a**`, `foo/**bar` all violate this.
    violates: (p) =>
      p.split('/').some((segment) => segment.includes('**') && segment !== '**'),
  },
];

/** The number of rules `glob-dialect.md` §3 defines. Fifteen, including the compile. */
export const GLOB_RULE_COUNT = RULES.length + 1;

/**
 * The rules SC-007 requires to be exercised: **1–14**.
 *
 * Rule 15 is deliberately excluded, and its exclusion is conformant rather than a
 * gap — see the module note.
 */
export const GLOB_RULES_REQUIRING_EXERCISE = RULES.map((rule) => rule.rule);

/**
 * Validate one pattern against the fifteen ordered rules.
 *
 * `compiler` is optional so a caller validating a single pattern in isolation need
 * not manage one. When it is supplied — which is what a real derivation run does —
 * the matcher built by rule 15 is retained in that compiler, and matching later
 * reuses it. That is FR-032's "validation and matching cannot diverge", made
 * structural: there is only ever one compiled matcher per pattern per run.
 */
export function validateGlobPattern(
  pattern: string,
  compiler: GlobCompiler = createGlobCompiler(),
): RestrictedGlobPattern {
  for (const rule of RULES) {
    if (rule.violates(pattern)) return { raw: pattern, outcome: rule.outcome, rule: rule.rule };
  }

  // Rule 15 — compile. A compile-time exception this dialect's own rules did not
  // already name is the defensive backstop; compilation succeeding is `accepted`.
  const compiled = compiler.compile(pattern);
  return compiled.ok
    ? { raw: pattern, outcome: 'accepted', rule: 15 }
    : { raw: pattern, outcome: 'invalid-glob-compile-failure', rule: 15 };
}

/**
 * Validate a batch, each pattern **in isolation**.
 *
 * FR-031: "A batch containing several distinct violations MUST classify each
 * individually when each is validated in isolation." No pattern's outcome
 * influences another's — there is no accumulated state between iterations, and the
 * shared compiler is a cache keyed by pattern, which cannot change a verdict.
 *
 * This returns every pattern's verdict rather than stopping at the first rejection.
 * That is a *reporting* choice and not a relaxation of atomicity:
 * `atomic-fail-closed.md` §1 still aborts the whole operation on any rejected
 * pattern, and that abort is Phase E's code. Reporting all of them is what lets the
 * abort say which patterns were at fault rather than only the earliest.
 */
export function validateGlobPatterns(
  patterns: readonly string[],
  compiler: GlobCompiler = createGlobCompiler(),
): readonly RestrictedGlobPattern[] {
  return patterns.map((pattern) => validateGlobPattern(pattern, compiler));
}
