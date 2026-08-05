/**
 * T077 / SC-002 — **whole-operation atomicity over a mixed batch**: a batch containing
 * both valid and invalid entities produces no output at all.
 *
 * # Why this is a separate test from Phase D's per-rule ones
 *
 * `atomic-fail-closed.md` §2 is explicit: "Per-rule tests exercise each validation rule
 * **in isolation** — one fixture, one violated rule at a time. This contract is tested
 * **separately**: introduce **exactly one** invalid entity into an **otherwise-valid
 * batch**, and confirm the whole run aborts... **Passing the per-rule tests does not
 * demonstrate this contract.** The two properties MUST be tested independently."
 *
 * `plan.md` places this behind Barrier B under R4's *definition* even though R4's
 * distinguishing test alone might not have, because running a mixed batch may compute
 * in-memory ownership for the valid entities before aborting — and in-memory derivation
 * is generator output.
 *
 * # Each case proves the batch really was otherwise valid
 *
 * Every case below runs the **same batch minus the one offender** first and asserts it
 * produces a populated envelope. Without that, "no envelope was produced" would be
 * equally consistent with a fixture that was broken for some unrelated reason, and the
 * test would demonstrate nothing.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TriggerClass } from '../src/diagnostics.ts';
import { generateAndWriteEnvelope, runGeneration } from '../src/pipeline.ts';
import { type Checkout, createCheckout, descriptor, stage, validDescriptor } from './pipeline-fixtures.ts';

let checkout: Checkout;
let output: string;
let caseIndex = 0;

beforeAll(async () => {
  checkout = await createCheckout();
  output = await mkdtemp(join(tmpdir(), 'adrkit-sc002-'));
});

afterAll(async () => {
  await checkout.dispose();
  await rm(output, { recursive: true, force: true });
});

/** The five otherwise-valid entities `atomic-fail-closed.md` §3's worked example uses. */
function fiveValid(prefix: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
    files[`${prefix}/${name}/catalog-info.yaml`] = validDescriptor(
      `${prefix}${name}`,
      `["packages/${name}/**"]`,
    );
  }
  return files;
}

/**
 * Run the five valid entities alone, then the same five plus `offender`.
 *
 * Returns both outcomes so a caller can assert on each. The control run is not
 * optional: it is what makes the experimental run's failure attributable.
 */
async function mixedBatch(
  prefix: string,
  offenderPath: string,
  offenderText: string,
): Promise<{
  readonly control: Awaited<ReturnType<typeof runGeneration>>;
  readonly mixed: Awaited<ReturnType<typeof runGeneration>>;
  readonly mixedRequest: Awaited<ReturnType<typeof stage>>['request'];
}> {
  caseIndex += 1;
  const valid = fiveValid(prefix);

  const { request: controlRequest } = await stage(checkout, valid, {}, `sc002-control-${caseIndex}.json`);
  const control = await runGeneration(controlRequest);

  const { request: mixedRequest } = await stage(
    checkout,
    { ...valid, [offenderPath]: offenderText },
    {},
    `sc002-mixed-${caseIndex}.json`,
  );
  const mixed = await runGeneration(mixedRequest);

  return { control, mixed, mixedRequest };
}

/** Every case: one offender, one expected class, and §3's table applied to each. */
const CASES: readonly {
  readonly label: string;
  readonly prefix: string;
  readonly offenderPath: string;
  readonly offenderText: string;
  readonly triggerClass: TriggerClass;
}[] = [
  {
    label: '§3\u2019s own worked example — a sixth entity with a duplicate canonical id',
    prefix: 'dup',
    offenderPath: 'dup/sixth/catalog-info.yaml',
    offenderText: validDescriptor('dupalpha', '["packages/sixth/**"]'),
    triggerClass: 'duplicate-canonical-id',
  },
  {
    label: '§5\u2019s variant — the sixth entity is inadmissible instead',
    prefix: 'inadm',
    offenderPath: 'inadm/sixth/catalog-info.yaml',
    offenderText: descriptor({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      name: 'Not_A_Valid_Name!',
    }),
    triggerClass: 'inadmissible-descriptor',
  },
  {
    label: 'the sixth entity declares a pattern the frozen dialect rejects',
    prefix: 'pat',
    offenderPath: 'pat/sixth/catalog-info.yaml',
    offenderText: validDescriptor('patsixth', '["packages/{a,b}/**"]'),
    triggerClass: 'invalid-pattern',
  },
  {
    label: 'the sixth entity repeats a YAML mapping key',
    prefix: 'yaml',
    offenderPath: 'yaml/sixth/catalog-info.yaml',
    offenderText: `${validDescriptor('yamlsixth')}kind: API\n`,
    triggerClass: 'duplicate-yaml-key',
  },
  {
    label: 'the sixth entity\u2019s annotation is not valid JSON',
    prefix: 'ann',
    offenderPath: 'ann/sixth/catalog-info.yaml',
    offenderText: validDescriptor('annsixth', '["packages/a/**"'),
    triggerClass: 'invalid-annotation-parse',
  },
];

describe('T077 / SC-002 — one invalid entity aborts the whole run', () => {
  for (const testCase of CASES) {
    describe(testCase.label, () => {
      test('the five without the offender produce a populated envelope', async () => {
        const { control } = await mixedBatch(testCase.prefix, testCase.offenderPath, testCase.offenderText);
        expect(control.ok).toBe(true);
        if (!control.ok) return;
        expect(control.envelope.entities).toHaveLength(5);
      });

      test(`the same five plus the offender abort with ${testCase.triggerClass}`, async () => {
        const { mixed } = await mixedBatch(testCase.prefix, testCase.offenderPath, testCase.offenderText);
        expect(mixed.ok).toBe(false);
        if (mixed.ok) return;
        expect(mixed.failure.triggerClass).toBe(testCase.triggerClass);
      });

      test('no envelope exists — not even one covering the five that would have validated', async () => {
        const { mixed, mixedRequest } = await mixedBatch(
          testCase.prefix,
          testCase.offenderPath,
          testCase.offenderText,
        );
        expect(mixed.ok).toBe(false);

        const directory = join(output, `${testCase.prefix}-no-output`);
        const written = await generateAndWriteEnvelope(mixedRequest, join(directory, 'envelope.json'));
        expect(written.ok).toBe(false);

        // `readdir` on a directory that was never created throws. That is the
        // assertion: not "the file is empty", but "nothing was produced at all".
        await expect(readdir(directory)).rejects.toThrow();
      });
    });
  }
});

describe('T077 / §1 — "skip the bad entity and keep going" is not what happens', () => {
  test('the abort is not a filtered result with five entities in it', async () => {
    // §1 names this as "the single most likely implementation mistake this contract
    // exists to foreclose". The check is that the failure branch has no entity list at
    // all, not that the list is a particular length.
    const { mixed } = await mixedBatch(
      'skip',
      'skip/sixth/catalog-info.yaml',
      validDescriptor('skipalpha'),
    );
    expect(mixed.ok).toBe(false);
    if (mixed.ok) return;
    expect(Object.hasOwn(mixed, 'envelope')).toBe(false);
  });

  test('the consequence does not vary by which trigger fired', async () => {
    // §4.2: the abort "applies identically regardless of which named trigger, or the
    // backstop, fired". Checked across every case above rather than on one. The
    // fixtures are re-staged unchanged — an earlier version re-prefixed them, which
    // silently made the duplicate-id offender stop duplicating anything.
    for (const testCase of CASES) {
      const { mixed } = await mixedBatch(testCase.prefix, testCase.offenderPath, testCase.offenderText);
      expect(mixed.ok).toBe(false);
      if (mixed.ok) continue;
      expect(Object.hasOwn(mixed, 'envelope')).toBe(false);
      expect(mixed.failure.triggerClass).toBe(testCase.triggerClass);
    }
  });

  test('an offender placed first aborts exactly as one placed last does', async () => {
    // Order-independence: the abort is a property of the batch, not of where the
    // offender happens to sit in it.
    caseIndex += 1;
    const offender = descriptor({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      name: 'Bad_Name!',
    });

    const { request: first } = await stage(
      checkout,
      { 'order/aaa-first/catalog-info.yaml': offender, ...fiveValid('order-a') },
      {},
      `sc002-order-first-${caseIndex}.json`,
    );
    const { request: last } = await stage(
      checkout,
      { ...fiveValid('order-b'), 'order/zzz-last/catalog-info.yaml': offender },
      {},
      `sc002-order-last-${caseIndex}.json`,
    );

    const firstOutcome = await runGeneration(first);
    const lastOutcome = await runGeneration(last);

    expect(firstOutcome.ok).toBe(false);
    expect(lastOutcome.ok).toBe(false);
    if (firstOutcome.ok || lastOutcome.ok) return;
    expect(firstOutcome.failure.triggerClass).toBe(lastOutcome.failure.triggerClass);
  });
});
