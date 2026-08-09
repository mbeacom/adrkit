import { describe, expect, test } from 'bun:test';
import { MARKER_SCAN_FILE_CAP } from '@adrkit/core';
import { LIST_FILES_CAP } from '../src/changed-files.ts';

/**
 * The two caps have to compose, and only this package can see both: `@adrkit/core`
 * cannot import the provider constant, because the dependency runs the other way.
 *
 * `extractChanges` marks a list truncated at `LIST_FILES_CAP` and the Action refuses to
 * evaluate a truncated list at all, so every diff it answers holds at most
 * `LIST_FILES_CAP - 1` paths. Keeping the scan cap at or above the provider cap is what
 * makes "the Action answered" mean "every changed file was scanned for markers" — with
 * a lower scan cap, a 1,500-file PR would drop the paths sorting after the cap and their
 * marker-only governance would silently not apply.
 */
describe('the marker scan cap composes with the changed-file provider cap', () => {
  test('no evaluable Action diff can exceed the marker scan cap', () => {
    expect(MARKER_SCAN_FILE_CAP).toBeGreaterThanOrEqual(LIST_FILES_CAP);
  });

  test('the largest diff the Action will evaluate still fits', () => {
    const largestEvaluableDiff = LIST_FILES_CAP - 1;
    expect(largestEvaluableDiff).toBeLessThanOrEqual(MARKER_SCAN_FILE_CAP);
  });
});
