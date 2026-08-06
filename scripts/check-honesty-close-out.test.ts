/**
 * T100 — the final honesty close-out.
 *
 * # The design constraint that dominates this file
 *
 * ADR-0014's state vocabulary is **binding**: `reference-verified` and `externally
 * validated` are the exact terms every artifact must use. So the maximally honest sentence
 * this feature can write —
 *
 * > *not `reference-verified` (rung 2), not `externally validated` (rung 3)*
 *
 * — necessarily contains both forbidden-looking strings. **A check that failed on bare
 * occurrence would fail the documentation being most careful and pass documentation that
 * said nothing at all.** It would actively push writers toward silence, which is the
 * opposite of what ADR-0014 and ADR-0016 are for.
 *
 * The rules below therefore match **assertion patterns** — a claim *of* a status — and
 * treat negations, prohibitions and prospective conditionals as conformant. Every rule is
 * verified on **both** a real claim and a real denial before it is trusted (ADR-0016): a
 * rule that fires on the claim but also fires on the denial is not a working rule, and a
 * rule that fires on neither is not a rule.
 *
 * That two-sided verification is what {@link CLAIMS} and {@link DENIALS} are for, and the
 * suite asserts every rule against every fixture in both sets.
 *
 * # The six assertions T100 requires
 *
 * | # | Assertion | Enforced as |
 * |---|---|---|
 * | i | no artifact claims ADR-0014 rung 2 or rung 3 | executable — `rung-2-claim`, `rung-3-claim` |
 * | ii | nothing schedules, implies, or prepares a release | executable — `release-*` rules + `check:clause8` |
 * | iii | ADR-0012 gate 3's outcome is recorded **as observed** | executable — recorded finding, asserted |
 * | iv | ADR-0012 gate 4 is recorded **unmet and not yet testable** | executable — recorded finding, asserted |
 * | v | no claim about Backstage as a running **system** | executable — `backstage-system-claim` |
 * | vi | only corpus **data** is third-party; the validation never is | executable — `third-party-validation` |
 *
 * @see `specs/010-catalog-backstage/evidence/honesty-close-out.md`
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');
const FEATURE = join(REPO_ROOT, 'specs', '010-catalog-backstage');
const CLOSE_OUT = join(FEATURE, 'evidence', 'honesty-close-out.md');

/** The Backstage commit every admissibility claim is scoped to. */
export const PINNED_BACKSTAGE_COMMIT = '1121a4facd9e321179d0402c3f355e4a649e84d9';

export interface HonestyRule {
  readonly id: string;
  /** Which of T100's six assertions this enforces. */
  readonly assertion: 'i' | 'ii' | 'iii' | 'iv' | 'v' | 'vi';
  readonly pattern: RegExp;
  readonly why: string;
}

/**
 * Rules that match an **assertive construction**.
 *
 * Each pattern matches the *shape* of a claim. Whether that shape is a claim or a denial
 * is decided separately, by {@link isNegated}, which reads the whole enclosing sentence.
 *
 * Lookbehind was tried first and does not work. It sees only the few characters before the
 * match, and real negations sit further away and take many forms — *"Nothing here is
 * reference-verified"*, *"no release is scheduled"*, *"It is not a claim … that Backstage
 * would reject it"*. All three are maximally honest sentences that already exist in this
 * repository, and all three were flagged by the lookbehind version of these rules. That is
 * precisely the failure mode T100 warns about, reproduced live, and it is why the negation
 * test is sentence-scoped.
 */
export const HONESTY_RULES: readonly HonestyRule[] = [
  {
    id: 'rung-2-claim',
    assertion: 'i',
    pattern: /\b(?:is|are|was|were|has\s+been|have\s+been)\s+(?:now\s+)?reference-verified\b/iu,
    why: 'ADR-0014 rung 2 is not claimed by this feature; only a denial of it may appear',
  },
  {
    id: 'rung-3-claim',
    assertion: 'i',
    pattern: /\b(?:is|are|was|were|has\s+been|have\s+been)\s+(?:now\s+)?externally[\s-]validated\b/iu,
    why: 'ADR-0014 rung 3 is not claimed by this feature; only a denial of it may appear',
  },
  {
    id: 'external-validation-claim',
    assertion: 'i',
    pattern: /\b(?:validated|verified|adopted)\s+by\s+(?:an?\s+)?(?:external|third[\s-]party|community)\b/iu,
    why: 'rung 3 requires a real, linkable external adoption; there is none',
  },
  {
    id: 'release-claim',
    assertion: 'ii',
    pattern:
      /\b(?:is|are|was|were|has\s+been|have\s+been)\s+(?:now\s+)?(?:published|released)\s+(?:to|on)\s+npm\b/iu,
    why: 'ADR-0020 clause 9 defers both the release vehicle and the decision to release',
  },
  {
    id: 'release-scheduled',
    assertion: 'ii',
    pattern: /\brelease\s+(?:is\s+)?scheduled\s+for\b/iu,
    why: 'clause 9 defers the decision to release at all; nothing may schedule one',
  },
  {
    id: 'gate-3-claimed-in-advance',
    assertion: 'iii',
    pattern: /\bgate\s*3\s+(?:is|has\s+been)\s+(?:now\s+)?(?:closed|met|satisfied|passed)\b/iu,
    why: 'gate 3 is ADR-0012\u2019s to close; this feature records an outcome, never a verdict',
  },
  {
    id: 'gate-4-claimed',
    assertion: 'iv',
    pattern: /\bgate\s*4\s+(?:is|has\s+been)\s+(?:now\s+)?(?:closed|met|satisfied|passed|failed)\b/iu,
    why: 'gate 4 is unmet and not yet testable; "failed" would imply it was tested',
  },
  {
    id: 'backstage-system-claim',
    assertion: 'v',
    pattern:
      /\bBackstage\s+(?:will|does|would|can)\s+(?:ingest|accept|reject|import|resolve|render|display)\b/iu,
    why:
      'the only warrant is what a pure validator predicate returns at the pinned commit; ' +
      'nothing here observed Backstage as a running system',
  },
  {
    id: 'third-party-validation',
    assertion: 'vi',
    pattern: /\bthird[\s-]party\s+(?:validation|verification|audit|review)\b/iu,
    why: 'only corpus DATA is third-party; the overlay, expectations, audit and checks are ours',
  },
];

/**
 * Cues that make an enclosing sentence a denial, a prohibition, or a conditional rather
 * than a claim.
 *
 * `MUST NOT` and `may not` are included because ADR-0014's own honesty rules are written
 * that way — *"MUST NOT be described as an external team"* — and a rule that flagged the
 * governing prohibition would be indefensible.
 */
export const NEGATION_CUES: readonly RegExp[] = [
  /\bnot\b/iu,
  /\bnever\b/iu,
  /\bno\b/iu,
  /\bnothing\b/iu,
  /\bneither\b/iu,
  /\bnor\b/iu,
  /\bcannot\b/iu,
  /\bwithout\b/iu,
  /\babsent\b/iu,
  /\bunless\b/iu,
  /\buntil\b/iu,
  /\bwould\s+be\b/iu,
  /\bforbid/iu,
  /\bprohibit/iu,
  /\bmust\s+not\b/iu,
  /\bmay\s+not\b/iu,
];

/**
 * The sentence containing `index`.
 *
 * Boundaries are `.`, `!`, `?`, a markdown table cell boundary (`|`), and a **blank
 * line** — but deliberately **not** a single newline.
 *
 * A single newline was tried and is wrong for this corpus, which is hard-wrapped markdown.
 * Two real cases from this repository proved it:
 *
 * - `nothing\nhere is reference-verified (rung 2)` — the wrap falls between the negation
 *   and what it negates;
 * - a bulleted list under the stem *"It does not warrant, and MUST NOT be written as:"*,
 *   where the negation is in the stem and the claim shape is in a bullet.
 *
 * Both are maximally honest passages, and a newline boundary flagged both. Paragraph scope
 * reads them correctly while still refusing to let a denial in one paragraph excuse a claim
 * in the next.
 *
 * Table cells stay their own scope: this feature states its status in tables as often as in
 * prose, and a row's negation lives in its own cell.
 */
export function enclosingSentence(text: string, index: number): string {
  const isBoundaryAt = (position: number): boolean => {
    const character = text[position];
    if (character === '.' || character === '!' || character === '?' || character === '|') return true;
    // A blank line: this newline and the next non-space character is also a newline.
    if (character === '\n') return /^[ \t]*\n/u.test(text.slice(position + 1));
    return false;
  };

  let start = index;
  while (start > 0 && !isBoundaryAt(start - 1)) start -= 1;

  let end = index;
  while (end < text.length && !isBoundaryAt(end)) end += 1;

  return text.slice(start, end);
}

/** The full line containing `index`. */
function lineAt(text: string, index: number): string {
  let start = index;
  while (start > 0 && text[start - 1] !== '\n') start -= 1;
  let end = index;
  while (end < text.length && text[end] !== '\n') end += 1;
  return text.slice(start, end);
}

/**
 * The colon-terminated lead-in immediately above a list item, if there is one.
 *
 * Markdown puts a blank line between a stem and its list, so paragraph scope cannot see
 * across it — yet *"It does not warrant, and MUST NOT be written as:"* followed by
 * *"- that Backstage would ingest it;"* is one logical sentence, and it exists verbatim in
 * `contracts/admissibility.md`. A list under a colon-terminated stem inherits the stem's
 * scope; a list under anything else does not.
 */
function listStem(text: string, index: number): string | undefined {
  const line = lineAt(text, index);
  if (!/^\s*(?:[-*+]|\d+\.)\s/u.test(line)) return undefined;

  // Walk up to the nearest non-empty line above the list.
  let cursor = index;
  while (cursor > 0 && text[cursor - 1] !== '\n') cursor -= 1;

  while (cursor > 0) {
    cursor -= 1; // step onto the newline ending the previous line
    let start = cursor;
    while (start > 0 && text[start - 1] !== '\n') start -= 1;
    const previous = text.slice(start, cursor);
    cursor = start;

    if (previous.trim() === '') continue;
    // Another list item: keep walking, the stem may be above the whole list.
    if (/^\s*(?:[-*+]|\d+\.)\s/u.test(previous)) continue;
    return previous.trimEnd().endsWith(':') ? previous : undefined;
  }

  return undefined;
}

/**
 * Whether `index` falls inside a fenced code block.
 *
 * A fenced block showing captured output is attributed material, exactly like a
 * blockquote. This was found the hard way: `negative-cases/honesty-close-out/README.md`
 * quotes its own observed output, which contains `"matched": "is reference-verified"`, and
 * the rules fired on the evidence *for* the rules. A document that records a violation is
 * not committing one.
 *
 * Fences are counted by **opening/closing pairs of the same marker**, not by raw parity of
 * every backtick line. Naive parity is fragile: a four-backtick fence, or a `~~~` fence,
 * flips the count and would suppress every rule for the rest of the file — turning a
 * formatting choice into a silent hole in the check.
 */
function inFencedBlock(text: string, index: number): boolean {
  const before = text.slice(0, index);
  let open: string | undefined;

  for (const line of before.split('\n')) {
    const fence = /^[ \t]*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence === undefined) continue;

    if (open === undefined) {
      open = fence[0] as string;
      continue;
    }
    // A fence closes only with the same marker character.
    if (fence.startsWith(open)) open = undefined;
  }

  return open !== undefined;
}

/**
 * Whether the passage around `index` denies, prohibits, conditionalizes, or **quotes**
 * the match rather than asserting it.
 *
 * Four sources of scope, in order:
 *
 * 1. fenced code blocks — captured output, never the document's own voice;
 * 2. blockquote attribution — a `>` line is quoted material;
 * 3. the enclosing sentence or paragraph;
 * 4. the colon-terminated stem above, when the match is inside a list it introduces.
 *
 * Rules 1 and 2 are load-bearing here specifically because the negative-case READMEs must
 * quote the violating text they were built around: `consumer-correctness-claim/README.md`
 * shows *"This package is reference-verified and battle-tested."* as the string its patch
 * adds, and `honesty-close-out/README.md` reproduces the observed output of these very
 * rules firing.
 *
 * The cost, stated rather than hidden: a claim could be smuggled into a blockquote or a
 * fenced block. That is accepted, because the alternative — forbidding negative-case
 * documents from quoting their own fixtures and their own captured output — would make the
 * evidence tree unwritable, and because both constructs are by convention attributed text.
 */
export function isNegated(text: string, index: number): boolean {
  if (inFencedBlock(text, index)) return true;
  if (/^\s*>/u.test(lineAt(text, index))) return true;

  const sentence = enclosingSentence(text, index);
  if (NEGATION_CUES.some((cue) => cue.test(sentence))) return true;

  const stem = listStem(text, index);
  return stem !== undefined && NEGATION_CUES.some((cue) => cue.test(stem));
}

/**
 * Real claims. Every rule must fire on its own claim fixture.
 *
 * These are the sentences someone would actually write if they were overclaiming, not
 * strawmen built to match the regex.
 */
export const CLAIMS: Readonly<Record<string, string>> = {
  'rung-2-claim': 'The catalog adapter is reference-verified on rungs 1-2 of the ladder.',
  'rung-3-claim': 'This surface has been externally validated by a downstream consumer.',
  'external-validation-claim': 'The envelope format was validated by an external team in their own repo.',
  'release-claim': 'The adapter is published to npm as @adrkit/catalog-backstage.',
  'release-scheduled': 'The release is scheduled for the next minor.',
  'gate-3-claimed-in-advance': 'With the comparison passing, ADR-0012 gate 3 is closed.',
  'gate-4-claimed': 'ADR-0012 gate 4 is satisfied by the clean-clone and offline evidence.',
  'backstage-system-claim': 'Backstage will ingest every descriptor in the accept corpus.',
  'third-party-validation': 'The corpus gives us third-party validation of the derivation.',
};

/**
 * Real denials — the maximally honest phrasing, which contains the very same terms.
 *
 * **No rule may fire on any of these.** This is the half of the verification that stops
 * the check from punishing careful writing, and it is why every fixture below is a
 * sentence this feature would genuinely want to write.
 */
export const DENIALS: readonly string[] = [
  'This is not reference-verified (rung 2) and not externally validated (rung 3).',
  'The package is never reference-verified by this evidence alone.',
  'Nothing here was validated by an external party, and rung 3 is reported as absent.',
  'The adapter is not published to npm, and no release is scheduled for any version.',
  'ADR-0012 gate 3 is not closed by this feature; the outcome is recorded, not the verdict.',
  'ADR-0012 gate 4 is not satisfied, and is recorded as unmet and not yet testable.',
  'No claim is made that Backstage will ingest anything; the warrant is a predicate return.',
  'This is not third-party validation. Only the corpus data is third-party.',
  'Maintainer reference verification MUST NOT be described as validated by an external team.',
  'It is not yet reference-verified, and it is not yet externally validated.',
];

export interface Violation {
  readonly path: string;
  readonly ruleId: string;
  readonly assertion: HonestyRule['assertion'];
  readonly matched: string;
  readonly why: string;
}

/**
 * Markdown and TypeScript artifacts this feature produced.
 *
 * `docs/adr/**` is out of scope: those records are not this feature's artifacts, and
 * ADR-0014 itself necessarily contains every term above.
 */
export function featureArtifacts(): { readonly path: string; readonly text: string }[] {
  const roots = [
    join(FEATURE, 'evidence'),
    join(FEATURE, 'contracts'),
    join(REPO_ROOT, 'packages', 'adapters', 'catalog-backstage'),
    join(REPO_ROOT, 'packages', 'catalog-envelope'),
  ];

  const collected: { path: string; text: string }[] = [];

  for (const root of roots) {
    for (const entry of readdirSync(root, { recursive: true }).map(String)) {
      if (!entry.endsWith('.md') && !entry.endsWith('.ts')) continue;
      const absolute = join(root, entry);
      if (entry.includes('node_modules')) continue;
      if (!statSync(absolute).isFile()) continue;
      collected.push({
        path: relative(REPO_ROOT, absolute).split(sep).join('/'),
        text: readFileSync(absolute, 'utf8'),
      });
    }
  }

  for (const relativePath of [
    'scripts/check-clause8-gate.ts',
    'scripts/check-clean-clone.ts',
    'scripts/check-no-spike-heuristics.ts',
    'scripts/run-network-denied.ts',
    'scripts/compare-accept-corpus.ts',
    'specs/010-catalog-backstage/evidence/honesty-close-out.md',
    'specs/010-catalog-backstage/evidence/observed-failing-register.md',
  ]) {
    collected.push({
      path: relativePath,
      text: readFileSync(join(REPO_ROOT, relativePath), 'utf8'),
    });
  }

  return collected;
}

/**
 * Every claim, anywhere in `artifacts`, that is **not** negated by its own sentence.
 *
 * Scans all matches rather than the first, because a document that denies a claim in one
 * sentence and makes it in another is exactly the case worth catching, and a
 * first-match-only scan would stop at the denial and report clean.
 */
export function honestyViolations(
  artifacts: readonly { readonly path: string; readonly text: string }[],
): Violation[] {
  const found: Violation[] = [];

  for (const artifact of artifacts) {
    for (const rule of HONESTY_RULES) {
      const global = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace('g', '')}g`);
      for (const match of artifact.text.matchAll(global)) {
        if (match.index === undefined) continue;
        if (isNegated(artifact.text, match.index)) continue;
        found.push({
          path: artifact.path,
          ruleId: rule.id,
          assertion: rule.assertion,
          matched: match[0],
          why: rule.why,
        });
      }
    }
  }

  return found;
}

/** Whether `rule` treats `sentence` as a claim — i.e. it matches and is not negated. */
export function firesOn(rule: HonestyRule, sentence: string): boolean {
  const match = rule.pattern.exec(sentence);
  if (match?.index === undefined) return false;
  return !isNegated(sentence, match.index);
}

// ---------------------------------------------------------------------------
// The rules are verified on both sides BEFORE they are trusted (ADR-0016).
// ---------------------------------------------------------------------------

describe('T100 \u2014 every rule fires on a real claim', () => {
  test('every rule has a claim fixture, so none is untested', () => {
    expect(Object.keys(CLAIMS).sort()).toEqual(HONESTY_RULES.map((rule) => rule.id).sort());
  });

  test.each(HONESTY_RULES.map((rule) => [rule.id, rule] as const))('%s fires', (ruleId, rule) => {
    expect(firesOn(rule, CLAIMS[ruleId] as string)).toBe(true);
  });
});

describe('T100 \u2014 NO rule fires on an honest denial', () => {
  // The half that stops the check punishing the documentation being most careful.
  test.each(DENIALS.map((denial, index) => [index, denial] as const))(
    'denial %i is conformant: %s',
    (_index, denial) => {
      expect(HONESTY_RULES.filter((rule) => firesOn(rule, denial)).map((rule) => rule.id)).toEqual([]);
    },
  );

  test('the denials really do contain the binding vocabulary', () => {
    // Otherwise the tests above would pass by the denials simply not mentioning anything,
    // and the whole point would be lost.
    const all = DENIALS.join(' ');
    expect(all).toContain('reference-verified');
    expect(all).toContain('externally validated');
    expect(all).toContain('third-party');
    expect(all).toContain('gate 3');
    expect(all).toContain('gate 4');
    expect(all).toContain('Backstage');
    expect(all).toContain('npm');
  });

  test('the denials exercise the negation test, and the exceptions are named', () => {
    // Without this the denial fixtures could all pass by simply not matching the
    // patterns, which would leave the negation logic untested rather than proven.
    //
    // The set splits exactly in half, and the split is informative rather than
    // incidental:
    //
    //   (a) **structurally safe** — the negation sits *between* the verb and the term
    //       ("is **not** reference-verified", "is **never** reference-verified", "is
    //       **not yet** reference-verified"), so the assertive construction the rule
    //       looks for is simply absent and no negation test is needed. That the most
    //       natural denial forms land here is evidence the patterns are already
    //       claim-shaped rather than term-shaped.
    //
    //   (b) **negation-dependent** — the pattern does match, and only `isNegated`
    //       rules it out, because the negation is elsewhere in the sentence
    //       ("**Nothing** here was validated by an external party"). These are the
    //       fixtures that actually exercise the sentence-scoped logic.
    //
    // Both halves are asserted by name. A drift in either direction — patterns growing
    // term-shaped, or the negation-dependent set emptying out — changes these lists.
    const matches = (denial: string): boolean => HONESTY_RULES.some((rule) => rule.pattern.test(denial));

    expect(DENIALS.filter((denial) => !matches(denial))).toEqual([
      'This is not reference-verified (rung 2) and not externally validated (rung 3).',
      'The package is never reference-verified by this evidence alone.',
      'ADR-0012 gate 3 is not closed by this feature; the outcome is recorded, not the verdict.',
      'ADR-0012 gate 4 is not satisfied, and is recorded as unmet and not yet testable.',
      'It is not yet reference-verified, and it is not yet externally validated.',
    ]);

    expect(DENIALS.filter(matches)).toEqual([
      'Nothing here was validated by an external party, and rung 3 is reported as absent.',
      'The adapter is not published to npm, and no release is scheduled for any version.',
      'No claim is made that Backstage will ingest anything; the warrant is a predicate return.',
      'This is not third-party validation. Only the corpus data is third-party.',
      'Maintainer reference verification MUST NOT be described as validated by an external team.',
    ]);
  });
});

describe('T100 \u2014 the negation test, checked in isolation', () => {
  test('sentence-level negations are seen, not just adjacent ones', () => {
    // Lookbehind saw only adjacent negations and flagged all three of these, each of
    // which already exists verbatim in this repository.
    for (const sentence of [
      'Nothing here is reference-verified (rung 2) or externally validated (rung 3).',
      'Nothing in this tree is reference-verified (rung 2) or externally validated.',
      'It is not a claim that the descriptor is defective, that Backstage would reject it.',
    ]) {
      expect(HONESTY_RULES.filter((rule) => firesOn(rule, sentence))).toEqual([]);
    }
  });

  test('a claim in a later sentence is NOT excused by a denial in an earlier one', () => {
    // The failure mode a document-wide negation search would have: deny once at the top,
    // claim freely below.
    const text =
      'This is not reference-verified.\nThe adapter is published to npm and is externally validated.';
    const violations = honestyViolations([{ path: 'fixture.md', text }]);
    expect(violations.map((violation) => violation.ruleId).sort()).toEqual([
      'release-claim',
      'rung-3-claim',
    ]);
  });

  test('markdown table cells are their own scope', () => {
    // Status is stated in tables as often as in prose, and a row's negation lives in its
    // own cell. Without the `|` boundary a neighbouring cell's "not" would excuse a claim.
    const row = '| rung 2 | it is reference-verified | no evidence |';
    expect(HONESTY_RULES.filter((rule) => firesOn(rule, row)).map((rule) => rule.id)).toEqual([
      'rung-2-claim',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Only now are the rules applied to the feature's artifacts.
// ---------------------------------------------------------------------------

describe('T100 \u2014 the six assertions, over every artifact this feature produced', () => {
  const artifacts = featureArtifacts();

  test('there are artifacts to check, so a green result is not vacuous', () => {
    expect(artifacts.length).toBeGreaterThan(100);
  });

  test('(i)\u2013(vi): no artifact makes any of the forbidden claims', () => {
    expect(honestyViolations(artifacts)).toEqual([]);
  });

  test('the scan covers both packages, the contracts, and the evidence tree', () => {
    for (const prefix of [
      'packages/adapters/catalog-backstage/',
      'packages/catalog-envelope/',
      'specs/010-catalog-backstage/contracts/',
      'specs/010-catalog-backstage/evidence/',
    ]) {
      expect(artifacts.some((artifact) => artifact.path.startsWith(prefix))).toBe(true);
    }
  });
});

describe('T100 \u2014 the recorded findings, for what a pattern cannot check', () => {
  const closeOut = readFileSync(CLOSE_OUT, 'utf8');
  const flat = closeOut.replaceAll(/\s+/gu, ' ');

  test('(iii) gate 3\u2019s outcome is recorded as OBSERVED, never claimed in advance', () => {
    expect(flat).toContain('recorded as observed, never claimed in advance');
    expect(flat).toMatch(/(?:0|zero) false positives and (?:0|zero) false negatives/iu);
    // The distinction that matters: an outcome is not a verdict.
    expect(flat).toMatch(/gate 3 is ADR-0012['\u2019]s to close/u);
  });

  test('(iv) gate 4 is recorded UNMET and NOT YET TESTABLE', () => {
    expect(flat).toContain('unmet and not yet testable');
    expect(flat).toContain('never as passed, and never as failed');
    expect(flat).toContain('NEEDS CLARIFICATION');
  });

  test('(ii) the close-out states no release is scheduled, implied, or prepared', () => {
    expect(flat).toContain('No release is scheduled, implied, or prepared');
    expect(flat).toContain('clause 9');
  });

  test('(v) every claim is scoped to a predicate return at the pinned commit', () => {
    expect(closeOut).toContain(PINNED_BACKSTAGE_COMMIT);
    expect(flat).toContain('what a pure validator predicate returns');
  });

  test('(vi) only corpus data is third-party, and the close-out says which is which', () => {
    expect(flat).toContain('Only the corpus **data** is third-party');
    expect(flat).toContain('the validation never is');
  });

  test('(i) the close-out denies both rungs in ADR-0014\u2019s own binding vocabulary', () => {
    // The sentence this whole file was designed around. It must be present, and it must
    // survive the rules — which the artifact scan above already proved, since the
    // close-out is one of the artifacts scanned.
    expect(flat).toContain('reference-verified');
    expect(flat).toContain('externally validated');
    expect(flat).toMatch(/\bnot\s+`?reference-verified`?\b/iu);
  });
});

describe('T100 \u2014 the two packages state their own status honestly', () => {
  test('both are version 0.0.0 and absent from the release set', () => {
    for (const relativePath of [
      'packages/adapters/catalog-backstage/package.json',
      'packages/catalog-envelope/package.json',
    ]) {
      const manifest = JSON.parse(readFileSync(join(REPO_ROOT, relativePath), 'utf8')) as {
        version?: string;
      };
      expect(manifest.version).toBe('0.0.0');
    }

    const releasePack = readFileSync(join(REPO_ROOT, 'scripts', 'release-pack.ts'), 'utf8');
    const releaseSet = /RELEASE_PACKAGES[^=]*=\s*\[([\s\S]*?)\]/u.exec(releasePack)?.[1] ?? '';
    expect(releaseSet).not.toContain('catalog-backstage');
    expect(releaseSet).not.toContain('catalog-envelope');
  });
});
