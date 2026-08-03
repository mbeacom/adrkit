import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { packageRoot } from './manifest-fixture.ts';

const repoRoot = dirname(dirname(dirname(packageRoot)));

/**
 * Packaging constraints imposed by how Spec Kit installs an extension.
 *
 * `specify extension add --dev <path>` copies the extension directory verbatim
 * into the consuming project's `.specify/extensions/<id>/`. It does not skip
 * `node_modules`. Verified against v0.15.1: a single declared dependency is
 * enough for Bun's isolated linker to create `node_modules/` here, and the
 * install then either deposits it in someone else's repository or — when it
 * contains a workspace symlink, which it does — aborts with a `shutil.Error`
 * partway through, leaving a half-installed extension behind.
 */
describe('packaging', () => {
  const packageJson = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;

  test('declares no dependencies of any kind', () => {
    for (const section of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      expect({ section, value: packageJson[section] }).toEqual({
        section,
        value: undefined,
      });
    }
  });

  test('carries no node_modules directory to copy into a consumer', () => {
    // The consequence of the rule above, asserted directly. If a dependency is
    // ever added, this fails on the next install even before the manifest test
    // does, and names the reason.
    expect(existsSync(join(packageRoot, 'node_modules'))).toBe(false);
  });

  test('is publishable, and independently versioned', () => {
    // ADR-0019 action item 4 resolved to publishing on npm *and* the Spec Kit
    // community catalog. ADR-0007 requires the adapter carry its own version
    // rather than moving with the core release tag, so `release-pack` treats it
    // as `versioning: 'independent'`.
    expect(packageJson['private']).toBeUndefined();
    expect(packageJson['publishConfig']).toEqual({ access: 'public' });
    expect(packageJson['version']).not.toBe('0.3.0');
  });

  test('publishes no dist, because it builds nothing', () => {
    const files = packageJson['files'];
    expect(Array.isArray(files)).toBe(true);
    expect(files as string[]).toContain('README.md');
    expect(files as string[]).toContain('extension.yml');
    expect(files as string[]).not.toContain('dist');
  });

  test('ships every file the installed extension needs at runtime', () => {
    // The install copies the directory, so these must exist on disk — a `files`
    // allowlist in package.json governs npm packing and has no effect here.
    for (const required of [
      'extension.yml',
      'commands/context.md',
      'commands/check.md',
      'commands/draft.md',
      'scripts/adrkit-lib.sh',
      'scripts/context.sh',
      'scripts/check.sh',
      'scripts/draft.sh',
      'LICENSE',
      'NOTICE',
    ]) {
      expect({ required, present: existsSync(join(packageRoot, required)) }).toEqual({
        required,
        present: true,
      });
    }
  });

  test('carries the license every install path can see', () => {
    // Every sibling package copies LICENSE and NOTICE into `dist` at build time.
    // This one has no build, and three install paths — npm, the catalog zip, and
    // `specify extension add --dev` from a checkout — so the files are committed
    // rather than generated. v0.1.0 shipped without them; that is what this
    // guards against repeating.
    for (const name of ['LICENSE', 'NOTICE']) {
      const packaged = readFileSync(join(packageRoot, name), 'utf8');
      const canonical = readFileSync(join(repoRoot, name), 'utf8');
      expect({ name, identical: packaged === canonical }).toEqual({ name, identical: true });
      expect(packaged.length).toBeGreaterThan(100);
    }

    const files = packageJson['files'] as string[];
    expect(files).toContain('LICENSE');
    expect(files).toContain('NOTICE');
  });

  test('the license reaches a --dev install, not just the tarball', () => {
    // `.extensionignore` governs what `specify extension add --dev` copies. An
    // exclusion here would ship the license on npm and withhold it from the
    // install path the README documents first.
    const patterns = readFileSync(join(packageRoot, '.extensionignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    for (const name of ['LICENSE', 'NOTICE']) {
      expect({ name, excluded: patterns.includes(name) }).toEqual({ name, excluded: false });
    }
  });

  test('excludes development-only files from what a consumer receives', () => {
    // `.extensionignore` is upstream's gitignore-semantics exclusion list,
    // supported across the whole pinned range (present in 0.13.0 and 0.15.1).
    // Without it the install deposits our test suite and tsconfig in someone
    // else's repository.
    const ignoreFile = join(packageRoot, '.extensionignore');
    expect(existsSync(ignoreFile)).toBe(true);

    const patterns = readFileSync(ignoreFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    for (const excluded of ['test/', 'tsconfig.json', 'package.json', 'node_modules/']) {
      expect({ excluded, listed: patterns.includes(excluded) }).toEqual({
        excluded,
        listed: true,
      });
    }

    // Guard the guard: the runtime files must NOT be excluded. An ignore list
    // that swallowed commands/ or scripts/ would install a broken extension.
    for (const shipped of ['extension.yml', 'commands/', 'scripts/', 'README.md']) {
      expect({ shipped, listed: patterns.includes(shipped) }).toEqual({
        shipped,
        listed: false,
      });
    }
  });
});
