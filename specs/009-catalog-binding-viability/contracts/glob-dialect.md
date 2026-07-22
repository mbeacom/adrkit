# Contract: Restricted Glob Dialect — Grammar, Options, Dotfile Behavior, and Migration Rule

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-004, FR-017,
User Story 1 Acceptance Scenario 2, User Story 5 Acceptance Scenario 4,
SC-001, SC-008. Companion to `data-model.md` §2 (`RestrictedGlobPattern`), §17
(`DotfilePolicyConfirmation`), `research.md` R9. Normative source: ADR-0012
"Restricted glob dialect."

## 1. Frozen Engine and Options (No Substitution)

| Property | Value | Source |
|---|---|---|
| Engine | `picomatch` | Already a `packages/core` dependency (`package.json` `"picomatch": "^4"`). |
| Exact version | `4.0.5` | Pinned in `bun.lock`; `research.md` A8 confirms this is already the engine both existing core matchers use. |
| Options | `{ dot: false, nocase: false, nonegate: true }` | Identical to `packages/core/src/affects/inert.ts`'s and `packages/core/src/affects/matchers/path.ts`'s own compile options — no new option combination is introduced. |

The spike MUST NOT introduce a second glob-matching dependency or a
different options combination for Option A's own validator (`research.md`
A8). Any future change to the engine, its version, or any option is a
**versioned reclassification** requiring snapshot regeneration/migration
evidence (§5 below) — never a silent substitution.

## 2. Allowed Character Set (Positive-Only, POSIX Segments)

A pattern is valid only if, after JSON decoding (`contracts/owned-paths-annotation.md`
§1), it consists exclusively of POSIX path segments built from: `A-Z`, `a-z`,
`0-9`, `_`, `-`, `.`, plus the glob metacharacters `*` (any-characters-in-segment),
a **whole-segment** `**` (cross-directory), and `?` (single character). No
other character or sequence is permitted — this is a narrower grammar than
the general `path`-matcher dialect ADR-0009 defines for the `path` matcher
type, chosen deliberately for the safest reversible defaults (ADR-0012).

## 3. Fixed Validation Order and Rejection Reasons (`research.md` R9)

Validate each decoded string in **exactly** this order, stopping at the first
rule that matches, so a pattern violating multiple rules always reports the
same one reason regardless of implementation:

1. `""` (empty string) → `"empty"`
2. Leading `/` → `"leading-slash"`
3. Absolute or drive/UNC path prefix (`^[A-Za-z]:` or `^\\\\`) → `"absolute-or-drive-or-unc"`
4. Any backslash `\` → `"backslash"`
5. Any NUL or control character (code point `< 0x20` or `0x7F`) → `"nul-or-control-char"`
6. Any brace `{` or `}` → `"brace"`
7. Any bracket `[` or `]` → `"bracket"`
8. Any parenthesis `(` or `)` (extglob) → `"parenthesis"`
9. Any comma `,` → `"comma"`
10. Leading `!` → `"leading-bang"`
11. Any path segment (splitting on `/`) equal to exactly `.` or exactly `..` → `"traversal-segment"`
12. Any empty segment (an internal `//` or a trailing `/`) → `"empty-segment"`
13. **Any character outside the positive allowlist** — anything other than
    `A-Z`, `a-z`, `0-9`, `_`, `-`, `.`, `/`, `*`, or `?` → `"disallowed-character"`.
    This closes the gap a pure blacklist (rules 1–12) cannot: characters such
    as `@`, `#`, `%`, `~`, `+`, `=`, `:`, `;`, `<`, `>`, `|`, `&`, `^`, or any
    non-ASCII/Unicode literal violate none of rules 1–12 individually but are
    still excluded by ADR-0012's own *positive* grammar ("[v]alid patterns
    are restricted to POSIX segments containing only literals... plus `*`, a
    whole-segment `**`, and `?`").
14. **Any `**` that does not occupy a whole path segment by itself** — any
    segment, after splitting on `/`, containing `**` as a strict substring
    alongside other characters (`a**b`, `**b`, `a**`, `foo/**bar`) →
    `"malformed-double-star"`. Only a segment that is *exactly* `**` is the
    allowed whole-segment double-star.
15. Otherwise: compile with `picomatch(pattern, { dot: false, nocase: false, nonegate: true })`. A compile-time exception this dialect's own rules did not already name → `"invalid-glob-compile-failure"` (expected to never occur in practice, given rules 1–14's exhaustiveness; present only as a defensive backstop). Compilation succeeding → `"accepted"`.

**Worked example — the brace/traversal near-miss** (`spec.md` Edge Cases):
`packages/{a,..}/**` is rejected at rule 6 (`"brace"`) — braces are rejected
outright regardless of their contents, so this pattern never reaches rule 11.
A brace-free pattern containing a bare `..` segment, e.g. `packages/../etc`,
is rejected at rule 11 (`"traversal-segment"`) instead. The two rejection
reasons remain independently distinguishable in the evidence bundle
(`data-model.md` §2 `RestrictedGlobPattern.outcome`).

## 4. Dotfile Policy — Confirmed Existing Behavior, Not New Code (FR-017; SC-008)

**Decision**: `picomatch`'s own native `dot: false` option already implements
the hardened contract's dotfile policy exactly: a bare `**` (or any pattern
that does not explicitly name a leading-dot segment) does **not** match a
changed-file path containing a dot-prefixed segment (e.g.
`.github/workflows/ci.yml`); a pattern that explicitly names that dot segment
(e.g. `.github/**`) **does** match it. This requires **zero new code** in
Option A's own validator beyond passing `dot: false` — a plain pass-through of
`picomatch`'s existing behavior, confirmed by direct execution
(`data-model.md` §17).

**Worked example**:

| Pattern | Changed file | `picomatch` result | Explanation |
|---|---|---|---|
| `.github/**` | `.github/workflows/ci.yml` | `true` | Pattern explicitly names the leading-dot segment. |
| `packages/**` | `.github/workflows/ci.yml` | `false` | Bare `**` under `dot: false` does not cross into a dot-segment path. |
| `**` | `.github/workflows/ci.yml` | `false` | A bare whole-tree `**` likewise does not imply dotfile ownership — matching ADR-0012's explicit "a bare `**` does not imply dotfile ownership" rule. |

**Source-level parity claim, precisely scoped (FR-017)**: this confirms only
*observed behavioral parity* between `packages/core/src/affects/matchers/path.ts`
and `packages/core/src/affects/inert.ts` for these tested cases — it is
**not** a claim of source-code equivalence. `path.ts` additionally implements
its own manual `hasDotSegment`/`patternAllowsDotSegment` guard logic that
`inert.ts` does not have; that guard is redundant with, but not identical in
implementation to, `picomatch`'s own `dot:false` handling for the cases this
spike tests. A future execution session MUST record only the behavioral
claim, never the broader source-code claim.

## 5. Migration/Reclassification Rule

Any future change to the frozen engine (`picomatch@4.0.5`), its options
(`dot`/`nocase`/`nonegate`), or the allowed character set in §2 is a
**versioned reclassification** of the entire dialect — never a silent,
patch-level tweak. It requires, at minimum: a new `globDialect.version`
value in every future `SnapshotEnvelope` (`data-model.md` §9), a documented
migration/regeneration procedure for any snapshot produced under the prior
dialect version, and evidence (mirroring this spike's own SC-001/SC-008)
that the new dialect/engine/options combination is re-verified against the
same worked examples in §3–§4 above. This spike does not perform any such
migration; it only fixes the rule that a future change must follow one.

## 6. Compilation Discipline

Each accepted pattern is compiled with `picomatch(...)` **exactly once** per
derivation run (`research.md` R9 item 3) — never once per match check against
each changed file in the fixed workload. This is a correctness property of
the design (repeated recompilation is not itself incorrect, only wasteful and
untested by this spike) as well as an input to `contracts/scale-and-security-measurement.md`'s
compile-cost measurement, which specifically isolates compile cost from match
cost by construction.
