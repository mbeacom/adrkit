/**
 * T093 / FR-050 — assert this clone actually contains both feature-010 packages.
 *
 * # Why a green build is not evidence on its own
 *
 * `bun run build`, `bun run lint` and `bun test` all iterate over what they *find*. A
 * clone missing `packages/adapters/catalog-backstage/` would build, lint and test just as
 * green as one containing it — there would simply be less to do. FR-050 is a claim about
 * a clean clone being green **with both new packages present**, and the second half of
 * that claim is the half nothing else checks.
 *
 * This is the same defect `package-boundary.md` §4 documents for `check:deps`, where a
 * package with no allowlist entry is silently unconstrained: an absent rule and a
 * satisfied rule produce identical output. Both are closed the same way — by asserting
 * the thing exists before concluding anything from its passing.
 *
 * # What is checked
 *
 * 1. Both package directories exist and carry a `package.json` with the expected name.
 * 2. Each declares the `build`, `lint` and `typecheck` scripts the root `--filter='*'`
 *    scripts rely on. A package with no `build` script is skipped by `bun run build`
 *    without comment, which would put it back in the invisible state above.
 * 3. Each is inside the root `workspaces` globs, so `bun install` links it at all.
 * 4. Each has real source and test files, so "present" means populated rather than an
 *    empty directory left by a partial checkout.
 *
 * Run: `bun scripts/check-clean-clone.ts`
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dir, '..');

export interface ExpectedPackage {
  readonly name: string;
  /** Repository-relative, forward-slashed. */
  readonly directory: string;
  /** Which root `workspaces` glob is expected to match it. */
  readonly workspaceGlob: string;
}

/**
 * The two packages feature 010 adds.
 *
 * They are listed explicitly rather than discovered, because discovery would make this
 * check vacuous: a scan of "every package under packages/" finds nothing missing when
 * something is missing.
 */
export const EXPECTED_PACKAGES: readonly ExpectedPackage[] = [
  {
    name: '@adrkit/catalog-backstage',
    directory: 'packages/adapters/catalog-backstage',
    workspaceGlob: 'packages/adapters/*',
  },
  {
    name: '@adrkit/catalog-envelope',
    directory: 'packages/catalog-envelope',
    workspaceGlob: 'packages/*',
  },
];

/** Scripts the root `--filter='*'` entry points depend on finding. */
export const REQUIRED_SCRIPTS: readonly string[] = ['build', 'lint', 'typecheck'];

export interface Violation {
  readonly package: string;
  readonly reason: string;
}

function countFiles(directory: string): number {
  try {
    return readdirSync(directory, { recursive: true })
      .map(String)
      .filter((entry) => entry.endsWith('.ts')).length;
  } catch {
    return 0;
  }
}

/** Every way this clone falls short of FR-050's "with both new packages present". */
export function checkCleanClone(repoRoot: string = REPO_ROOT): Violation[] {
  const violations: Violation[] = [];

  const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    workspaces?: string[];
  };
  const workspaces = rootManifest.workspaces ?? [];

  for (const expected of EXPECTED_PACKAGES) {
    const directory = join(repoRoot, expected.directory);
    const manifestPath = join(directory, 'package.json');

    if (!existsSync(manifestPath)) {
      violations.push({
        package: expected.name,
        reason: `${expected.directory}/package.json is absent — this clone does not contain the package`,
      });
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };

    if (manifest.name !== expected.name) {
      violations.push({
        package: expected.name,
        reason: `${expected.directory}/package.json declares name "${manifest.name ?? '(none)'}"`,
      });
    }

    for (const script of REQUIRED_SCRIPTS) {
      if (manifest.scripts?.[script] === undefined) {
        violations.push({
          package: expected.name,
          reason: `declares no "${script}" script, so the root --filter='*' run would skip it silently`,
        });
      }
    }

    if (!workspaces.includes(expected.workspaceGlob)) {
      violations.push({
        package: expected.name,
        reason: `the root workspaces list does not include "${expected.workspaceGlob}", so it is not linked`,
      });
    }

    const sources = countFiles(join(directory, 'src'));
    const tests = countFiles(join(directory, 'test'));
    if (sources === 0) {
      violations.push({ package: expected.name, reason: 'src/ holds no TypeScript source' });
    }
    if (tests === 0) {
      violations.push({ package: expected.name, reason: 'test/ holds no TypeScript test' });
    }
  }

  return violations;
}

function main(): number {
  const violations = checkCleanClone();

  if (violations.length > 0) {
    console.error('check-clean-clone: FAIL — FR-050 requires both feature-010 packages present.');
    for (const violation of violations) {
      console.error(`  ${violation.package}: ${violation.reason}`);
    }
    return 1;
  }

  for (const expected of EXPECTED_PACKAGES) {
    const directory = join(REPO_ROOT, expected.directory);
    console.log(
      `check-clean-clone: ok ${expected.name} (${expected.directory}, ` +
        `${countFiles(join(directory, 'src'))} src + ${countFiles(join(directory, 'test'))} test modules)`,
    );
  }
  return 0;
}

if (import.meta.main) process.exit(main());
