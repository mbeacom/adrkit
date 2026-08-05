/**
 * The record of how every fixture in this directory was constructed.
 *
 * The fixtures themselves are the artifacts — hand-reviewable JSON, committed,
 * and asserted on directly by the tests. This file exists so that *how* each
 * one was derived from the valid envelope is auditable rather than folklore,
 * and so that the three digest-sensitive constructions (`tampered`, `stale`,
 * `wrong-repository`) can be reproduced byte-for-byte.
 *
 * It is deterministic: re-running it rewrites the same bytes. It is not a test
 * and is not run by `bun test`.
 *
 * ```bash
 * bun run packages/catalog-envelope/test/fixtures/author.ts
 * ```
 *
 * **Everything here is synthetic.** No external adopter is involved and no
 * third-party content appears in any fixture — `snapshot-envelope.md` §7
 * requires exactly that, and it is why nothing these fixtures prove amounts to
 * external or community validation (ADR-0014 rung 3).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalStringify } from '@adrkit/core';

const FIX = import.meta.dir;
const SRC = join(FIX, 'sources');
mkdirSync(SRC, { recursive: true });

const REPO_A = 'github.com/mbeacom/adrkit-envelope-consumer-fixture';
const REV_A = '1e0f3c9a8b7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f';
const REV_STALE = 'f0e9d8c7b6a594837261504938271605948372a1';
const REPO_B = 'github.com/mbeacom/adrkit-envelope-consumer-fixture-second';
const REV_B = '2b7c4d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c';

const catalogInfoA = `# Synthetic fixture descriptor for @adrkit/catalog-envelope tests.
# Hand-authored. No external adopter is involved, and nothing here is
# third-party content.
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: payments
  namespace: default
spec:
  type: service
  owner: team-payments
  lifecycle: production
`;

const catalogInfoB = `# Synthetic fixture descriptor for the second-repository envelope.
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: billing
  namespace: default
spec:
  type: service
  owner: team-billing
  lifecycle: production
`;

writeFileSync(join(SRC, 'catalog-info.yaml'), catalogInfoA, 'utf8');
writeFileSync(join(SRC, 'second-catalog-info.yaml'), catalogInfoB, 'utf8');

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const sourcesA = [
  { path: 'catalog-info.yaml', digestAlgorithm: 'sha256', digest: sha(catalogInfoA) },
];
const sourcesB = [
  { path: 'second-catalog-info.yaml', digestAlgorithm: 'sha256', digest: sha(catalogInfoB) },
];

const GLOB = { engine: 'picomatch', version: '4.0.5', options: { dot: false, nocase: false, nonegate: true } };

const entitiesA = [
  {
    identity: { canonicalId: 'component:default/payments', allRefs: ['component:default/payments'] },
    ownershipState: 'explicit-paths',
    derivedPaths: ['apis/payments/**', 'packages/payments/**'],
    sourceDocument: { sourcePath: 'catalog-info.yaml', documentIndexInFile: 0 },
    provenance: 'synthetic',
  },
  {
    identity: { canonicalId: 'component:default/ledger', allRefs: ['component:default/ledger'] },
    ownershipState: 'explicit-empty',
    derivedPaths: [],
    sourceDocument: { sourcePath: 'catalog-info.yaml', documentIndexInFile: 1 },
    provenance: 'synthetic',
  },
  {
    identity: { canonicalId: 'component:default/gateway', allRefs: ['component:default/gateway'] },
    ownershipState: 'annotation-absent',
    derivedPaths: [],
    sourceDocument: { sourcePath: 'catalog-info.yaml', documentIndexInFile: 2 },
    provenance: 'synthetic',
  },
];

const entitiesB = [
  {
    identity: { canonicalId: 'component:default/billing', allRefs: ['component:default/billing'] },
    ownershipState: 'explicit-paths',
    derivedPaths: ['services/billing/**'],
    sourceDocument: { sourcePath: 'second-catalog-info.yaml', documentIndexInFile: 0 },
    provenance: 'synthetic',
  },
];

type Env = Record<string, unknown>;

function base(repoId: string, revision: string, sources: unknown[], entities: unknown[]): Env {
  return {
    schemaVersion: '1',
    repository: { id: repoId, revision },
    generatorVersion: '010-consumer-fixture-0.0.0',
    globDialect: GLOB,
    capabilities: ['pathOwnership'],
    completeness: { wholeCatalog: false, identityOnly: false },
    sources,
    entities,
  };
}

function sealed(env: Env): Env {
  const digest = createHash('sha256').update(canonicalStringify(env), 'utf8').digest('hex');
  return { ...env, digest };
}

function write(name: string, value: unknown): void {
  writeFileSync(join(FIX, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// --- valid ---------------------------------------------------------------
const valid = sealed(base(REPO_A, REV_A, sourcesA, entitiesA));
write('valid.json', valid);

// --- contrast case: all entities annotation-absent, identityOnly false ----
const allAbsent = sealed(
  base(
    REPO_A,
    REV_A,
    sourcesA,
    entitiesA.map((e) => ({ ...clone(e), ownershipState: 'annotation-absent', derivedPaths: [] })),
  ),
);
write('all-annotation-absent.json', allAbsent);

// --- step 1: invalid JSON ------------------------------------------------
writeFileSync(
  join(FIX, 'malformed-invalid-json.json'),
  `${JSON.stringify(valid, null, 2).slice(0, -220)}\n`,
  'utf8',
);

// --- step 2: wrong type at a nested level --------------------------------
const step2 = clone(valid) as Env;
(step2['entities'] as Env[])[1]!['identity'] = { canonicalId: 'component:default/ledger', allRefs: 'component:default/ledger' };
write('malformed-missing-or-wrong-field.json', step2);

// --- step 3: unrecognized dialect engine ---------------------------------
const step3 = clone(valid) as Env;
(step3['globDialect'] as Env)['engine'] = 'minimatch';
write('malformed-unrecognized.json', step3);

// --- step 4: a source entry that omits its digest -------------------------
const step4 = clone(valid) as Env;
step4['sources'] = [{ path: 'catalog-info.yaml', digestAlgorithm: 'sha256' }];
write('malformed-missing-source-digest.json', step4);

// --- step 5: identityOnly true -------------------------------------------
const step5raw = base(REPO_A, REV_A, sourcesA, entitiesA);
(step5raw['completeness'] as Env)['identityOnly'] = true;
write('malformed-identity-only.json', sealed(step5raw));

// --- tampered: derivedPaths mutated AFTER the digest was computed ---------
const tampered = clone(valid) as Env;
(tampered['entities'] as Env[])[0]!['derivedPaths'] = ['apis/payments/**', 'packages/payments/**', 'infra/**'];
write('tampered.json', tampered);

// --- stale: different revision, digest recomputed over actual content -----
write('stale.json', sealed(base(REPO_A, REV_STALE, sourcesA, entitiesA)));

// --- wrong repository: valid in its own right, different repository id ----
write('wrong-repository.json', sealed(base(REPO_B, REV_B, sourcesB, entitiesB)));

console.log('repoA', REPO_A, REV_A);
console.log('repoB', REPO_B, REV_B);
console.log('stale', REV_STALE);
console.log('valid.digest', valid['digest']);
