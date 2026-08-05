/**
 * Shared fixture access for the `@adrkit/catalog-envelope` test suite.
 *
 * Everything under `fixtures/` is synthetic and hand-authored; see
 * `fixtures/README.md` for how each was constructed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_DIR = join(import.meta.dir, 'fixtures');
export const SOURCE_BASE_DIR = join(FIXTURE_DIR, 'sources');

export const REPOSITORY_A = 'github.com/mbeacom/adrkit-envelope-consumer-fixture';
export const REVISION_A = '1e0f3c9a8b7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f';
export const REVISION_A_STALE = 'f0e9d8c7b6a594837261504938271605948372a1';
export const REPOSITORY_B = 'github.com/mbeacom/adrkit-envelope-consumer-fixture-second';
export const REVISION_B = '2b7c4d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c';

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

/** A parsed copy, safe to mutate. */
export function fixtureValue(name: string): Record<string, unknown> {
  return JSON.parse(fixtureText(name)) as Record<string, unknown>;
}

export const VALIDATE_OPTIONS = { sourceBaseDir: SOURCE_BASE_DIR } as const;

export const ADMIT_OPTIONS_A = {
  sourceBaseDir: SOURCE_BASE_DIR,
  expectedRepositoryId: REPOSITORY_A,
  expectedRevision: REVISION_A,
} as const;
