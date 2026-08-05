import { afterEach, describe, expect, test } from 'bun:test';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTestDir, resetTestDir } from '../packages/core/test/helpers.ts';
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
