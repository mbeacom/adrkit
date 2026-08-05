/**
 * T082 / FR-043 — the provenance boundary: upstream-authored descriptor content and
 * maintainer-authored annotation overlay are recorded as **distinct** provenances and
 * never merged into an undifferentiated whole.
 *
 * `data-model.md` §10 fixes the domain at two values and states what each means. The
 * blocks below check the domain, the exhaustive declaration, the two values surviving
 * side by side in one envelope, and the one thing the field must never do — assert
 * third-party adoption that nobody attested.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  ANNOTATION_PROVENANCES,
  allMaintainerOverlay,
  allUpstreamAuthored,
  checkProvenanceDeclaration,
  isAdoptionClaim,
  provenanceFor,
} from '../src/envelope/provenance.ts';
import { runGeneration } from '../src/pipeline.ts';
import { type Checkout, createCheckout, request, validDescriptor, writeManifest, writeSource } from './pipeline-fixtures.ts';

let checkout: Checkout;

beforeAll(async () => {
  checkout = await createCheckout();
});

afterAll(async () => {
  await checkout.dispose();
});

describe('T082 — the domain is closed at exactly two values', () => {
  test('`data-model.md` §10\u2019s two values, and no third', () => {
    expect([...ANNOTATION_PROVENANCES]).toEqual(['upstream-authored', 'maintainer-overlay']);
    expect(ANNOTATION_PROVENANCES).toHaveLength(2);
  });

  test('a value outside the domain is rejected rather than passed through', () => {
    const outcome = checkProvenanceDeclaration(
      { bySourcePath: { 'a.yaml': 'third-party' as 'maintainer-overlay' } },
      ['a.yaml'],
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejection.reason).toBe('provenance-declaration-unrecognized-value');
  });
});

describe('T082 — the declaration is exhaustive and has no default', () => {
  test('a complete declaration passes', () => {
    expect(checkProvenanceDeclaration(allMaintainerOverlay(['a.yaml', 'b.yaml']), ['a.yaml', 'b.yaml']).ok).toBe(
      true,
    );
  });

  test('a missing entry is rejected, never defaulted', () => {
    // The safety property. A default of `upstream-authored` would turn an omission
    // into a claim that a third party adopted the annotation.
    const outcome = checkProvenanceDeclaration(allMaintainerOverlay(['a.yaml']), ['a.yaml', 'b.yaml']);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejection.reason).toBe('provenance-declaration-missing');
    expect(outcome.rejection.detail).toContain('b.yaml');
  });

  test('the rejection explains why no default is available', () => {
    const outcome = checkProvenanceDeclaration({ bySourcePath: {} }, ['a.yaml']);
    if (outcome.ok) throw new Error('expected a rejection');
    expect(outcome.rejection.detail).toContain('third-party adoption');
  });

  test('the reported path does not depend on key insertion order', () => {
    const first = checkProvenanceDeclaration({ bySourcePath: {} }, ['z.yaml', 'a.yaml']);
    const second = checkProvenanceDeclaration({ bySourcePath: {} }, ['a.yaml', 'z.yaml']);
    if (first.ok || second.ok) throw new Error('expected rejections');
    expect(first.rejection.detail).toBe(second.rejection.detail);
    expect(first.rejection.detail).toContain('a.yaml');
  });

  test('provenanceFor throws rather than substituting a value', () => {
    expect(() => provenanceFor({ bySourcePath: {} }, 'a.yaml')).toThrow(
      'no annotation provenance declared',
    );
  });
});

describe('T082 — the two provenances survive side by side, unmerged', () => {
  test('one envelope carries both values, each on its own entity', async () => {
    const overlaid = await writeSource(
      checkout,
      'overlaid/catalog-info.yaml',
      validDescriptor('overlaid', '["packages/overlaid/**"]'),
    );
    const upstream = await writeSource(
      checkout,
      'upstream/catalog-info.yaml',
      validDescriptor('upstream', '["packages/upstream/**"]'),
    );
    const sources = [overlaid, upstream];
    const manifestPath = await writeManifest(checkout, sources, {}, 'manifest-provenance.json');

    const outcome = await runGeneration(
      request(checkout, manifestPath, sources, {
        bySourcePath: {
          'overlaid/catalog-info.yaml': 'maintainer-overlay',
          'upstream/catalog-info.yaml': 'upstream-authored',
        },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const byId = new Map(
      outcome.envelope.entities.map((entity) => [entity.identity.canonicalId, entity.provenance]),
    );
    expect(byId.get('component:default/overlaid')).toBe('maintainer-overlay');
    expect(byId.get('component:default/upstream')).toBe('upstream-authored');

    // Never merged: two distinct values are present in one envelope, so nothing
    // collapsed them into an undifferentiated whole.
    expect(new Set(byId.values()).size).toBe(2);
  });

  test('the frozen accept corpus\u2019 own construction maps to maintainer-overlay', async () => {
    // `accept-corpus-freeze/overlay.json`: "No descriptor in the pinned corpus carries
    // `adrkit.io/owned-paths`... Every annotation value below was written by the
    // maintainer. None was read from upstream."
    const source = await writeSource(
      checkout,
      'freeze-shaped/catalog-info.yaml',
      validDescriptor('freezeshaped', '["workspaces/alpha/src/**"]'),
    );
    const manifestPath = await writeManifest(checkout, [source], {}, 'manifest-freeze-shaped.json');

    const outcome = await runGeneration(
      request(checkout, manifestPath, [source], allMaintainerOverlay([source.path])),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.envelope.entities[0]?.provenance).toBe('maintainer-overlay');
  });
});

describe('T082 — provenance alone is not an adoption claim; the pair is', () => {
  test('an annotation-absent entity is never an adoption claim, whatever its provenance', () => {
    // `data-model.md` §10's domain has no value for "no annotation exists", and
    // `annotation-absent` is the common real-corpus case. `envelope/provenance.ts`
    // records that gap; this is the predicate that keeps it safe to read.
    expect(isAdoptionClaim('annotation-absent', 'upstream-authored')).toBe(false);
    expect(isAdoptionClaim('annotation-absent', 'maintainer-overlay')).toBe(false);
  });

  test('an existing annotation declared upstream-authored IS an adoption claim', () => {
    expect(isAdoptionClaim('explicit-paths', 'upstream-authored')).toBe(true);
    expect(isAdoptionClaim('explicit-empty', 'upstream-authored')).toBe(true);
  });

  test('an existing annotation declared maintainer-overlay is not', () => {
    expect(isAdoptionClaim('explicit-paths', 'maintainer-overlay')).toBe(false);
  });

  test('a run over an unannotated corpus makes no adoption claim', async () => {
    const source = await writeSource(
      checkout,
      'no-annotation/catalog-info.yaml',
      validDescriptor('noannotation'),
    );
    const manifestPath = await writeManifest(checkout, [source], {}, 'manifest-no-annotation.json');

    const outcome = await runGeneration(
      request(checkout, manifestPath, [source], allUpstreamAuthored([source.path])),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const entity = outcome.envelope.entities[0];
    expect(entity?.ownershipState).toBe('annotation-absent');
    expect(entity?.provenance).toBe('upstream-authored');
    expect(isAdoptionClaim(entity?.ownershipState ?? 'annotation-absent', entity?.provenance ?? 'upstream-authored')).toBe(
      false,
    );
  });
});
