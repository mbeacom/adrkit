/**
 * Guard: nothing this package exports, emits, or documents claims **correctness**
 * (`spec.md` FR-058; SC-012 framing half; T035).
 *
 * ADR-0020 clause 5: a populated, digest-verified envelope proves **integrity,
 * not correctness** — a semantically wrong envelope can carry a perfectly valid
 * self-digest. SC-012 requires that no artifact, report, or document produced
 * under this feature present such an envelope as evidence of semantic
 * correctness.
 *
 * ## Why a vocabulary check and not only a prose statement
 *
 * The framing is easy to write once in a README and then quietly undo in an
 * identifier — a function called `verifyOwnership`, a result field named
 * `correct`, an error string saying "ownership is valid". Each reads naturally
 * and each claims the thing the record forbids. So the exported surface, the
 * error and detail strings the package actually emits, and the package's own
 * documentation are all scanned for the forbidden vocabulary.
 *
 * The list below is deliberately narrow. It targets words that assert semantic
 * rightness about *ownership* or *the catalog*, not the word "valid" as such:
 * "valid JSON", "structurally valid envelope", and "individually valid" are all
 * accurate and are the contract's own vocabulary (`snapshot-envelope.md` §2,
 * §6). A check that banned "valid" outright would be unsatisfiable against the
 * contract it is enforcing.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as consumer from '../src/index.ts';
import {
  DIGEST_GUARANTEE_SCOPE,
  admitEnvelope,
  checkEnvelopeDigest,
  validateEnvelope,
} from '../src/index.ts';
import { ADMIT_OPTIONS_A, VALIDATE_OPTIONS, fixtureText } from './helpers.ts';

const PACKAGE_ROOT = join(import.meta.dir, '..');

/**
 * Phrases that assert semantic rightness. Each is a claim this package cannot
 * support, whether it appears in an identifier, an emitted string, or prose.
 */
const FORBIDDEN_CLAIMS = [
  'semantically correct',
  'ownership is correct',
  'correct ownership',
  'verified correct',
  'proves correctness',
  'guarantees correctness',
  'tamper-proof',
  'tamper-resistant',
  'tamper resistant',
  'cryptographically secure',
  'authoritative ownership',
] as const;

/**
 * Contexts in which the word "correctness" is legitimate — every one of them is
 * a *denial* of a correctness claim rather than an assertion of one.
 */
function stripLegitimateCorrectnessMentions(text: string): string {
  return text
    .replaceAll(/integrity,? not correctness/gi, '')
    .replaceAll(/not correctness/gi, '')
    .replaceAll(/never correctness/gi, '')
    .replaceAll(/correctness is (?:claimed|established) only/gi, '')
    .replaceAll(/correctness oracle/gi, '')
    .replaceAll(/a statement about .{0,40}correctness/gi, '');
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

describe('the exported surface makes no correctness claim', () => {
  test('no exported name asserts correctness', () => {
    const names = Object.keys(consumer).sort();

    // Report what was examined. An empty export list would otherwise satisfy
    // every assertion below while proving nothing (ADR-0016 clause 3).
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(names).toContain('admitEnvelope');
    expect(names).toContain('deriveCatalogSnapshot');
    expect(names).toContain('DIGEST_GUARANTEE_SCOPE');

    const offending = names.filter((name) =>
      // `proven` is bounded so that `isRecognizedProvenance` — which is the
      // contract's own vocabulary (`snapshot-envelope.md` §2) and asserts
      // nothing about rightness — is not caught by it.
      /correct|\bproven\b|proves|guarantee[ds]|authoritative|trustworthy/i.test(name),
    );
    expect(offending).toEqual([]);
  });

  test('the exported vocabulary is about admission and checking, not judgement', () => {
    // A specific observed list rather than an absence: if the surface is ever
    // reshaped, this says so out loud instead of silently continuing to pass.
    const verbs = Object.keys(consumer)
      .filter((name) => /^(admit|check|validate|derive|recompute|query|is)/.test(name))
      .sort();

    expect(verbs).toEqual([
      'admitEnvelope',
      'admittedEnvelopeOf',
      'checkEnvelopeDigest',
      'checkRepositoryIdentity',
      'checkStaleness',
      'deriveCatalogSnapshot',
      'isAdmittedEnvelope',
      'isRecognizedProvenance',
      'isStructurallyValidEnvelope',
      'queryEntitiesForRepository',
      'recomputeEnvelopeDigest',
      'validateEnvelope',
      'validateParsedEnvelope',
    ]);
  });
});

describe('the strings this package emits make no correctness claim', () => {
  /** Every detail/reason string reachable across the whole fixture corpus. */
  function emittedStrings(): string[] {
    const strings: string[] = [DIGEST_GUARANTEE_SCOPE];
    const fixtures = readdirSync(join(PACKAGE_ROOT, 'test', 'fixtures')).filter((name) =>
      name.endsWith('.json'),
    );
    expect(fixtures.length).toBe(10);

    for (const fixture of fixtures) {
      const text = fixtureText(fixture);
      const validation = validateEnvelope(text, VALIDATE_OPTIONS);
      if (validation.outcome === 'rejected') strings.push(validation.reason, validation.detail);
      else strings.push(JSON.stringify(checkEnvelopeDigest(validation.validated)));

      const admission = admitEnvelope(text, ADMIT_OPTIONS_A);
      if (admission.outcome === 'refused') strings.push(admission.reason, admission.detail);
      else strings.push(JSON.stringify(admission.admitted.stalenessCheck), JSON.stringify(admission.admitted.identityCheck));
    }
    return strings;
  }

  test('no emitted string carries a forbidden claim', () => {
    const strings = emittedStrings();
    expect(strings.length).toBeGreaterThan(20);

    for (const emitted of strings) {
      const haystack = stripLegitimateCorrectnessMentions(emitted).toLowerCase();
      for (const claim of FORBIDDEN_CLAIMS) {
        expect(haystack).not.toContain(claim);
      }
    }
  });

  test('the one string that mentions correctness denies it', () => {
    expect(DIGEST_GUARANTEE_SCOPE).toContain('integrity, not correctness');
    expect(stripLegitimateCorrectnessMentions(DIGEST_GUARANTEE_SCOPE).toLowerCase()).not.toContain(
      'correctness',
    );
  });
});

describe('the documentation makes no correctness claim', () => {
  function documents(): { readonly name: string; readonly text: string }[] {
    const docs = [
      { name: 'README.md', text: readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf8') },
      {
        name: 'test/fixtures/README.md',
        text: readFileSync(join(PACKAGE_ROOT, 'test', 'fixtures', 'README.md'), 'utf8'),
      },
    ];
    for (const file of sourceFiles(join(PACKAGE_ROOT, 'src'))) {
      docs.push({ name: file.slice(PACKAGE_ROOT.length + 1), text: readFileSync(file, 'utf8') });
    }
    return docs;
  }

  test('no document carries a forbidden claim', () => {
    const docs = documents();
    expect(docs.length).toBeGreaterThanOrEqual(8);

    const offending: string[] = [];
    for (const doc of docs) {
      const haystack = stripLegitimateCorrectnessMentions(doc.text).toLowerCase();
      for (const claim of FORBIDDEN_CLAIMS) {
        if (haystack.includes(claim)) offending.push(`${doc.name}: ${claim}`);
      }
    }
    expect(offending).toEqual([]);
  });

  test('the README states the distinction before it states anything else', () => {
    const readme = readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf8');
    const headings = readme.split('\n').filter((line) => line.startsWith('## '));
    // Collapsed so the assertions are about the prose, not about where the
    // hard wrap happens to fall.
    const flowed = readme.replaceAll(/\s+/g, ' ');

    expect(headings[0]).toBe('## An integrity validator, not a correctness oracle');
    expect(flowed).toContain('proves integrity, not correctness');
    expect(flowed).toContain('a semantically wrong envelope can carry a perfectly valid self-digest');
  });

  test('no document claims rung 2 or rung 3 standing', () => {
    // ADR-0014 rung 1 only, per ADR-0020's closing paragraph and `spec.md`
    // FR-062. The forbidden synonyms are the ones that would let the claim in
    // through the side door.
    const forbidden = [
      'reference-verified',
      'externally validated',
      'community-validated',
      'community validated',
      'third-party validated',
      'battle-tested',
      'production-proven',
      'production proven',
    ];

    const offending: string[] = [];
    for (const doc of documents()) {
      const haystack = doc.text.toLowerCase();
      for (const term of forbidden) {
        // A denial ("is **not** reference-verified") is the required framing, so
        // only an unqualified assertion counts. Every occurrence in this package
        // is preceded by "not " or "neither ".
        for (const match of haystack.matchAll(new RegExp(term, 'g'))) {
          const before = haystack.slice(Math.max(0, match.index - 40), match.index);
          if (!/\bnot\b|\bneither\b|\bnever\b|\bwithout\b/.test(before)) {
            offending.push(`${doc.name}: ${term}`);
          }
        }
      }
    }
    expect(offending).toEqual([]);
  });
});
