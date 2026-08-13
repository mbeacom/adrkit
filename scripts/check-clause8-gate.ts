/**
 * T098 / FR-060 — the ADR-0020 **clause-8 executable CI gate**, tied to clause 5.
 *
 * # The gate is this file, and it is NOT ADR-0020's frontmatter assertion
 *
 * ADR-0020 carries an assertion, `catalog-adapter-accept-path-needs-annotated-real-corpus`,
 * which states clause 5 in full. It is declared `engine: custom`, that engine resolves
 * through an optional registry port, **no port is registered**, and the evaluator
 * therefore returns `status: 'inert'` with `reason: 'assertions-compile.engine-absent'`.
 * It never fails, and it never can.
 *
 * Clause 8 says so itself: *"The frontmatter assertion on this record is **currently
 * inert** and must not be mistaken for enforcement … It records the rule; it does not
 * enforce it. Enforcement is a CI check tied to release, and like every other gate here
 * it counts as coverage only once it has been watched failing."*
 *
 * So this gate cites the assertion as the **rule it compiles from**, never as the thing
 * doing the enforcing. It reads the evidence tree directly.
 *
 * # What "tied to release" means here, given clause 9 defers release
 *
 * Clause 9 defers both the release vehicle and the decision to release at all. A gate
 * that concluded "clause 5 is met, therefore release" would be preparing a release this
 * repository is not authorized to prepare.
 *
 * The assertion's own form avoids that. It is a **prohibition**: the adapter *may not be
 * released, and may not claim ADR-0014 rung 2, until* clause 5's evidence exists. A
 * prohibition is violated in exactly two ways, and the gate checks both:
 *
 * - **A.** Clause 5's evidence is incomplete, absent, or FAILing; or
 * - **B.** Something claims release or rung 2.
 *
 * Neither is true today: the evidence is complete and PASSing, and nothing claims either.
 * The gate passes for that reason — not because it has authorized anything. Should the
 * evidence rot **or** should a release/rung-2 claim appear, it fails.
 *
 * # Requirement-by-requirement, against the assertion's own text
 *
 * Every check below names the clause-5 sentence it enforces. A gate whose checks cannot
 * be traced back to the rule is a gate nobody can audit for completeness.
 *
 * Run: `bun run check:clause8`
 *
 * @see `docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md` clauses 5, 8, 9
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dir, '..');
const EVIDENCE = 'specs/010-catalog-backstage/evidence';
const CORPUS = 'specs/010-catalog-backstage/corpus';

export const ADR_0020 =
  'docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md';

/** The assertion id clause 8 designates as the rule this gate compiles from. */
export const ASSERTION_ID = 'catalog-adapter-accept-path-needs-annotated-real-corpus';

export interface Finding {
  /** Which clause-5 requirement, in the assertion's own words. */
  readonly requirement: string;
  readonly reason: string;
}

/**
 * Read a JSON evidence artifact, treating an unparseable one as absent-with-a-reason.
 *
 * `JSON.parse` was called bare here, so a truncated or hand-edited evidence file threw a
 * `SyntaxError` out of `main()` — carrying no filename, from inside a network-denied
 * wrapper, which reads to an operator like a sandbox or toolchain failure rather than the
 * evidence problem it is. The parse failure is recorded and surfaces as a finding naming
 * the file, on the same principle as everything else here: the message must point at the
 * thing that is actually wrong.
 */
const unparseable: string[] = [];

function readJson(repoRoot: string, relative: string): unknown {
  const path = join(repoRoot, relative);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    unparseable.push(`${relative}: ${(error as Error).message}`);
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Limb A — clause 5's evidence is complete and PASSing.
 *
 * Each check quotes the requirement it enforces so the mapping is auditable.
 */
function checkClause5Evidence(repoRoot: string): Finding[] {
  const findings: Finding[] = [];

  const stepA = record(readJson(repoRoot, `${EVIDENCE}/frozen-expectations/audit-record.json`));
  const adequacy = record(readJson(repoRoot, `${EVIDENCE}/accept-corpus-freeze/adequacy-audit.json`));
  const freeze = record(readJson(repoRoot, `${EVIDENCE}/accept-corpus-freeze/accept-corpus-freeze.json`));
  const stepB = record(readJson(repoRoot, `${EVIDENCE}/comparison/step-b-record.json`));
  const unchanged = record(readJson(repoRoot, `${EVIDENCE}/comparison/expectations-unchanged.json`));
  const vendor = record(readJson(repoRoot, `${CORPUS}/VENDOR-MANIFEST.json`));

  // "Two distinct steps are required, each recording its own hashes and its own PASS/FAIL."
  const R_TWO_STEPS = 'two distinct steps, each recording its own hashes and its own PASS/FAIL';

  if (stepA === undefined) {
    findings.push({ requirement: R_TWO_STEPS, reason: 'step (a): the pre-output audit record is absent' });
  } else if (stepA['overallVerdictThisRecord'] !== 'PASS') {
    findings.push({
      requirement: R_TWO_STEPS,
      reason: `step (a): audit verdict is ${JSON.stringify(stepA['overallVerdictThisRecord'])}, not "PASS"`,
    });
  }

  if (stepB === undefined) {
    findings.push({ requirement: R_TWO_STEPS, reason: 'step (b): the post-output comparison record is absent' });
  } else {
    if (stepB['verdict'] !== 'PASS') {
      findings.push({
        requirement: R_TWO_STEPS,
        reason: `step (b): comparison verdict is ${JSON.stringify(stepB['verdict'])}, not "PASS"`,
      });
    }
    // "Neither may inherit the other's verdict." (FR-057, restating clause 5.)
    if (stepB['inheritsFromStepA'] !== false) {
      findings.push({
        requirement: R_TWO_STEPS,
        reason: 'step (b) does not record `inheritsFromStepA: false`, so the two steps are not distinct',
      });
    }
    const ownHashes = record(stepB['ownHashes']);
    if (ownHashes === undefined) {
      findings.push({ requirement: R_TWO_STEPS, reason: 'step (b) records no hashes of its own' });
    }

    // "the corpus, its overlay, its expected path matches … are frozen … before any
    // generator output is produced" — step (b) recomputes them rather than trusting them.
    //
    // An absent, empty, or non-object `recomputedFrozenHashes` must be a finding, not a
    // silent pass. `Object.entries(undefined ?? {})` iterates zero times, so a record that
    // never recomputed anything would otherwise satisfy this requirement identically to
    // one that recomputed and matched — exactly the silent-absence class this gate exists
    // to close.
    const R_HASHES = 'the frozen artifacts still hash to what was frozen';
    const REQUIRED_FROZEN = [
      'frozen-expectations/frozen-expectation-set.json',
      'accept-corpus-freeze/accept-corpus-freeze.json',
    ];
    const recomputed = record(stepB['recomputedFrozenHashes']);

    if (recomputed === undefined || Object.keys(recomputed).length === 0) {
      findings.push({
        requirement: R_HASHES,
        reason: 'step (b) records no recomputed frozen hashes, so it never checked the freeze',
      });
    } else {
      for (const artifact of REQUIRED_FROZEN) {
        if (!Object.hasOwn(recomputed, artifact)) {
          findings.push({ requirement: R_HASHES, reason: `step (b) did not recompute ${artifact}` });
        }
      }
      for (const [artifact, value] of Object.entries(recomputed)) {
        const entry = record(value);
        if (entry?.['match'] !== true) {
          findings.push({
            requirement: R_HASHES,
            reason: `step (b) recomputed ${artifact} and it did not match`,
          });
        }
      }
    }
  }

  // "A populated envelope alone does not satisfy this, because a digest proves integrity
  // and not correctness." — so BOTH are required: populated, and diffed to zero/zero.
  const counts = record(stepB?.['counts']);
  const envelopeEntities = counts?.['envelopeEntities'];
  if (typeof envelopeEntities !== 'number' || envelopeEntities <= 0) {
    findings.push({
      requirement: 'a populated, digest-verified SnapshotEnvelope',
      reason: `step (b) records ${JSON.stringify(envelopeEntities)} envelope entities; a populated envelope has at least one`,
    });
  }
  const digest = record(stepB?.['ownHashes'])?.['envelopeDigest'];
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
    findings.push({
      requirement: 'a populated, digest-verified SnapshotEnvelope',
      reason: 'step (b) records no sha256 envelope digest',
    });
  }

  // "must match with zero false positives and zero false negatives; any mismatch fails
  // this assertion"
  const R_ZERO = 'zero false positives and zero false negatives';
  for (const key of ['falsePositives', 'falseNegatives'] as const) {
    const value = counts?.[key];
    if (value !== 0) {
      findings.push({ requirement: R_ZERO, reason: `step (b) records ${key} = ${JSON.stringify(value)}` });
    }
  }

  // "the expectations are never amended to fit the output"
  if (unchanged === undefined) {
    findings.push({
      requirement: 'the expectations are never amended to fit the output',
      reason: 'no expectations-unchanged record exists',
    });
  } else if (unchanged['allUnchanged'] !== true) {
    findings.push({
      requirement: 'the expectations are never amended to fit the output',
      reason: 'expectations-unchanged records at least one changed artifact',
    });
  }

  // "descriptors are real and third-party-sourced — authored upstream and otherwise
  // unmodified"
  const R_UPSTREAM = 'descriptors real and third-party-sourced, authored upstream and otherwise unmodified';
  const freezeRef = record(freeze?.['corpusRef']);
  const vendorRef = record(vendor?.['corpusRef']);
  if (vendor === undefined) {
    findings.push({ requirement: R_UPSTREAM, reason: 'the vendored corpus manifest is absent' });
  } else if (
    typeof freezeRef?.['repository'] !== 'string' ||
    typeof freezeRef['commit'] !== 'string' ||
    freezeRef['repository'] === '' ||
    freezeRef['commit'] === ''
  ) {
    // Both sides missing a `corpusRef` compares `undefined !== undefined`, which is
    // false — so the gate would conclude the two agree on an upstream ref that neither
    // records. The ref has to exist before agreeing about it means anything.
    findings.push({
      requirement: R_UPSTREAM,
      reason: 'the freeze records no upstream repository and commit for the corpus',
    });
  } else if (
    freezeRef['repository'] !== vendorRef?.['repository'] ||
    freezeRef['commit'] !== vendorRef['commit']
  ) {
    findings.push({
      requirement: R_UPSTREAM,
      reason: 'the vendored corpus and the freeze name different upstream refs',
    });
  }
  if (typeof vendor?.['fileCount'] === 'number' && vendor['fileCount'] !== freeze?.['size']) {
    findings.push({
      requirement: R_UPSTREAM,
      reason: `the vendored corpus holds ${String(vendor['fileCount'])} files but the freeze records size ${String(freeze?.['size'])}`,
    });
  }

  // "That corpus must carry at least one non-empty adrkit.io/owned-paths annotation."
  // "A corpus in which every entity is annotation-absent does not satisfy it either."
  const overlay = freeze?.['overlay'];
  const overlayEntries = Array.isArray(overlay) ? overlay : [];
  const nonEmpty = overlayEntries.filter((entry) => {
    const value = record(entry)?.['annotationValue'];
    return typeof value === 'string' && value.trim() !== '' && value.trim() !== '[]';
  });
  if (nonEmpty.length === 0) {
    findings.push({
      requirement: 'at least one non-empty adrkit.io/owned-paths annotation',
      reason: 'the freeze carries no overlay entry with a non-empty annotation value',
    });
  }

  // "that audit must record an explicit finding that the corpus is adequate for the claim
  // being made; an audit that passes on integrity without reaching adequacy does not
  // satisfy this clause."
  const R_ADEQUACY = 'an explicit auditor finding that the corpus is adequate';
  if (adequacy === undefined) {
    findings.push({ requirement: R_ADEQUACY, reason: 'no adequacy-audit record exists' });
  } else {
    const finding = record(adequacy['requirement3_adequacyFinding']);
    const verdict = finding?.['finding'];

    if (finding === undefined) {
      findings.push({
        requirement: R_ADEQUACY,
        reason: 'the audit records integrity only; it never reaches an adequacy finding',
      });
    } else if (typeof verdict !== 'string' || verdict.trim() === '') {
      // An empty finding object is not an explicit finding. Treating "not literally FAIL"
      // as adequate would let `{}` satisfy the clause the code quotes above, which
      // requires a finding *that the corpus is adequate* — an affirmative statement.
      findings.push({
        requirement: R_ADEQUACY,
        reason: 'the adequacy finding carries no verdict, so no adequacy judgement was recorded',
      });
    } else if (!/\bADEQUATE\b/u.test(verdict) || /\b(?:NOT|IN)ADEQUATE\b/iu.test(verdict)) {
      findings.push({
        requirement: R_ADEQUACY,
        reason: `the adequacy finding does not affirm adequacy: ${JSON.stringify(verdict).slice(0, 120)}`,
      });
    }
  }

  return findings;
}

/**
 * Words that make a claim of release or of rung 2, as opposed to denying or forbidding
 * one.
 *
 * The negations must be treated as conformant — "**not** released", "may not claim rung
 * 2" — because the most honest possible phrasing of this feature's status contains those
 * exact terms. Matching bare occurrence would fail the documentation being most careful
 * and reward saying nothing. Same rule as T100's honesty close-out.
 */
export const RELEASE_CLAIM_PATTERNS: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  {
    id: 'claims-released',
    pattern:
      /\b(?:is|was|has\s+been|will\s+be)\s+(?:now\s+)?(?:published|released)\s+(?:to|on)\s+npm\b/giu,
  },
  {
    id: 'claims-rung-2',
    pattern: /\bthis\s+(?:package|adapter|feature)\s+is\s+reference-verified\b/giu,
  },
  {
    id: 'schedules-a-release',
    pattern: /\brelease\s+(?:is\s+)?scheduled\s+for\b/giu,
  },
];

/**
 * Cues that make the sentence containing a match a **denial** rather than a claim.
 *
 * A two-token lookbehind was here first — `(?<!not\s)(?<!never\s)` — on only one of the
 * three patterns. It fails for the same reason T100's own file records
 * (`check-honesty-close-out.test.ts`): a lookbehind sees a few characters, and the honest
 * sentences this repository actually writes put the negation further away —
 * *"**Neither** package is published to npm"*, *"**No** release is scheduled for any
 * version"*. Both are verbatim shapes from T100's denial fixtures, and both would have
 * turned the build red.
 *
 * That direction of failure is the dangerous one: the cheapest way to get green would be
 * to delete the denial, so the check would reward saying nothing — the outcome ADR-0016
 * and T100 exist to prevent. Scoped to the sentence, as T100 does.
 */
const NEGATION_CUES =
  /\b(?:not|never|neither|nor|no|cannot|without|refus\w*|forbid\w*|prohibit\w*|must\s+not|may\s+not|is\s+not|are\s+not)\b/iu;

/** Is the match inside a sentence that denies rather than asserts? */
export function isNegated(text: string, index: number): boolean {
  const start = Math.max(0, text.lastIndexOf('.', index - 1) + 1);
  const newline = text.lastIndexOf('\n', index - 1) + 1;
  const sentence = text.slice(Math.max(start, newline), index);
  return NEGATION_CUES.test(sentence);
}

/** Strip `//` line comments, so a name discussed in a comment is not read as a release entry. */
function stripLineComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

/**
 * The prose {@link RELEASE_CLAIM_PATTERNS} is applied to.
 *
 * Deliberately the artifacts a consumer would read to decide whether this thing is
 * shippable — the two package READMEs and the feature's own close-out. Scanning the whole
 * tree would drag in this file, its tests, and the negative cases, all of which quote the
 * claim in order to forbid it.
 */
export const RELEASE_CLAIM_SCAN_TARGETS: readonly string[] = [
  'packages/adapters/catalog-backstage/README.md',
  'packages/catalog-envelope/README.md',
  'specs/010-catalog-backstage/evidence/honesty-close-out.md',
];

/**
 * The scan targets actually read on the last run, for the success line.
 *
 * Printing `RELEASE_CLAIM_SCAN_TARGETS.length` was the same defect the prose scan was
 * added to fix, one level down: a hard-coded 3 that could not move, so a moved or renamed
 * artifact reported "3 scanned" having scanned two. The number now comes from the files.
 */
const scanned: string[] = [];

/** Limb B — nothing claims release or ADR-0014 rung 2. */
function checkNoReleaseClaim(repoRoot: string): Finding[] {
  const findings: Finding[] = [];
  const targets = [
    'packages/adapters/catalog-backstage/package.json',
    'packages/catalog-envelope/package.json',
  ];
  for (const relative of targets) {
    const path = join(repoRoot, relative);
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      version?: string;
      private?: boolean;
    };
    // Version 0.0.0 is how both packages state "not released" structurally rather than
    // in prose. A real version here would be a release having been prepared.
    if (manifest.version !== '0.0.0') {
      findings.push({
        requirement: 'the adapter may not be released until clause 5 is met (clause 9 defers it regardless)',
        reason: `${relative} declares version ${String(manifest.version)}; clause 9 defers release, so 0.0.0 is the only honest value`,
      });
    }
  }

  // Neither package may be in the release set.
  //
  // Scanned by name across the whole file rather than by capturing the array. The obvious
  // `/RELEASE_PACKAGES[^=]*=\s*\[([\s\S]*?)\]/` is lazy, so it stopped at the first `]` in
  // the file — which is the one closing the *first* entry's `expectedFiles`. Four of the
  // five real entries were already outside the window, and a catalog package appended in
  // the ordinary place would have been invisible while the gate printed that both packages
  // were absent from `RELEASE_PACKAGES`. The unit test did not catch it because it inserted
  // its mutation at the head of the array, the one position the window covered.
  const releasePack = join(repoRoot, 'scripts', 'release-pack.ts');
  if (!existsSync(releasePack)) {
    findings.push({
      requirement: 'no release is scheduled, implied, or prepared (clause 9)',
      reason: 'scripts/release-pack.ts is absent, so the release set cannot be inspected',
    });
  } else {
    const source = stripLineComments(readFileSync(releasePack, 'utf8'));
    for (const name of ['@adrkit/catalog-backstage', '@adrkit/catalog-envelope']) {
      // Substring, not a regex: the name contains `/`, and escaping it for a `u`-flagged
      // pattern is an easy way to produce an invalid one. Comment-stripped so a name
      // merely discussed in a comment is not read as a release-set entry.
      if (source.includes(name)) {
        findings.push({
          requirement: 'no release is scheduled, implied, or prepared (clause 9)',
          reason: `${name} appears in scripts/release-pack.ts as a release-set entry`,
        });
      }
    }
  }

  // And nothing may *say* it either. The two structural checks above cover a release
  // having been prepared; they say nothing about prose, so `RELEASE_CLAIM_PATTERNS` was
  // defined with careful negation handling and then applied to nothing at all. The gate
  // still printed "no release claimed, scheduled, or prepared" — a broader claim than it
  // checked, which is the exact shape of defect clause 8 exists to prevent. A sentence in
  // either README asserting npm publication left this green.
  //
  // A missing target is a finding, not a skip. Skipping made the scan fail *open*: moving
  // or renaming a scanned artifact deleted that coverage silently while the summary line
  // kept claiming it, which is the same defect one level down.
  for (const relative of RELEASE_CLAIM_SCAN_TARGETS) {
    const path = join(repoRoot, relative);
    if (!existsSync(path)) {
      findings.push({
        requirement: 'no release or rung-2 status is claimed in prose (clause 9, ADR-0014)',
        reason: `${relative} is absent, so it cannot be scanned for a release claim`,
      });
      continue;
    }
    scanned.push(relative);
    const prose = readFileSync(path, 'utf8');
    for (const { id, pattern } of RELEASE_CLAIM_PATTERNS) {
      for (const match of prose.matchAll(pattern)) {
        if (isNegated(prose, match.index)) continue;
        findings.push({
          requirement: 'no release or rung-2 status is claimed in prose (clause 9, ADR-0014)',
          reason: `${relative} [${id}]: ${JSON.stringify(match[0])}`,
        });
      }
    }
  }

  return findings;
}

/**
 * The gate must not cite the inert assertion as enforcement.
 *
 * Checked rather than merely intended: if a future edit registered an engine and made the
 * assertion live, the *description* here would go stale, and clause 8's whole point is
 * that the distinction between recording a rule and enforcing it stays legible.
 */
function checkAssertionStillInert(repoRoot: string): Finding[] {
  const findings: Finding[] = [];
  const path = join(repoRoot, ADR_0020);
  if (!existsSync(path)) {
    return [{ requirement: 'clause 8 compiles from ADR-0020', reason: `${ADR_0020} is absent` }];
  }

  const text = readFileSync(path, 'utf8');
  if (!text.includes(ASSERTION_ID)) {
    findings.push({
      requirement: 'clause 8 compiles from ADR-0020',
      reason: `ADR-0020 no longer carries the assertion ${ASSERTION_ID}`,
    });
  }
  if (!/^\s*engine:\s*custom\s*$/mu.test(text)) {
    findings.push({
      requirement: "clause 8's assertion is inert and this gate is the enforcement",
      reason:
        "ADR-0020's assertion no longer declares `engine: custom`. If an engine is now registered, " +
        'the assertion may be live — revisit clause 8 rather than leaving this gate describing it as inert.',
    });
  }

  // `engine: custom` on the ADR side is only half of "inert". It says which port the
  // assertion *would* use; it says nothing about whether that port exists. Composition
  // code could register a custom engine tomorrow and the frontmatter would not move, so
  // this gate would keep reporting an assertion as inert while it was live — a gate
  // asserting the very thing it had stopped being able to see.
  //
  // The absent port is the condition, so the condition is what is checked.
  findings.push(...checkNoCustomEnginePortRegistered(repoRoot));

  return findings;
}

/** Where the CLI composes the engine registry actually used in production. */
const ENGINE_COMPOSITION = 'packages/cli/src/evaluate.ts';

/**
 * No `custom` assertion-engine port is registered anywhere the CLI composes its registry.
 *
 * Read from the composition source rather than from a type: the registry is a module-level
 * const and is not exported, so there is nothing to import. Parsing the one call that
 * builds it is the closest available check to evaluating it, and it fails closed — if the
 * call cannot be found at all, that is reported rather than passed over, because a
 * composition this gate can no longer locate is one it can no longer vouch for.
 */
function checkNoCustomEnginePortRegistered(repoRoot: string): Finding[] {
  const requirement = "clause 8's assertion is inert because no custom engine port is registered";
  const path = join(repoRoot, ENGINE_COMPOSITION);
  if (!existsSync(path)) {
    return [{ requirement, reason: `${ENGINE_COMPOSITION} is absent, so the registry cannot be inspected` }];
  }

  const source = readFileSync(path, 'utf8');
  const call = /createAssertionEngineRegistry\(\s*\{([\s\S]*?)\}\s*\)/u.exec(source);
  if (call === null) {
    return [
      {
        requirement,
        reason: `${ENGINE_COMPOSITION} no longer contains a createAssertionEngineRegistry({…}) call this gate can read`,
      },
    ];
  }

  if (/(^|[{,\s])custom\s*:/u.test(call[1] ?? '')) {
    return [
      {
        requirement,
        reason:
          `${ENGINE_COMPOSITION} registers a \`custom\` engine port, so ${ASSERTION_ID} may now be live. ` +
          'Clause 8 describes it as inert and names this gate as the enforcement; revisit both.',
      },
    ];
  }

  return [];
}

export function checkClause8Gate(repoRoot: string = REPO_ROOT): Finding[] {
  scanned.length = 0;
  unparseable.length = 0;
  const findings = [
    ...checkClause5Evidence(repoRoot),
    ...checkNoReleaseClaim(repoRoot),
    ...checkAssertionStillInert(repoRoot),
  ];
  // Appended last so a parse failure is reported alongside whatever the missing data made
  // the other limbs conclude, rather than replacing it.
  for (const detail of unparseable) {
    findings.push({
      requirement: 'every clause-5 evidence artifact is readable',
      reason: `unparseable JSON — ${detail}`,
    });
  }
  return findings;
}

function main(): number {
  const findings = checkClause8Gate();

  if (findings.length > 0) {
    console.error('check-clause8-gate: FAIL — ADR-0020 clause 5 is not satisfied by the recorded evidence.');
    for (const finding of findings) {
      console.error(`  [${finding.requirement}]`);
      console.error(`    ${finding.reason}`);
    }
    console.error(
      '\n  This gate is the enforcement clause 8 requires. ADR-0020\u2019s own frontmatter assertion is ' +
        "inert (engine: custom, no port registered \u2192 status 'inert', reason " +
        "'assertions-compile.engine-absent') and records the rule without enforcing it.",
    );
    return 1;
  }

  console.log('check-clause8-gate: ok');
  console.log('  clause 5: two distinct steps, both PASS, step (b) inheriting nothing from step (a)');
  console.log('  clause 5: populated digest-verified envelope, 0 false positives / 0 false negatives');
  console.log('  clause 5: expectations unchanged; corpus upstream-authored at the pinned commit');
  console.log('  clause 5: at least one non-empty owned-paths annotation; adequacy finding recorded');
  console.log(
    '  clause 9: no release claimed, scheduled, or prepared; both packages at 0.0.0, absent from ' +
      `RELEASE_PACKAGES, and no release/rung-2 prose claim in ${scanned.length} scanned artifacts (${scanned.join(', ')})`,
  );
  console.log(
    `  clause 8: enforcement is THIS check. ADR-0020\u2019s assertion ${ASSERTION_ID} is inert — it declares ` +
      `\`engine: custom\` and ${ENGINE_COMPOSITION} registers no custom port — and is not cited as enforcement.`,
  );
  return 0;
}

if (import.meta.main) process.exit(main());
