/**
 * The released-section guard.
 *
 * `package.json`'s version is bumped by the release commit, so once a version is cut
 * the changelog must carry a `## [<version>] - <date>` heading for it. Nothing checked
 * that, and the failure it allows is silent in both directions: PR #117 replaced the
 * `## [0.5.0] - 2026-08-10` line with its own `### Fixed` block, which folded every
 * shipped v0.5.0 entry back under `[Unreleased]`. The changelog still parsed, still
 * rendered, and still read plausibly — it simply described a released version as
 * unreleased, and the next release cut from it would have re-announced v0.5.0's
 * features as new.
 *
 * The check is deliberately narrow. It does not police wording, ordering, or whether
 * an entry belongs where it sits; it asserts only the two structural facts that make a
 * changelog's release boundaries trustworthy: the current version has a section, and
 * `[Unreleased]` still exists above it to receive the next change.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `## [1.2.3] - 2026-08-10`, the Keep a Changelog release heading this repo uses. */
const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/;
const UNRELEASED_HEADING = /^## \[Unreleased\]\s*$/;

export interface ChangelogViolation {
  rule: 'missing-release-section' | 'missing-unreleased' | 'unreleased-not-first';
  message: string;
}

export interface ChangelogCheckResult {
  ok: boolean;
  version: string;
  releasedVersions: string[];
  violations: ChangelogViolation[];
}

export function checkChangelogContent(changelog: string, version: string): ChangelogCheckResult {
  const lines = changelog.split('\n');
  const releasedVersions: string[] = [];
  let unreleasedAt = -1;
  let firstReleaseAt = -1;

  lines.forEach((line, index) => {
    if (UNRELEASED_HEADING.test(line) && unreleasedAt === -1) unreleasedAt = index;
    const release = RELEASE_HEADING.exec(line);
    if (!release) return;
    releasedVersions.push(release[1] as string);
    if (firstReleaseAt === -1) firstReleaseAt = index;
  });

  const violations: ChangelogViolation[] = [];

  if (!releasedVersions.includes(version)) {
    violations.push({
      rule: 'missing-release-section',
      message: `package.json is at ${version}, but CHANGELOG.md has no "## [${version}] - <date>" heading. A released version whose section is missing means its entries are either lost or sitting under [Unreleased], where the next release would re-announce them.`,
    });
  }

  if (unreleasedAt === -1) {
    violations.push({
      rule: 'missing-unreleased',
      message: 'CHANGELOG.md has no "## [Unreleased]" heading, so the next change has nowhere to land.',
    });
  } else if (firstReleaseAt !== -1 && unreleasedAt > firstReleaseAt) {
    violations.push({
      rule: 'unreleased-not-first',
      message: `"## [Unreleased]" appears at line ${unreleasedAt + 1}, below the first release heading at line ${firstReleaseAt + 1}; entries are ordered newest-first, so it must come before every released section.`,
    });
  }

  return { ok: violations.length === 0, version, releasedVersions, violations };
}

export async function checkChangelog(root = process.cwd()): Promise<ChangelogCheckResult> {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    version?: string;
  };
  if (!version) {
    return {
      ok: false,
      version: '(missing)',
      releasedVersions: [],
      violations: [{ rule: 'missing-release-section', message: 'package.json declares no version.' }],
    };
  }
  return checkChangelogContent(await readFile(join(root, 'CHANGELOG.md'), 'utf8'), version);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await checkChangelog();
  if (result.ok) {
    // Report what was examined, not only what was concluded (ADR-0016 clause 3).
    console.log(
      `check-changelog: ok (${result.version} has a section; ${result.releasedVersions.length} released sections found)`,
    );
  } else {
    for (const violation of result.violations) console.error(`${violation.rule}: ${violation.message}`);
    process.exitCode = 1;
  }
}
