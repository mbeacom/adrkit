/**
 * Staleness as **exact revision inequality** and repository identity as two
 * outcomes that must not be conflated (`snapshot-envelope.md` §4, §5, §6;
 * `data-model.md` §13, §14; `spec.md` FR-047, FR-048; T032, T033).
 *
 * The single most important thing asserted here is the **isolation** of these
 * rejections from the digest check. `stale.json` and `wrong-repository.json`
 * both carry digests recomputed over their own mutated content, so both pass
 * §3 cleanly. If either were rejected on a digest mismatch instead, the test
 * would still be green on "rejected" while proving nothing about staleness or
 * identity at all.
 */

import { describe, expect, test } from 'bun:test';
import {
  STALENESS_COMPARISON,
  admitEnvelope,
  checkEnvelopeDigest,
  checkRepositoryIdentity,
  checkStaleness,
  queryEntitiesForRepository,
  validateEnvelope,
} from '../src/index.ts';
import {
  ADMIT_OPTIONS_A,
  REPOSITORY_A,
  REPOSITORY_B,
  REVISION_A,
  REVISION_A_STALE,
  REVISION_B,
  SOURCE_BASE_DIR,
  VALIDATE_OPTIONS,
  fixtureText,
} from './helpers.ts';

function validated(name: string) {
  const result = validateEnvelope(fixtureText(name), VALIDATE_OPTIONS);
  if (result.outcome !== 'valid') {
    throw new Error(`${name} did not pass the five steps: ${result.reason} — ${result.detail}`);
  }
  return result.validated;
}

describe('staleness is exact inequality', () => {
  test('the stale fixture passes the digest check cleanly first', () => {
    // Without this, the staleness assertion below would be unfalsifiable: a
    // digest failure would produce a rejection that looks the same from outside.
    expect(checkEnvelopeDigest(validated('stale.json')).outcome).toBe('match');
  });

  test('a different revision for the same repository is stale', () => {
    const result = checkStaleness(validated('stale.json'), REVISION_A);

    expect(result.outcome).toBe('stale-revision');
    expect(result.declaredRevision).toBe(REVISION_A_STALE);
    expect(result.expectedRevision).toBe(REVISION_A);
    expect(result.detail).toContain('not exactly equal to the configured expected-current revision');
  });

  test('an exactly equal revision is ok', () => {
    const result = checkStaleness(validated('valid.json'), REVISION_A);
    expect(result.outcome).toBe('ok');
    expect(result.declaredRevision).toBe(REVISION_A);
  });

  test('inequality is symmetric — direction is never inferred', () => {
    // The point of "exact inequality, not ordering": swapping which SHA is
    // expected and which is declared produces the same verdict. A chronological
    // implementation would call one of these two directions acceptable.
    const forwards = checkStaleness(validated('stale.json'), REVISION_A);
    const backwards = checkStaleness(validated('valid.json'), REVISION_A_STALE);

    expect(forwards.outcome).toBe('stale-revision');
    expect(backwards.outcome).toBe('stale-revision');
  });

  test('a lexicographically smaller revision is just as stale as a larger one', () => {
    for (const expected of ['0'.repeat(40), 'f'.repeat(40)]) {
      expect(checkStaleness(validated('valid.json'), expected).outcome).toBe('stale-revision');
    }
  });

  test('with no expectation configured, the outcome is not-configured rather than ok', () => {
    // ADR-0016's central failure shape: an unchecked envelope must not render
    // identically to a checked one.
    const result = checkStaleness(validated('stale.json'));
    expect(result.outcome).toBe('not-configured');
    expect(result.outcome).not.toBe('ok');
    expect(result.detail).toContain('was not compared against anything');
  });

  test('the comparison is declared on the result and names no ordering', () => {
    const result = checkStaleness(validated('valid.json'), REVISION_A);
    expect(result.comparison).toBe(STALENESS_COMPARISON);
    expect(STALENESS_COMPARISON).toContain('exact string inequality');
    expect(STALENESS_COMPARISON).toContain('never a chronological, ancestry, or ordering comparison');
  });

  test('an expectation configured for another repository yields no staleness verdict', () => {
    // `snapshot-envelope.md` §4 keys the expected-current revision to a
    // repository id. Repository A's revision says nothing about an envelope
    // describing repository B, and judging it stale would be the §5/§6
    // conflation wearing a staleness label.
    const result = checkStaleness(validated('wrong-repository.json'), REVISION_A, REPOSITORY_A);

    expect(result.outcome).toBe('not-applicable-different-repository');
    expect(result.outcome).not.toBe('stale-revision');
    expect(result.detail).toContain(`configured for repository ${REPOSITORY_A}`);
    expect(result.detail).toContain(REPOSITORY_B);
  });

  test('the scoping does not weaken the check for the repository it is about', () => {
    // Same call shape, same repository — still stale.
    const result = checkStaleness(validated('stale.json'), REVISION_A, REPOSITORY_A);
    expect(result.outcome).toBe('stale-revision');
  });

  test('admission refuses the stale fixture at the staleness stage, not the digest stage', () => {
    const result = admitEnvelope(fixtureText('stale.json'), ADMIT_OPTIONS_A);

    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.refusedAt).toBe('staleness');
    expect(result.reason).toBe('stale-revision');
    expect(result.detail).toContain(REVISION_A_STALE);
    expect(result.detail).toContain(REVISION_A);
  });
});

describe('repository identity mismatch is a rejection', () => {
  test('the wrong-repository fixture passes the digest check cleanly first', () => {
    expect(checkEnvelopeDigest(validated('wrong-repository.json')).outcome).toBe('match');
  });

  test('a different repository id is a mismatch', () => {
    const result = checkRepositoryIdentity(validated('wrong-repository.json'), REPOSITORY_A);

    expect(result.outcome).toBe('repository-identity-mismatch');
    expect(result.declaredRepositoryId).toBe(REPOSITORY_B);
    expect(result.expectedRepositoryId).toBe(REPOSITORY_A);
    expect(result.detail).toContain('is not the repository');
  });

  test('the expected repository id is ok', () => {
    const result = checkRepositoryIdentity(validated('valid.json'), REPOSITORY_A);
    expect(result.outcome).toBe('ok');
    expect(result.declaredRepositoryId).toBe(REPOSITORY_A);
  });

  test('with no expectation configured, the outcome is not-configured rather than ok', () => {
    const result = checkRepositoryIdentity(validated('wrong-repository.json'));
    expect(result.outcome).toBe('not-configured');
    expect(result.outcome).not.toBe('ok');
  });

  test('admission refuses at the identity stage, after staleness has passed', () => {
    // Configured for repository A *including* a revision expectation. Staleness
    // is keyed to repository A, so it produces no verdict for a repository-B
    // envelope and the refusal is attributable to identity — not to a revision
    // comparison that was never meaningful.
    const result = admitEnvelope(fixtureText('wrong-repository.json'), ADMIT_OPTIONS_A);

    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.refusedAt).toBe('repository-identity');
    expect(result.reason).toBe('repository-identity-mismatch');
    expect(result.detail).toContain(REPOSITORY_B);
    expect(result.detail).toContain(REPOSITORY_A);
  });

  test('the same refusal holds with no revision expectation at all', () => {
    const result = admitEnvelope(fixtureText('wrong-repository.json'), {
      sourceBaseDir: SOURCE_BASE_DIR,
      expectedRepositoryId: REPOSITORY_A,
    });

    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.refusedAt).toBe('repository-identity');
  });
});

describe('repository isolation is acceptance, not rejection', () => {
  test('a valid envelope from a different repository is admitted on its own terms', () => {
    // The contrast that §6 turns on: the same file that §5 rejects for a
    // consumer expecting A is perfectly valid for a consumer expecting B.
    const result = admitEnvelope(fixtureText('wrong-repository.json'), {
      sourceBaseDir: SOURCE_BASE_DIR,
      expectedRepositoryId: REPOSITORY_B,
      expectedRevision: REVISION_B,
    });

    expect(result.outcome).toBe('admitted');
    if (result.outcome !== 'admitted') return;
    expect(result.admitted.digestCheck.outcome).toBe('match');
    expect(result.admitted.identityCheck.outcome).toBe('ok');
    expect(result.admitted.stalenessCheck.outcome).toBe('ok');
  });

  test('a query scoped to one repository returns only that repository\'s entities', () => {
    const both = [validated('valid.json'), validated('wrong-repository.json')];

    const scopedToA = queryEntitiesForRepository(both, REPOSITORY_A);
    expect(scopedToA.returnedEntities.map((entity) => entity.identity.canonicalId)).toEqual([
      'component:default/payments',
      'component:default/ledger',
      'component:default/gateway',
    ]);
    expect(scopedToA.envelopesOutOfScope).toBe(1);
    // Report what was looked at: both repositories were considered, one filtered.
    expect(scopedToA.repositoriesConsidered).toEqual([REPOSITORY_A, REPOSITORY_B]);

    const scopedToB = queryEntitiesForRepository(both, REPOSITORY_B);
    expect(scopedToB.returnedEntities.map((entity) => entity.identity.canonicalId)).toEqual([
      'component:default/billing',
    ]);
    expect(scopedToB.envelopesOutOfScope).toBe(1);
  });

  test('no entity from one repository ever leaks into the other repository\'s result', () => {
    const both = [validated('valid.json'), validated('wrong-repository.json')];
    const a = new Set(queryEntitiesForRepository(both, REPOSITORY_A).returnedEntities.map((e) => e.identity.canonicalId));
    const b = new Set(queryEntitiesForRepository(both, REPOSITORY_B).returnedEntities.map((e) => e.identity.canonicalId));

    expect([...a].filter((id) => b.has(id))).toEqual([]);
    expect(a.size).toBe(3);
    expect(b.size).toBe(1);
  });

  test('a query scoped to a repository nobody loaded returns nothing and says so', () => {
    const both = [validated('valid.json'), validated('wrong-repository.json')];
    const result = queryEntitiesForRepository(both, 'github.com/mbeacom/not-loaded');

    expect(result.returnedEntities).toEqual([]);
    // An empty result is otherwise indistinguishable from a query that never
    // ran. These two fields are what make the difference visible.
    expect(result.envelopesOutOfScope).toBe(2);
    expect(result.repositoriesConsidered).toEqual([REPOSITORY_A, REPOSITORY_B]);
  });

  test('neither envelope is rejected by the query, and both remain independently valid', () => {
    const both = [validated('valid.json'), validated('wrong-repository.json')];
    queryEntitiesForRepository(both, REPOSITORY_A);

    for (const envelope of both) {
      expect(checkEnvelopeDigest(envelope).outcome).toBe('match');
    }
  });
});
