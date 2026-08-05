import { afterEach, describe, expect, test } from 'bun:test';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTestDir, resetTestDir } from '../packages/core/test/helpers.ts';
import { canonicalHash } from './audit-oracle-freeze.ts';
import { checkFreezeHashes, REASON_DRIFT } from './check-freeze-hashes.ts';

const DIR_NAME = 'check-freeze-hashes';
const LIVE_EVIDENCE = join(process.cwd(), 'specs/010-catalog-backstage/evidence');

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('T022 — freeze-hash drift check (R5 mechanism 2)', () => {
  test('passes against the live frozen trees, checking exactly the two hashed artifacts', async () => {
    const result = await checkFreezeHashes(LIVE_EVIDENCE);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.checked).toEqual([
      'frozen-expectations/frozen-expectation-set.json',
      'accept-corpus-freeze/accept-corpus-freeze.json',
    ]);
  });

  test('ignores sibling audit records that carry no contentHash', async () => {
    // The live tree contains audit-record.json and adequacy-audit.json; neither is
    // in `checked`, proving the drift check does not try to hash sibling records.
    const result = await checkFreezeHashes(LIVE_EVIDENCE);
    expect(result.checked).not.toContain('frozen-expectations/audit-record.json');
    expect(result.checked).not.toContain('accept-corpus-freeze/adequacy-audit.json');
  });
});

describe('T091 — the clause-5 prohibition: expectations are never amended to fit output', () => {
  /**
   * Phase B's hash values, read from the Barrier B checkpoint.
   *
   * The checkpoint was written by the independent auditor session — the author of the
   * T019 audit procedure, and *not* the author of the T014–T018 freeze — before any
   * generator existed. So the baseline is not a value Phase E or Phase F could have
   * chosen, which is the whole point of comparing against it.
   */
  async function phaseBHashes(): Promise<Record<string, string>> {
    const checkpoint = JSON.parse(
      await readFile(join(LIVE_EVIDENCE, 'barrier-b-checkpoint.json'), 'utf8'),
    ) as {
      confirmations: { mechanism2_hashMatch: { recordedHashes: Record<string, string> } };
    };
    return checkpoint.confirmations.mechanism2_hashMatch.recordedHashes;
  }

  test('every frozen hash is unchanged from its Phase B value, across all of E and F', async () => {
    // ADR-0020 clause 5: "the expectations are never amended to fit the output". A
    // comparison that passes because the expectations moved is not a passing comparison.
    const baseline = await phaseBHashes();
    expect(Object.keys(baseline).sort()).toEqual([
      'accept-corpus-freeze/accept-corpus-freeze.json',
      'frozen-expectations/frozen-expectation-set.json',
    ]);

    for (const [artifact, phaseB] of Object.entries(baseline)) {
      const parsed = JSON.parse(await readFile(join(LIVE_EVIDENCE, artifact), 'utf8')) as Record<
        string,
        unknown
      >;
      // Two comparisons, not one. The recorded field could have been edited to match
      // edited bytes; the recomputation could not.
      expect(parsed['contentHash']).toBe(phaseB);
      expect(canonicalHash(parsed)).toBe(phaseB);
    }
  });

  test('the drift check is green over the live trees after Phase E and Phase F', async () => {
    const result = await checkFreezeHashes(LIVE_EVIDENCE);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test('Phase F wrote its evidence outside the frozen trees', async () => {
    // The comparison's own artifacts live in evidence/comparison/, which is not one of
    // the two FREEZE_DIRS. If step (b) had written into a frozen tree, `checked` would
    // name a third artifact.
    const result = await checkFreezeHashes(LIVE_EVIDENCE);
    expect(result.checked).toEqual([
      'frozen-expectations/frozen-expectation-set.json',
      'accept-corpus-freeze/accept-corpus-freeze.json',
    ]);
    expect(await Bun.file(join(LIVE_EVIDENCE, 'comparison/diff-report.json')).exists()).toBe(true);
  });

  test('the T091 record agrees with what this test independently recomputed', async () => {
    // The record is produced by the harness run; this test recomputes from the artifacts.
    // Two derivations of the same fact, so a wrong record cannot pass unnoticed.
    const record = (await Bun.file(
      join(LIVE_EVIDENCE, 'comparison/expectations-unchanged.json'),
    ).json()) as {
      allUnchanged: boolean;
      comparisons: readonly {
        artifact: string;
        phaseBRecordedHash: string;
        recomputedNow: string;
        unchangedSincePhaseB: boolean;
        selfConsistentNow: boolean;
      }[];
    };
    expect(record.allUnchanged).toBe(true);

    const baseline = await phaseBHashes();
    for (const entry of record.comparisons) {
      expect(entry.unchangedSincePhaseB).toBe(true);
      expect(entry.selfConsistentNow).toBe(true);
      expect(entry.phaseBRecordedHash).toBe(baseline[entry.artifact] as string);
      const parsed = JSON.parse(
        await readFile(join(LIVE_EVIDENCE, entry.artifact), 'utf8'),
      ) as Record<string, unknown>;
      expect(entry.recomputedNow).toBe(canonicalHash(parsed));
    }
  });

  test('observed failing: an amended expectation is caught against the Phase B baseline', async () => {
    // The prohibition's failure mode, driven. An artifact edited to fit output and
    // re-hashed is SELF-consistent — its own contentHash matches its own bytes — so the
    // drift check alone would pass it. Comparing against Phase B's independently
    // recorded value is what catches it, and that is why this assertion exists
    // separately from T023's.
    const original = JSON.parse(
      await readFile(join(LIVE_EVIDENCE, 'frozen-expectations/frozen-expectation-set.json'), 'utf8'),
    ) as Record<string, unknown>;
    const baseline = await phaseBHashes();

    const { contentHash: _dropped, ...unsigned } = original;
    const amended = {
      ...unsigned,
      derivedPathPatterns: [...(original['derivedPathPatterns'] as string[]), 'amended/**'],
    };
    const resigned = { ...amended, contentHash: canonicalHash(amended) };

    // Self-consistent, so the narrower drift check would not flag it...
    expect(canonicalHash(resigned)).toBe(resigned.contentHash);
    // ...and yet it is NOT the artifact Phase B recorded.
    expect(resigned.contentHash).not.toBe(
      baseline['frozen-expectations/frozen-expectation-set.json'],
    );
    // The live artifact is untouched; nothing above was written to disk.
    expect(original['contentHash']).toBe(baseline['frozen-expectations/frozen-expectation-set.json']);
  });
});

describe('T023 — observed failing: a single mutated byte in a frozen artifact', () => {
  test('mutating one byte makes the drift check FAIL with the exact reason; restoring makes it PASS', async () => {
    const root = await resetTestDir(DIR_NAME);
    const evidence = join(root, 'evidence');
    // Copy only the two freeze dirs into an isolated evidence tree.
    await cp(join(LIVE_EVIDENCE, 'frozen-expectations'), join(evidence, 'frozen-expectations'), {
      recursive: true,
    });
    await cp(join(LIVE_EVIDENCE, 'accept-corpus-freeze'), join(evidence, 'accept-corpus-freeze'), {
      recursive: true,
    });

    // Baseline: the untouched copy passes.
    expect((await checkFreezeHashes(evidence)).ok).toBe(true);

    // Mutate exactly one byte of one frozen artifact WITHOUT touching its recorded
    // contentHash — flip a single character inside a value so the JSON stays parseable.
    const target = join(evidence, 'frozen-expectations', 'frozen-expectation-set.json');
    const original = await readFile(target, 'utf8');
    const idx = original.indexOf('workspaces/alpha/src/**');
    expect(idx).toBeGreaterThan(-1);
    // Change 'alpha' -> 'blpha' (one byte: 'a' -> 'b') at the located path value.
    const mutated = original.slice(0, idx) + 'b' + original.slice(idx + 1);
    expect(mutated).not.toBe(original);
    expect(mutated.length).toBe(original.length); // exactly one byte changed
    await writeFile(target, mutated, 'utf8');

    const failed = await checkFreezeHashes(evidence);
    expect(failed.ok).toBe(false);
    const drift = failed.findings.find(
      (f) => f.file === 'frozen-expectations/frozen-expectation-set.json',
    );
    expect(drift).toBeDefined();
    expect(drift!.reason).toBe(REASON_DRIFT);
    expect(drift!.recomputed).not.toBe(drift!.recorded);

    // Restore the byte; the check passes again.
    await writeFile(target, original, 'utf8');
    expect((await checkFreezeHashes(evidence)).ok).toBe(true);
  });
});
