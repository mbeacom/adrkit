import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The committed Action bundles must not carry the inbound-marker feature.
 *
 * ADR-0021 scopes markers to `adr explain` and states that the `@adrkit/ci` bundle is
 * unchanged because `markers/read.ts` is never reached from `packages/ci/src` and
 * tree-shakes out. That is a real property, and a fragile one: it depends on the
 * module having no top-level initializer the bundler must keep. A single module
 * constant is enough to break it, and it did — three lines of `markers/read.ts`
 * appeared in both entry points until it was moved inside a function.
 *
 * Nothing caught that but a manual rebuild-and-diff. This is the check, so a future
 * change to core cannot quietly enlarge an Action bundle that never scans a marker.
 * If markers are ever wired into `adr check` and the Action — action item 1 of
 * ADR-0021 — this test is the thing that has to be deleted on purpose.
 */
const BUNDLES = ['packages/ci/dist/index.js', 'packages/ci/dist/queue-action.js'];

/**
 * Fragments that exist only in the marker feature, and nowhere else in core. The
 * module banner is one of them: it is what appeared when the property broke.
 */
const MARKER_ONLY_FRAGMENTS = [
  'markers/read.ts',
  'MARKER_HEADER_WINDOW_BYTES',
  'scanSourceMarkers',
  'readSourceMarkers',
  'resolveSourceMarkers',
  'mergeSourceDeclarations',
];

describe('the committed Action bundles stay outside the marker feature', () => {
  for (const bundle of BUNDLES) {
    test(`${bundle} contains no marker code`, async () => {
      const source = await readFile(resolve(process.cwd(), bundle), 'utf8');

      // Asserted as the list of offending fragments rather than with `not.toContain`,
      // so a failure names what leaked instead of printing a megabyte of bundle.
      expect(MARKER_ONLY_FRAGMENTS.filter((fragment) => source.includes(fragment))).toEqual([]);
    });
  }
});
