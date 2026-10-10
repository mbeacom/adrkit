/**
 * Start-tag selection for generated release notes.
 *
 * Measured failure this guards: `spec-kit-v0.1.5` was created with
 * `--generate-notes` and no start tag, so its notes listed every pull request
 * since `v0.18.0` (#274–#282), and `v0.19.0` would have started at
 * `spec-kit-v0.1.5` and omitted them from both lockstep releases.
 *
 * Observed failing (ADR-0016), each plant reverted after the run:
 *
 * - Dropping the `parsed.kind !== target.kind` filter failed four tests:
 *   lockstep v0.19.0 received `spec-kit-v0.18.9`, adapter spec-kit-v0.2.0
 *   received `v0.1.9`, the noise case received `spec-kit-v0.1.5`, and
 *   spec-kit-v0.1.4 received `v0.1.0`. (A first draft without the in-between
 *   versions passed the two named tests under this plant, because cross-kind
 *   SemVer happened to agree; the in-between cases were added for that.)
 * - Comparing tags as strings (`tag > best.tag`) instead of by SemVer failed
 *   "lockstep picks v0.18.0" and "orders by SemVer" (received `v0.9.0`).
 * - Replacing the `--notes-start-tag` wiring in release.yml with the old
 *   `--generate-notes`-only command lines made the workflow contract test in
 *   action-tag-recovery-contract.test.ts fail.
 */

import { describe, expect, test } from 'bun:test';
import { parseReleaseTag, previousTagOfSameKind } from './release-notes-start-tag';

const TAGS = [
  'v0',
  'v0.1.0',
  'v0.9.0',
  'v0.10.0',
  'v0.17.0',
  'v0.18.0',
  'v0.19.0-rc.1',
  'spec-kit-v0.1.0',
  'spec-kit-v0.1.4',
  'spec-kit-v0.1.5',
  'action-recovery-block/0123456789abcdef0123456789abcdef01234567',
];

describe('previousTagOfSameKind', () => {
  test('lockstep picks v0.18.0 for v0.19.0 even when spec-kit-v0.1.5 is newer', () => {
    expect(previousTagOfSameKind('v0.19.0', TAGS)).toBe('v0.18.0');
    // An adapter version between them must still not win.
    expect(previousTagOfSameKind('v0.19.0', ['v0.18.0', 'spec-kit-v0.18.9'])).toBe('v0.18.0');
  });

  test('never picks the moving v0 tag, a pre-release, or a recovery marker', () => {
    const noise = ['v0', 'v1', 'v0.19.0-rc.1', 'action-recovery-block/abc', 'spec-kit-v0.1.5'];
    expect(previousTagOfSameKind('v0.19.0', noise)).toBeUndefined();
    expect(previousTagOfSameKind('v0.1.0', TAGS)).toBeUndefined();
  });

  test('adapter picks the previous adapter tag', () => {
    expect(previousTagOfSameKind('spec-kit-v0.1.6', TAGS)).toBe('spec-kit-v0.1.5');
    // A lockstep version between them must still not win.
    expect(previousTagOfSameKind('spec-kit-v0.2.0', ['spec-kit-v0.1.5', 'v0.1.9'])).toBe('spec-kit-v0.1.5');
  });

  test('first release of a kind returns none', () => {
    expect(previousTagOfSameKind('spec-kit-v0.1.0', TAGS)).toBeUndefined();
    expect(previousTagOfSameKind('other-adapter-v0.1.0', TAGS)).toBeUndefined();
    expect(previousTagOfSameKind('v0.1.0', [])).toBeUndefined();
  });

  test('orders by SemVer, not by string', () => {
    expect(previousTagOfSameKind('v0.11.0', ['v0.9.0', 'v0.10.0', 'v0.2.0'])).toBe('v0.10.0');
    expect(previousTagOfSameKind('v1.0.0', ['v0.10.0', 'v0.9.0'])).toBe('v0.10.0');
  });

  test('excludes the tag being released and any later tag', () => {
    expect(previousTagOfSameKind('v0.10.0', TAGS)).toBe('v0.9.0');
    expect(previousTagOfSameKind('spec-kit-v0.1.4', TAGS)).toBe('spec-kit-v0.1.0');
  });

  test('refuses a tag that is not a stable release tag', () => {
    expect(() => previousTagOfSameKind('v0', TAGS)).toThrow();
    expect(() => previousTagOfSameKind('v0.19.0-rc.1', TAGS)).toThrow();
    expect(() => previousTagOfSameKind('action-recovery-block/abc', TAGS)).toThrow();
  });
});

describe('parseReleaseTag', () => {
  test('separates the adapter slug from the version', () => {
    expect(parseReleaseTag('spec-kit-v0.1.5')).toEqual({ kind: 'spec-kit', major: 0, minor: 1, patch: 5 });
    expect(parseReleaseTag('v0.18.0')).toEqual({ kind: '', major: 0, minor: 18, patch: 0 });
    expect(parseReleaseTag('v01.0.0')).toBeUndefined();
  });
});
