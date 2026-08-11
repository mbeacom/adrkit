/**
 * The negative cases here are the point. A guard that only ever runs against a healthy
 * tree proves nothing (ADR-0016), so each rule is exercised against a changelog that
 * violates it — including a verbatim reconstruction of the PR #117 regression this
 * check exists to catch.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkChangelog, checkChangelogContent } from './check-changelog.ts';
import { cleanupTestDir, resetTestDir, writeText } from '../packages/core/test/helpers.ts';

const DIR_NAME = 'check-changelog';

const HEALTHY = `# Changelog

## [Unreleased]

### Fixed

- Something not yet released.

## [0.5.0] - 2026-08-10

### Added

- A shipped feature.

## [0.4.0] - 2026-08-08

### Added

- An older shipped feature.
`;

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('check-changelog', () => {
  test('passes on this repository, and reports what it examined', async () => {
    const result = await checkChangelog();
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    // Not vacuous: the scan must have actually found released sections, and the
    // version under test must be among them.
    expect(result.releasedVersions.length).toBeGreaterThanOrEqual(2);
    expect(result.releasedVersions).toContain(result.version);
  });

  test('accepts a well-formed changelog', () => {
    const result = checkChangelogContent(HEALTHY, '0.5.0');
    expect(result.ok).toBe(true);
    expect(result.releasedVersions).toEqual(['0.5.0', '0.4.0']);
  });

  test('catches the PR #117 regression: a released heading absorbed into [Unreleased]', () => {
    // Exactly what happened — the `## [0.5.0] - 2026-08-10` line was replaced by the
    // incoming `### Fixed` block, so every shipped entry fell under [Unreleased].
    const absorbed = HEALTHY.replace('## [0.5.0] - 2026-08-10', '### Fixed\n\n- A newly merged fix.');
    const result = checkChangelogContent(absorbed, '0.5.0');

    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.rule)).toEqual(['missing-release-section']);
    expect(result.violations[0]?.message).toContain('0.5.0');
    // The healthy fixture it was derived from does pass, so the failure is caused by
    // the absorbed heading and not by something else in the fixture.
    expect(checkChangelogContent(HEALTHY, '0.5.0').ok).toBe(true);
  });

  test('catches a version bump whose section was never written', () => {
    const result = checkChangelogContent(HEALTHY, '0.6.0');
    expect(result.violations.map((violation) => violation.rule)).toEqual(['missing-release-section']);
  });

  test('catches a missing [Unreleased] heading', () => {
    const result = checkChangelogContent(HEALTHY.replace('## [Unreleased]\n\n', ''), '0.5.0');
    expect(result.violations.map((violation) => violation.rule)).toEqual(['missing-unreleased']);
  });

  test('catches [Unreleased] sorted below a released section', () => {
    const inverted = `# Changelog

## [0.5.0] - 2026-08-10

### Added

- A shipped feature.

## [Unreleased]
`;
    const result = checkChangelogContent(inverted, '0.5.0');
    expect(result.violations.map((violation) => violation.rule)).toEqual(['unreleased-not-first']);
  });

  test('a heading without a date is not counted as a release section', () => {
    // Keep a Changelog dates every release; an undated heading is a draft, and
    // treating it as released would let a version ship with no date.
    const undated = HEALTHY.replace('## [0.5.0] - 2026-08-10', '## [0.5.0]');
    expect(checkChangelogContent(undated, '0.5.0').ok).toBe(false);
  });

  test('reads the real package.json and CHANGELOG.md from the given root', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    await writeText(join(root, 'CHANGELOG.md'), HEALTHY);

    const result = await checkChangelog(root);
    expect(result.version).toBe('9.9.9');
    expect(result.violations.map((violation) => violation.rule)).toEqual(['missing-release-section']);
  });
});
