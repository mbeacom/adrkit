/**
 * T042 — FR-010: repository identity and revision are compared by **exact string
 * equality**. A partial, prefix, or normalized match aborts the operation.
 *
 * `input-manifest.md` §3 step 4: "Any outcome other than both-match aborts
 * generation **before any entity's paths are derived** (FR-007) — including a
 * partial match (e.g. revision matches but repository ID does not)."
 *
 * The near-miss revision case is the one worth constructing deliberately: an
 * abbreviated SHA is the single most plausible way a real manifest ends up
 * "nearly" right, and `startsWith` is the single most plausible way an
 * implementation ends up accepting it.
 *
 * ADR-0016 evidence:
 * `specs/010-catalog-backstage/evidence/negative-cases/repository-mismatch/`.
 */

import { describe, expect, test } from 'bun:test';
import { compareRepositoryIdentity } from '../src/repository/identity.ts';

const ID = 'github.com/mbeacom/adrkit-scratch-fixture';
const HEAD = '3f5a1c9e8b2d4f6a0c7e1b3d5f7a9c1e3b5d7f90';

const OBSERVED = { remoteRaw: `git@github.com:mbeacom/adrkit-scratch-fixture.git`, head: HEAD };

describe('T042 — exact string equality on both values (FR-010)', () => {
  test('both agreeing is the only match', () => {
    const result = compareRepositoryIdentity({ id: ID, revision: HEAD }, OBSERVED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('match');
  });

  test('an abbreviated revision is a mismatch, not a prefix match', () => {
    const result = compareRepositoryIdentity({ id: ID, revision: HEAD.slice(0, 7) }, OBSERVED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('repository-mismatch');
    expect(result.rejection.triggerClass).toBe('repository-mismatch');
    expect(result.rejection.detail).toContain('revision:');
    expect(result.rejection.detail).not.toContain('repository id:');
  });

  test('a revision differing in one character is a mismatch', () => {
    const nearMiss = `${HEAD.slice(0, 39)}${HEAD.endsWith('0') ? '1' : '0'}`;
    expect(nearMiss).toHaveLength(40);
    expect(nearMiss).not.toBe(HEAD);
    const result = compareRepositoryIdentity({ id: ID, revision: nearMiss }, OBSERVED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('repository-mismatch');
  });

  test('an uppercase revision is a mismatch — comparison is not case-normalized', () => {
    const result = compareRepositoryIdentity({ id: ID, revision: HEAD.toUpperCase() }, OBSERVED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.detail).toContain('revision:');
  });

  test('a partial match — revision agrees, identity does not — still aborts', () => {
    const result = compareRepositoryIdentity(
      { id: 'github.com/mbeacom/some-other-repo', revision: HEAD },
      OBSERVED,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('repository-mismatch');
    expect(result.rejection.detail).toContain('repository id:');
    expect(result.rejection.detail).not.toContain('revision:');
  });

  test('a partial match the other way — identity agrees, revision does not — still aborts', () => {
    const result = compareRepositoryIdentity({ id: ID, revision: '0'.repeat(40) }, OBSERVED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.detail).toContain('revision:');
    expect(result.rejection.detail).not.toContain('repository id:');
  });

  test('both disagreeing reports both halves', () => {
    const result = compareRepositoryIdentity(
      { id: 'github.com/mbeacom/other', revision: '0'.repeat(40) },
      OBSERVED,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.detail).toContain('repository id:');
    expect(result.rejection.detail).toContain('revision:');
  });

  test('a repository-id prefix is a mismatch', () => {
    // `github.com/mbeacom/adrkit` is a strict prefix of the fixture's own id, so
    // an implementation using `startsWith` for identity would accept this.
    const result = compareRepositoryIdentity(
      { id: 'github.com/mbeacom/adrkit', revision: HEAD },
      OBSERVED,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.detail).toContain('repository id:');
  });

  test('the check records the values it compared, both sides', () => {
    const result = compareRepositoryIdentity({ id: ID, revision: '0'.repeat(40) }, OBSERVED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.detail).toContain('0'.repeat(40));
    expect(result.rejection.detail).toContain(HEAD);
  });

  test('an unrecognized remote normalizes to `invalid` and mismatches', () => {
    const result = compareRepositoryIdentity(
      { id: ID, revision: HEAD },
      { remoteRaw: 'https://gitlab.com/mbeacom/adrkit.git', head: HEAD },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.detail).toContain('"invalid"');
  });

  test('the observed values are compared, not re-read from the manifest', () => {
    // If the implementation ever re-read the manifest for its "observed" side,
    // every comparison would trivially match. Feeding a manifest that disagrees
    // with the observed state and requiring a rejection is what forecloses that.
    const result = compareRepositoryIdentity(
      { id: 'github.com/mbeacom/whatever-the-manifest-says', revision: 'f'.repeat(40) },
      OBSERVED,
    );
    expect(result.ok).toBe(false);
  });
});
