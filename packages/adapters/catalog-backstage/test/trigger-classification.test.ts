/**
 * T076 — each abort carries **exactly one** trigger class, and it is the **correct**
 * one, including for the pairs `atomic-fail-closed.md` §4.3 identifies as most at risk
 * of being merged.
 *
 * # The check that would be a tautology, and the one that is not
 *
 * Asserting that a validator's emitted `triggerClass` equals the class that validator
 * emits proves nothing. Every assertion below compares an **emitted** pair against
 * {@link REASON_TRIGGER_REGISTRY}, which is transcribed from the contracts and not from
 * any validator, so a validator that collapsed two classes disagrees with it.
 *
 * The registry is itself checked, in the other direction: every reason a validator can
 * actually emit must appear in it. A registry that had quietly lost an entry would
 * otherwise make `classifyAbort` throw at run time in production and pass here.
 */

import { describe, expect, test } from 'bun:test';
import {
  COLLAPSIBLE_PAIRS,
  REASON_TRIGGER_REGISTRY,
  TriggerClassificationError,
  classifyAbort,
  expectedTriggerFor,
} from '../src/failure/classify.ts';
import { TRIGGER_CLASSES } from '../src/diagnostics.ts';
import { readDescriptorDocuments } from '../src/descriptor/read.ts';
import { parseManifestText } from '../src/manifest/schema.ts';
import { checkManifestVersions } from '../src/manifest/version.ts';
import { validatePathLexically } from '../src/manifest/paths.ts';
import { checkDigestShape } from '../src/manifest/digests.ts';
import { decodeAnnotation } from '../src/ownership/annotation.ts';
import { deriveOwnership } from '../src/ownership/derive.ts';
import { checkGlobalUniqueness } from '../src/identity/uniqueness.ts';
import { compareRepositoryIdentity } from '../src/repository/identity.ts';
import { classifyAdmissibility, inadmissibleRejection } from '../src/admissibility/classify.ts';

/** Every rejection this package's validators actually produce, gathered by calling them. */
function emittedRejections(): readonly { readonly reason: string; readonly triggerClass: string }[] {
  const emitted: { reason: string; triggerClass: string }[] = [];
  const push = (rejection: { reason: string; triggerClass: string }): void => {
    emitted.push({ reason: rejection.reason, triggerClass: rejection.triggerClass });
  };

  // ── Manifest shape
  for (const text of [
    'not json at all',
    '[]',
    '{"manifestSchemaVersion":"1","requestedSnapshotSchemaVersion":"1","requiredCapabilities":[],"repository":{"id":"github.com/a/b","revision":"0".repeat(40)},"sources":[],"surprise":1}',
    '{"manifestSchemaVersion":"1"}',
    '{"manifestSchemaVersion":1,"requestedSnapshotSchemaVersion":"1","requiredCapabilities":[],"repository":{"id":"github.com/a/b","revision":"x"},"sources":[]}',
  ]) {
    const result = parseManifestText(text);
    if (!result.ok) push(result.rejection);
  }

  // ── Manifest version and capability
  const base = {
    manifestSchemaVersion: '1',
    requestedSnapshotSchemaVersion: '1',
    requiredCapabilities: ['pathOwnership'],
    repository: { id: 'github.com/a/b', revision: 'a'.repeat(40) },
    sources: [],
  };
  for (const override of [
    { manifestSchemaVersion: '2' },
    { requestedSnapshotSchemaVersion: '2' },
    { requiredCapabilities: ['somethingElse'] },
  ]) {
    const result = checkManifestVersions({ ...base, ...override });
    if (!result.ok) push(result.rejection);
  }

  // ── Source path, stage 1
  for (const path of ['', '.', '/abs', 'C:/x', 'a\\b', 'a/../b', 'a\u0001b']) {
    const result = validatePathLexically(path);
    if (!result.ok) push(result.rejection);
  }

  // ── Source digest shape
  const digestShape = checkDigestShape({ path: 'a', digestAlgorithm: 'sha256', digest: 'nope' });
  if (!digestShape.ok) push(digestShape.rejection);

  // ── Repository identity
  const identity = compareRepositoryIdentity(
    { id: 'github.com/a/b', revision: 'a'.repeat(40) },
    { remoteRaw: 'https://github.com/c/d.git', head: 'b'.repeat(40) },
  );
  if (!identity.ok) push(identity.rejection);

  // ── Descriptor parse: both halves of §4.3's first pair
  for (const text of ['kind: Component\nkind: Component\n', 'a: [1, 2\n']) {
    for (const document of readDescriptorDocuments('f.yaml', text)) {
      if (document.rejection !== undefined) push(document.rejection);
    }
  }

  // ── Admissibility
  const [inadmissible] = readDescriptorDocuments(
    'f.yaml',
    'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: Not_A_Valid_NAME!\n',
  );
  if (inadmissible !== undefined) {
    const result = classifyAdmissibility(inadmissible);
    if (!result.admissible) push(inadmissibleRejection(result));
  }

  // ── Annotation decode, steps 2 to 4
  for (const node of [['a'], '[not json', '{"paths":[]}']) {
    const result = decodeAnnotation(true, node);
    if (!result.ok) push(result.rejection);
  }

  // ── Annotation step 5
  const pattern = deriveOwnership(true, '["a{b}c"]');
  if (!pattern.ok) push(pattern.rejection);

  // ── Uniqueness
  const duplicateId = checkGlobalUniqueness([
    { canonicalId: 'component:default/a', allRefs: ['component:default/a'] },
    { canonicalId: 'component:default/a', allRefs: ['component:default/a'] },
  ]);
  if (!duplicateId.ok) push(duplicateId.rejection);

  const duplicateRef = checkGlobalUniqueness([
    { canonicalId: 'component:default/a', allRefs: ['component:default/a', 'component:default/b'] },
    { canonicalId: 'component:default/b', allRefs: ['component:default/b'] },
  ]);
  if (!duplicateRef.ok) push(duplicateRef.rejection);

  return emitted;
}

describe('T076 — every emitted rejection agrees with the contract-sourced registry', () => {
  const emitted = emittedRejections();

  test('the sweep actually produced rejections, so the check below read something', () => {
    // Guards the guard. An empty list would pass every assertion in this block.
    expect(emitted.length).toBeGreaterThanOrEqual(20);
  });

  test('every emitted reason is registered', () => {
    const unregistered = emitted
      .filter((rejection) => expectedTriggerFor(rejection.reason) === undefined)
      .map((rejection) => rejection.reason)
      .sort();
    expect(unregistered).toEqual([]);
  });

  test('every emitted class matches the class the contracts assign its reason', () => {
    const disagreements = emitted
      .filter((rejection) => expectedTriggerFor(rejection.reason) !== rejection.triggerClass)
      .map((rejection) => `${rejection.reason}: emitted ${rejection.triggerClass}`)
      .sort();
    expect(disagreements).toEqual([]);
  });

  test('every class the registry names is a member of the closed enumeration', () => {
    const outside = Object.values(REASON_TRIGGER_REGISTRY)
      .filter((trigger) => !(TRIGGER_CLASSES as readonly string[]).includes(trigger))
      .sort();
    expect(outside).toEqual([]);
  });
});

describe('T076 / §4.3 — the collapsible pairs stay distinct', () => {
  test('the contract names three pairs, and they are checked by name', () => {
    expect(COLLAPSIBLE_PAIRS).toHaveLength(3);
  });

  test('duplicate-yaml-key is not invalid-yaml-syntax', () => {
    const [duplicate] = readDescriptorDocuments('f.yaml', 'kind: Component\nkind: Component\n');
    const [malformed] = readDescriptorDocuments('f.yaml', 'a: [1, 2\n');

    expect(duplicate?.rejection?.triggerClass).toBe('duplicate-yaml-key');
    expect(malformed?.rejection?.triggerClass).toBe('invalid-yaml-syntax');
    expect(duplicate?.rejection?.triggerClass).not.toBe(malformed?.rejection?.triggerClass);
  });

  test('an unrecognized top-level manifest field is invalid-manifest-shape, not a version problem', () => {
    // `contracts/README.md` §4.2: `input-manifest.md` §1 calls this an "unsupported
    // manifest version"-class rejection and `atomic-fail-closed.md` §4 assigns it to
    // `invalid-manifest-shape`. §4 governs.
    const result = parseManifestText(
      JSON.stringify({
        manifestSchemaVersion: '1',
        requestedSnapshotSchemaVersion: '1',
        requiredCapabilities: ['pathOwnership'],
        repository: { id: 'github.com/a/b', revision: 'a'.repeat(40) },
        sources: [],
        surprise: true,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('unrecognized-top-level-field');
    expect(result.rejection.triggerClass).toBe('invalid-manifest-shape');
    expect(result.rejection.triggerClass).not.toBe('unsupported-manifest-version');
  });

  test('unsupported-manifest-version presumes a well-shaped manifest with a bad value', () => {
    const result = checkManifestVersions({
      manifestSchemaVersion: '2',
      requestedSnapshotSchemaVersion: '1',
      requiredCapabilities: ['pathOwnership'],
      repository: { id: 'github.com/a/b', revision: 'a'.repeat(40) },
      sources: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.triggerClass).toBe('unsupported-manifest-version');
  });

  test('a lexically invalid source path is invalid-manifest-shape, not incomplete-required-source', () => {
    // `contracts/README.md` §4.3 resolves `input-manifest.md` §4.1's silence: stage 1
    // is a defect in the manifest's own content, found before the file is opened.
    const result = validatePathLexically('../escape.yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.triggerClass).toBe('invalid-manifest-shape');
    expect(result.rejection.triggerClass).not.toBe('incomplete-required-source');
  });
});

describe('T076 — classifyAbort refuses a disagreement rather than repairing it', () => {
  test('a rejection whose class contradicts the registry throws', () => {
    expect(() =>
      classifyAbort(
        { reason: 'duplicate-yaml-key', triggerClass: 'invalid-yaml-syntax', detail: 'd' },
        'descriptor-read',
      ),
    ).toThrow(TriggerClassificationError);
  });

  test('an unregistered reason throws rather than being trusted', () => {
    expect(() =>
      classifyAbort({ reason: 'invented-reason', triggerClass: 'other-invalid-input', detail: 'd' }, 'manifest'),
    ).toThrow(TriggerClassificationError);
  });

  test('the error names both sides, so the disagreement is legible', () => {
    try {
      classifyAbort(
        { reason: 'duplicate-yaml-key', triggerClass: 'invalid-yaml-syntax', detail: 'd' },
        'descriptor-read',
      );
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).toContain('"duplicate-yaml-key"');
      expect((error as Error).message).toContain('"invalid-yaml-syntax"');
    }
  });

  test('an agreeing rejection yields exactly one record', () => {
    const record = classifyAbort(
      { reason: 'duplicate-yaml-key', triggerClass: 'duplicate-yaml-key', detail: 'd' },
      'descriptor-read',
      { sourcePath: 'f.yaml', documentIndex: 0 },
    );
    expect(record.triggerClass).toBe('duplicate-yaml-key');
    expect(record.stage).toBe('descriptor-read');
  });
});
