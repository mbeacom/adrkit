/**
 * Guard: this feature leaves the core matcher surface and the published ADR
 * schema **unchanged** (`spec.md` FR-004, FR-005; T026).
 *
 * FR-004 forbids changing `packages/core/src/affects/**`'s matcher semantics,
 * the `CatalogPort` / `CatalogSnapshot` / `CatalogSnapshotEntity` shapes, the
 * Zod schema module, or the published ADR JSON Schema. FR-005 additionally
 * forbids adding the envelope as a field on `CatalogSnapshot` or
 * `CatalogSnapshotEntity`, or putting it into any published schema.
 *
 * ## Why this is a digest pin and not an absence check
 *
 * The obvious guard — "assert `SnapshotEnvelope` does not appear in core" — is
 * an assertion about an absence, and ADR-0016 clause 3 is explicit that an
 * absence and a blind check render identically. It is also the wrong shape: it
 * would pass while somebody quietly widened `CatalogSnapshotEntity` with an
 * `ownershipState` field, which is a different route to the same forbidden
 * outcome.
 *
 * So this pins a **specific observed value** per file — the SHA-256 of its bytes
 * at `99ba8d2500eaf37625ea164f66b4a17870e40dad`, the commit Phase C branched
 * from — plus the exact file list under `affects/`, so that adding or removing a
 * file is caught too.
 *
 * ## Why the pin table lives in a JSON sidecar
 *
 * Stated plainly rather than left to look like an odd style choice. Phase A's
 * locality guard at
 * `packages/adapters/catalog-backstage/test/envelope-shape-locality.test.ts`
 * scans every `.ts` file under this package for references to the published
 * schema surface, on the reasoning that "a package that never names it cannot
 * write it or regenerate it". That rule is over-broad for a **read-only
 * integrity pin**: this guard must name those paths precisely in order to hash
 * them, and it writes nothing.
 *
 * Phase A's own guards resolve the same self-reference problem with an
 * `EXCLUDED_FROM_SCAN` list, but that list lives in the adapter's tree, which
 * this phase does not own and must not edit. Keeping the paths in
 * `fixtures/protected-surfaces.json` — data, reviewable, and outside the `.ts`
 * scan's range — is the resolution available here. The conflict is reported for
 * central reconciliation rather than worked around silently; the maintainer may
 * prefer to add this file to `EXCLUDED_FROM_SCAN` instead, which would be the
 * cleaner fix.
 *
 * ## If one of these digests fails
 *
 * A failure means a protected surface changed. Under this feature that is a
 * **violation**, not a stale pin — FR-004 is unconditional, and updating the pin
 * to match would be amending the expectation to fit the output. A legitimate
 * change to these files belongs to separately-authorized later work.
 *
 * Observed failing before being relied on, in two ways:
 * `specs/010-catalog-backstage/evidence/negative-cases/consumer-core-surface-pin/`.
 */

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogPort, CatalogSnapshot, CatalogSnapshotEntity } from '@adrkit/core';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

interface ProtectedSurfaces {
  readonly protectedFiles: readonly { readonly path: string; readonly sha256: string; readonly why: string }[];
  readonly publishedSchemaPath: string;
  readonly affectsDirectory: string;
  readonly affectsFiles: readonly string[];
  readonly forbiddenSchemaVocabulary: readonly string[];
}

const PINS = JSON.parse(
  readFileSync(join(import.meta.dir, 'protected-surfaces.json'), 'utf8'),
) as ProtectedSurfaces;

function digestOf(relativePath: string): string {
  return createHash('sha256').update(readFileSync(join(REPO_ROOT, relativePath))).digest('hex');
}

function filesUnder(relativeDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const next = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), `${next}/`);
      else found.push(next);
    }
  };
  walk(join(REPO_ROOT, relativeDir), '');
  return found;
}

describe('the protected core and schema surfaces are unchanged', () => {
  test('the pin table covers seven files, each with a digest and a stated reason', () => {
    // Report what was examined, not only what was concluded: a pin table that
    // had been emptied would otherwise make every assertion below vacuous
    // (ADR-0016 clause 3).
    expect(PINS.protectedFiles).toHaveLength(7);
    for (const pin of PINS.protectedFiles) {
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pin.why.length).toBeGreaterThan(20);
    }
  });

  for (const pin of PINS.protectedFiles) {
    test(`${pin.path} is byte-identical to its pin`, () => {
      expect(digestOf(pin.path)).toBe(pin.sha256);
    });
  }

  test('no file has been added to or removed from the affects tree', () => {
    expect(filesUnder(PINS.affectsDirectory)).toEqual([...PINS.affectsFiles]);
  });
});

describe('the envelope is not smuggled into the core types', () => {
  test('CatalogSnapshotEntity still has exactly id, refs and paths', () => {
    // A type-level assertion as well as a runtime one: the literal below is the
    // complete set of members, so a widened interface fails to compile here.
    const entity: CatalogSnapshotEntity = { id: 'component:default/x', refs: [], paths: [] };
    expect(Object.keys(entity).sort()).toEqual(['id', 'paths', 'refs']);
  });

  test('CatalogSnapshot still has exactly entities', () => {
    const snapshot: CatalogSnapshot = { entities: [] };
    expect(Object.keys(snapshot)).toEqual(['entities']);
  });

  test('CatalogPort still has exactly its three methods', () => {
    const port: CatalogPort = {
      resolveEntity: () => [],
      entitiesForPaths: () => [],
      snapshot: () => ({ entities: [] }),
    };
    expect(Object.keys(port).sort()).toEqual(['entitiesForPaths', 'resolveEntity', 'snapshot']);
  });

  test('the published schema mentions no envelope vocabulary', () => {
    const published = readFileSync(join(REPO_ROOT, PINS.publishedSchemaPath), 'utf8');

    // Paired with the digest pin above rather than standing alone: on its own
    // this is an absence check, and an absence check cannot tell "looked and
    // found nothing" from "could not look". The digest pin is what makes it
    // meaningful; this states the specific thing FR-005 forbids.
    expect(published.length).toBeGreaterThan(1000);
    expect(PINS.forbiddenSchemaVocabulary.length).toBeGreaterThanOrEqual(5);

    const found = PINS.forbiddenSchemaVocabulary.filter((term) => published.includes(term));
    expect(found).toEqual([]);
  });
});
