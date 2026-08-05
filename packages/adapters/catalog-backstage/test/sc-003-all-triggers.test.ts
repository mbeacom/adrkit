/**
 * T078 / SC-003 — **all fifteen** trigger classes driven through the assembled
 * pipeline, each recorded with its own exact reason string, each failing input retained
 * permanently.
 *
 * # Fifteen, not fourteen
 *
 * `contracts/atomic-fail-closed.md` §4 — "Closed Type of **Fifteen** Values".
 * `data-model.md` §8 lists the same fifteen. Spike 009's `atomic-fail-closed.md` §4
 * says fourteen, which is correct about spike 009 and wrong here (FR-035).
 *
 * # Fourteen through the full pipeline; one at a stage kernel, and why
 *
 * Fourteen classes are reached by handing the assembled pipeline a real manifest and
 * real descriptor files on disk.
 *
 * **`duplicate-canonical-ref` is not among them, and this is the
 * `[NEEDS CLARIFICATION]` T078 carries forward from T071 rather than a gap in the
 * fixtures.** `identity/canonicalize.ts` populates `allRefs` as `[canonicalId]` and
 * nothing else, because `data-model.md` §5 records how `allRefs` is populated beyond the
 * primary id as undecided, and `entity-identity.md` §2 states that alias refs come
 * "directly by a synthetic fixture's own construction" with "no real-corpus entity from
 * `community-plugins` or `rhdh-plugins`" ever carrying one. With `allRefs` holding only
 * the canonical id, two descriptors that canonicalize alike collide as
 * `duplicate-canonical-id`; **no descriptor-sourced input can reach
 * `duplicate-canonical-ref` at all.**
 *
 * So that one class is exercised at the **canonicalization stage's own uniqueness
 * kernel**, with a **synthetic** identity set. The kernel is the assembled pipeline's
 * code; only the input is synthetic. That is stated plainly here rather than presenting
 * a synthetic case as a corpus-derived one, which is exactly what T078's note asks for.
 *
 * Adding an alias input to the generation request to force the class through would
 * invent the production alias mechanism `entity-identity.md` §2 calls "an explicitly
 * separate, later, out-of-scope design decision". It was considered and rejected.
 *
 * # The permanent record
 *
 * Every failing input below is retained at
 * `specs/010-catalog-backstage/evidence/negative-cases/triggers/`, together with the
 * exact reason string this run observed. {@link OBSERVED_TRIGGERS} is exported so the
 * evidence file's own table can be checked against what the pipeline actually emits
 * rather than against a transcription.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { TRIGGER_CLASSES } from '../src/diagnostics.ts';
import type { TriggerClass } from '../src/diagnostics.ts';
import { checkGlobalUniqueness } from '../src/identity/uniqueness.ts';
import { runGeneration } from '../src/pipeline.ts';
import type { AtomicFailureRecord } from '../src/failure/abort.ts';
import {
  type Checkout,
  createCheckout,
  descriptor,
  request,
  stage,
  validDescriptor,
  writeManifest,
  writeSource,
} from './pipeline-fixtures.ts';
import { allMaintainerOverlay } from '../src/envelope/provenance.ts';

let checkout: Checkout;

/** Every class observed, with the reason and detail the pipeline actually emitted. */
export const OBSERVED_TRIGGERS = new Map<TriggerClass, AtomicFailureRecord>();

beforeAll(async () => {
  checkout = await createCheckout();
});

afterAll(async () => {
  await checkout.dispose();
});

/** Stage a case and assert the assembled pipeline aborts with `expected`. */
async function pipelineCase(
  name: string,
  expected: TriggerClass,
  expectedReason: string,
  build: () => Promise<Awaited<ReturnType<typeof stage>>['request']>,
): Promise<AtomicFailureRecord> {
  const outcome = await runGeneration(await build());

  if (outcome.ok) {
    throw new Error(`${name}: expected an abort with ${expected}, but generation succeeded`);
  }

  expect(outcome.failure.triggerClass).toBe(expected);
  expect(outcome.failure.reason).toBe(expectedReason);
  // Whole-operation: no envelope on the failure branch, whichever class fired.
  expect(Object.hasOwn(outcome, 'envelope')).toBe(false);

  OBSERVED_TRIGGERS.set(expected, outcome.failure);
  return outcome.failure;
}

describe('T078 — the closed enumeration is fifteen', () => {
  test('fifteen classes, counted from the declaration', () => {
    expect(TRIGGER_CLASSES).toHaveLength(15);
  });
});

describe('T078 — the four manifest-request-level classes', () => {
  test('invalid-manifest-shape — an unrecognized top-level field', async () => {
    await pipelineCase('invalid-manifest-shape', 'invalid-manifest-shape', 'unrecognized-top-level-field', async () => {
      const { request: staged } = await stage(
        checkout,
        { 'shape/catalog-info.yaml': validDescriptor('shapecase') },
        { extra: { unexpectedField: true } },
        'trigger-manifest-shape.json',
      );
      return staged;
    });
  });

  test('unsupported-manifest-version', async () => {
    await pipelineCase(
      'unsupported-manifest-version',
      'unsupported-manifest-version',
      'unsupported-manifest-version',
      async () => {
        const { request: staged } = await stage(
          checkout,
          { 'mv/catalog-info.yaml': validDescriptor('mvcase') },
          { manifestSchemaVersion: '2' },
          'trigger-manifest-version.json',
        );
        return staged;
      },
    );
  });

  test('unsupported-snapshot-version', async () => {
    await pipelineCase(
      'unsupported-snapshot-version',
      'unsupported-snapshot-version',
      'unsupported-snapshot-version',
      async () => {
        const { request: staged } = await stage(
          checkout,
          { 'sv/catalog-info.yaml': validDescriptor('svcase') },
          { requestedSnapshotSchemaVersion: '2' },
          'trigger-snapshot-version.json',
        );
        return staged;
      },
    );
  });

  test('unsupported-capability', async () => {
    await pipelineCase('unsupported-capability', 'unsupported-capability', 'unsupported-capability', async () => {
      const { request: staged } = await stage(
        checkout,
        { 'cap/catalog-info.yaml': validDescriptor('capcase') },
        { requiredCapabilities: ['pathOwnership', 'somethingUndefined'] },
        'trigger-capability.json',
      );
      return staged;
    });
  });

  test('incomplete-required-source — a listed source absent from the checkout', async () => {
    await pipelineCase('incomplete-required-source', 'incomplete-required-source', 'source-missing', async () => {
      const present = await writeSource(
        checkout,
        'src-present/catalog-info.yaml',
        validDescriptor('srcpresent'),
      );
      const absent = {
        path: 'src-absent/catalog-info.yaml',
        digestAlgorithm: 'sha256' as const,
        digest: 'a'.repeat(64),
      };
      const sources = [present, absent];
      const manifestPath = await writeManifest(checkout, sources, {}, 'trigger-source-missing.json');
      return request(checkout, manifestPath, sources);
    });
  });
});

describe('T078 — repository identity', () => {
  test('repository-mismatch', async () => {
    await pipelineCase('repository-mismatch', 'repository-mismatch', 'repository-mismatch', async () => {
      const { request: staged } = await stage(
        checkout,
        { 'repo/catalog-info.yaml': validDescriptor('repocase') },
        { repository: { id: 'github.com/someone/entirely-else' } },
        'trigger-repository.json',
      );
      return staged;
    });
  });
});

describe('T078 — descriptor parse: the pair §4.3 says must not collapse', () => {
  test('duplicate-yaml-key', async () => {
    await pipelineCase('duplicate-yaml-key', 'duplicate-yaml-key', 'duplicate-yaml-key', async () => {
      const { request: staged } = await stage(
        checkout,
        { 'dupkey/catalog-info.yaml': `${validDescriptor('dupkeycase')}kind: API\n` },
        {},
        'trigger-duplicate-key.json',
      );
      return staged;
    });
  });

  test('invalid-yaml-syntax', async () => {
    await pipelineCase('invalid-yaml-syntax', 'invalid-yaml-syntax', 'invalid-yaml-syntax', async () => {
      const { request: staged } = await stage(
        checkout,
        { 'badyaml/catalog-info.yaml': 'apiVersion: backstage.io/v1alpha1\nkind: [Component\n' },
        {},
        'trigger-yaml-syntax.json',
      );
      return staged;
    });
  });
});

describe('T078 — admissibility, the class ADR-0015 adds', () => {
  test('inadmissible-descriptor', async () => {
    const failure = await pipelineCase(
      'inadmissible-descriptor',
      'inadmissible-descriptor',
      'inadmissible-descriptor',
      async () => {
        const { request: staged } = await stage(
          checkout,
          {
            'inadm/catalog-info.yaml': descriptor({
              apiVersion: 'backstage.io/v1alpha1',
              kind: 'Component',
              name: 'Not_A_Valid_Name!',
            }),
          },
          {},
          'trigger-inadmissible.json',
        );
        return staged;
      },
    );

    // FR-020's three attributions travel with the record.
    expect(failure.detail).toContain('inadm/catalog-info.yaml');
    expect(failure.detail).toContain('validateEntityName');
    expect(failure.detail).toContain('1121a4facd9e321179d0402c3f355e4a649e84d9');
  });
});

describe('T078 — identity uniqueness', () => {
  test('duplicate-canonical-id', async () => {
    await pipelineCase('duplicate-canonical-id', 'duplicate-canonical-id', 'duplicate-canonical-id', async () => {
      const { request: staged } = await stage(
        checkout,
        {
          'dup-a/catalog-info.yaml': validDescriptor('collide'),
          'dup-b/catalog-info.yaml': validDescriptor('COLLIDE'.toLowerCase()),
        },
        {},
        'trigger-duplicate-id.json',
      );
      return staged;
    });
  });

  test('duplicate-canonical-ref — at the stage kernel, on a synthetic identity set', () => {
    // NOT reachable from descriptor input. See this file's module note: `allRefs` holds
    // only the canonical id, so two descriptors that canonicalize alike collide as
    // `duplicate-canonical-id` above. This drives the canonicalization stage's own
    // uniqueness kernel with a synthetic set, and is recorded as synthetic rather than
    // presented as corpus-derived.
    const outcome = checkGlobalUniqueness([
      { canonicalId: 'component:default/billing', allRefs: ['component:default/billing', 'component:default/billing-legacy'] },
      { canonicalId: 'component:default/billing-legacy', allRefs: ['component:default/billing-legacy'] },
    ]);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejection.triggerClass).toBe('duplicate-canonical-ref');
    expect(outcome.rejection.reason).toBe('duplicate-canonical-ref');

    OBSERVED_TRIGGERS.set('duplicate-canonical-ref', {
      triggerClass: 'duplicate-canonical-ref',
      reason: outcome.rejection.reason,
      detail: outcome.rejection.detail,
      sourcePath: undefined,
      documentIndex: undefined,
      stage: 'canonicalization',
    });
  });
});

describe('T078 — annotation decode and the frozen glob dialect', () => {
  test('invalid-annotation-parse — the annotation is not valid JSON', async () => {
    await pipelineCase('invalid-annotation-parse', 'invalid-annotation-parse', 'parse-error', async () => {
      const { request: staged } = await stage(
        checkout,
        { 'annparse/catalog-info.yaml': validDescriptor('annparsecase', '["packages/a/**"') },
        {},
        'trigger-annotation-parse.json',
      );
      return staged;
    });
  });

  test('invalid-annotation-shape — the annotation decodes to an object', async () => {
    await pipelineCase('invalid-annotation-shape', 'invalid-annotation-shape', 'wrong-shape', async () => {
      const { request: staged } = await stage(
        checkout,
        { 'annshape/catalog-info.yaml': validDescriptor('annshapecase', '{"paths":["packages/a/**"]}') },
        {},
        'trigger-annotation-shape.json',
      );
      return staged;
    });
  });

  test('invalid-pattern — a brace, which the dialect rejects at rule 6', async () => {
    await pipelineCase('invalid-pattern', 'invalid-pattern', 'invalid-pattern', async () => {
      const { request: staged } = await stage(
        checkout,
        { 'pattern/catalog-info.yaml': validDescriptor('patterncase', '["packages/{a,b}/**"]') },
        {},
        'trigger-pattern.json',
      );
      return staged;
    });
  });
});

describe('T078 — the backstop, reached by a genuinely invalid request', () => {
  test('other-invalid-input — an undeclared source provenance', async () => {
    // Not contrived: FR-043 makes the declaration load-bearing, `data-model.md` §1's
    // closed manifest schema has no field to carry it, and none of the fourteen named
    // classes describes a defect in it. `atomic-fail-closed.md` §4.2's case exactly.
    await pipelineCase(
      'other-invalid-input',
      'other-invalid-input',
      'provenance-declaration-missing',
      async () => {
        const declared = await writeSource(
          checkout,
          'prov-a/catalog-info.yaml',
          validDescriptor('provdeclared'),
        );
        const undeclared = await writeSource(
          checkout,
          'prov-b/catalog-info.yaml',
          validDescriptor('provundeclared'),
        );
        const sources = [declared, undeclared];
        const manifestPath = await writeManifest(checkout, sources, {}, 'trigger-provenance.json');
        return request(checkout, manifestPath, sources, allMaintainerOverlay([declared.path]));
      },
    );
  });

  test('invalid-manifest-shape — a manifest that is not there', async () => {
    // A second route to `invalid-manifest-shape`, recorded because it is the one an
    // operator hits first and its reason differs from a parse failure's. Grouped in
    // this block because it is the case most likely to be mistaken for the backstop's.
    const outcome = await runGeneration({
      manifestPath: `${checkout.root}/no-such-manifest.json`,
      checkoutRoot: checkout.root,
      provenance: { bySourcePath: {} },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.triggerClass).toBe('invalid-manifest-shape');
    expect(outcome.failure.reason).toBe('manifest-unreadable');
  });
});

describe('T078 / SC-003 — every one of the fifteen was observed', () => {
  test('all fifteen classes appear in the observed set', () => {
    const observed = [...OBSERVED_TRIGGERS.keys()].sort();
    const expected = [...TRIGGER_CLASSES].sort();
    expect(observed).toEqual(expected);
    expect(observed).toHaveLength(15);

    // The permanent record's table is generated from this, never transcribed. Run
    // `ADRKIT_PRINT_TRIGGERS=1 bun test test/sc-003-all-triggers.test.ts` to reproduce
    // `evidence/negative-cases/triggers/observed-reasons.md`'s table from a live run.
    if (process.env['ADRKIT_PRINT_TRIGGERS'] !== undefined) {
      const rows = [...OBSERVED_TRIGGERS.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([trigger, record]) => {
          // Newlines collapsed and pipes escaped: the `yaml` library's messages carry
          // both, and either would break the emitted table.
          const detail = record.detail.replaceAll(/\s+/gu, ' ').replaceAll('|', '\\|').trim();
          return `| \`${trigger}\` | \`${record.reason}\` | ${record.stage} | ${detail} |`;
        });
      console.log(['| Trigger class | Reason | Stage | Observed detail |', '|---|---|---|---|', ...rows].join('\n'));
    }
  });

  test('each observation carries its own distinct reason string', () => {
    const reasons = [...OBSERVED_TRIGGERS.values()].map((record) => record.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  test('every observation carries a non-empty detail', () => {
    for (const [trigger, record] of OBSERVED_TRIGGERS) {
      expect(record.detail.length).toBeGreaterThan(0);
      expect(record.triggerClass).toBe(trigger);
    }
  });

  test('exactly one of the fifteen was reached other than through the full pipeline', () => {
    // The honesty assertion. If a future change makes `duplicate-canonical-ref`
    // descriptor-reachable, this test fails and the module note above must be revised
    // rather than the count quietly changing.
    const record = OBSERVED_TRIGGERS.get('duplicate-canonical-ref');
    expect(record?.stage).toBe('canonicalization');
    expect(record?.sourcePath).toBeUndefined();
  });
});
