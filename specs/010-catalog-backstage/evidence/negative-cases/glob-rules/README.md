# Negative case: the restricted glob dialect's ordered rules

**Task**: T065 · **Discharges**: SC-007 · **Supports**: FR-030, FR-031
**Observed against**: `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus Phase D's own
uncommitted work; the mutation under test was the only additional change in the tree.
**Tools**: Bun 1.3.14, TypeScript 6.0.3, `picomatch@4.0.5` (read at runtime from the
installed dependency, never transcribed)
**Command for every case below**: `bun test test/glob-rules.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/glob-rules.test.ts`

## Fifteen rules; fourteen required exercises; rule 15's non-occurrence is conformant

`glob-dialect.md` §3 defines fifteen ordered rules. Rule 15 is the engine compile, and
its `invalid-glob-compile-failure` outcome is, in §3's own words, "expected to never
occur in practice, given rules 1–14's exhaustiveness; present only as a defensive
backstop". SC-007 accordingly requires rules **1–14** each to be exercised and states
that a run which never produces rule 15's rejection **is conformant and MUST NOT be
reported as a coverage gap**.

Rule 15's `accepted` outcome **is** exercised, by every valid pattern reaching it — and
`test/glob-rules.test.ts` asserts the compile really is invoked (`compileCount` goes
from 0 to 1) so that `accepted` cannot be reached by rule 14 falling through with the
backstop absent rather than merely unfired.

**Fifteen rules is not fourteen required exercises, and neither number is the trigger
count** — that is fifteen too, for an unrelated reason (`data-model.md` §7.1: "Do not
conflate the two numbers").

The permanent case supplies, for each of rules 1–14, a pattern that violates *that* rule
and **no earlier one**, and asserts both halves: that the rule fires, and that no earlier
rule does.

---

## Case 1 — rule 1 (`empty`) disabled

Input: [`case-1-rule-1-empty.patch`](./case-1-rule-1-empty.patch) ·
Output: [`case-1-rule-1-empty.observed.txt`](./case-1-rule-1-empty.observed.txt)

```
(fail) T065 — each of rules 1–14, observed firing > rule 1 on ""
Expected: "empty"
Received: "empty-segment"
Expected: 1
Received: 12
```

The most instructive of the three. The empty pattern is not merely unrejected — it falls
through to **rule 12** and is reported as `empty-segment`. First-match-wins ordering is
what makes a pattern's reported reason a function of the pattern rather than of which
rules happen to be enabled, and this is that property failing visibly.

## Case 2 — rule 13 (`disallowed-character`) disabled

Input: [`case-2-rule-13-disallowed-character.patch`](./case-2-rule-13-disallowed-character.patch) ·
Output: [`case-2-rule-13-disallowed-character.observed.txt`](./case-2-rule-13-disallowed-character.observed.txt)

Eighteen tests fail — the largest set, because rule 13 is the positive allowlist that
§3 says closes a gap "a pure blacklist (rules 1–12) cannot".

```
(fail) T065 — each of rules 1–14, observed firing > rule 13 on "packages/@scope/**"
(fail) T065 — rule 13 closes the gap a blacklist cannot (§3) > "@" violates none of rules 1–12 and is caught by rule 13
Expected: "disallowed-character"
Received: "accepted"
Expected: 13
Received: 15
```

`Received: "accepted"` at rule 15 is the exact failure §3 describes: characters such as
`@`, `#`, `%`, `~`, `+`, `=`, `:`, `;`, `<`, `>`, `|`, `&`, `^` and any non-ASCII
literal violate none of rules 1–12 individually, compile cleanly, and would be admitted
outright without the positive grammar. All fifteen such characters are exercised in the
permanent case.

## Case 3 — rule 14 (`malformed-double-star`) disabled

Input: [`case-3-rule-14-malformed-double-star.patch`](./case-3-rule-14-malformed-double-star.patch) ·
Output: [`case-3-rule-14-malformed-double-star.observed.txt`](./case-3-rule-14-malformed-double-star.observed.txt)

```
(fail) T065 — each of rules 1–14, observed firing > rule 14 on "packages/**bar"
(fail) T065 — rule 14: only a whole-segment `**` is allowed > "a**b" is `malformed-double-star`
Expected: "malformed-double-star"
Received: "accepted"
Expected: 14
Received: 15
```

Again `accepted` at rule 15: a partial-segment `**` compiles perfectly well, so the
engine will not catch it. Only the dialect's own rule will.

---

## The fourteen fixtures, restored

| Rule | Pattern | Outcome |
|---|---|---|
| 1 | `""` | `empty` |
| 2 | `/packages/**` | `leading-slash` |
| 3 | `C:/packages/**` | `absolute-or-drive-or-unc` |
| 4 | `packages\payments` | `backslash` |
| 5 | `packages/<NUL>/payments` | `nul-or-control-char` |
| 6 | `packages/{a}/**` | `brace` |
| 7 | `packages/[ab]/**` | `bracket` |
| 8 | `packages/(a)/**` | `parenthesis` |
| 9 | `packages/a,b/**` | `comma` |
| 10 | `!packages/**` | `leading-bang` |
| 11 | `packages/../etc` | `traversal-segment` |
| 12 | `packages//payments` | `empty-segment` |
| 13 | `packages/@scope/**` | `disallowed-character` |
| 14 | `packages/**bar` | `malformed-double-star` |

§3's worked example is asserted directly: `packages/{a,..}/**` reports rule 6
(`brace`) and never reaches rule 11, while `packages/../etc` reports rule 11
(`traversal-segment`) — "the two rejection reasons remain independently
distinguishable."

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all 72 tests pass, 0 fail.

## Standing constraints

ADR-0014 **rung 1 only**. Rule 15 not firing its rejection is conformant and is **not**
reported as a coverage gap anywhere in this feature's artifacts.
