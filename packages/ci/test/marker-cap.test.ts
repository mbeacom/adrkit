import { describe, expect, test } from 'bun:test';
import { MARKER_SCAN_FILE_CAP } from '@adrkit/core';
import { LIST_FILES_CAP } from '../src/changed-files.ts';

/**
 * The two caps have to compose, and only this package can see both: `@adrkit/core`
 * cannot import the provider constant, because the dependency runs the other way.
 *
 * `extractChanges` marks a list truncated at `LIST_FILES_CAP` and the Action refuses to
 * evaluate a truncated list at all, so every diff it answers holds at most
 * `LIST_FILES_CAP - 1` current/head-side marker paths. Rename source paths remain in
 * `changedFiles` for `affects` matching but are excluded from `markerFiles`, because
 * they no longer exist in the checkout. Keeping the scan cap at or above the provider
 * cap is what makes "the Action answered" mean "every current file was scanned for
 * markers".
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
