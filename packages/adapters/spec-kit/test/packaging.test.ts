import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from './manifest-fixture.ts';

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

  test('stays private while the publish decision is open', () => {
    // ADR-0019 action item 4. `private` makes the undecided state enforced by
    // npm rather than merely intended, and matches the documented install path
    // (`specify extension add --dev`, straight from the repository).
    expect(packageJson['private']).toBe(true);
    expect(packageJson['publishConfig']).toBeUndefined();
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
    ]) {
      expect({ required, present: existsSync(join(packageRoot, required)) }).toEqual({
        required,
        present: true,
      });
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
