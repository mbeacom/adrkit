/**
 * Source-scanning helpers shared by this package's two Phase A boundary guards.
 *
 * Both guards have the shape ADR-0016 warns about: they conclude something from
 * an *absence*. A scan that silently examined zero files, or that examined only
 * comments, would report exactly the same green as a scan that looked properly.
 * Three things are done about that, and they are the reason this file exists
 * rather than two ad-hoc regexes:
 *
 * 1. Every scan returns the list of files it read, and the guards assert on that
 *    list by name. "Looked and found nothing" is then distinguishable from
 *    "could not look".
 * 2. Every rule below is driven against a fixture that must trip it, so no rule
 *    is trusted until it has been observed firing.
 * 3. The files excluded from scanning are a named, asserted constant rather than
 *    a filter buried in a call site, so the exclusion set cannot grow quietly.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const HERE = import.meta.dir;

/** `packages/adapters/catalog-backstage/` */
export const ADAPTER_ROOT = dirname(HERE);
/** The repository root: up out of `catalog-backstage/`, `adapters/`, `packages/`. */
export const REPO_ROOT = dirname(dirname(dirname(ADAPTER_ROOT)));
/** `packages/catalog-envelope/` */
export const CONSUMER_ROOT = join(REPO_ROOT, 'packages', 'catalog-envelope');

export const ADAPTER_PACKAGE_NAME = '@adrkit/catalog-backstage';
export const CONSUMER_PACKAGE_NAME = '@adrkit/catalog-envelope';

/**
 * Files deliberately not scanned, because they contain the rule literals
 * themselves and would match their own patterns.
 *
 * This is asserted to be exactly this set. An exclusion list that can grow
 * without anyone noticing is the same defect the scans are guarding against.
 *
 * **A guard that must name what it forbids belongs here.** The scans are
 * deliberately literal — `importSpecifiers` matches `from '…'` and
 * `import '…'` textually rather than resolving them — so a file that *states*
 * a rule is indistinguishable to it from a file that *breaks* one. Feature 010
 * hit this three times: the consumer's two boundary guards (which must name
 * `schema/adr.schema.json` to hash it, and `@adrkit/catalog-backstage` to
 * forbid importing it), and, more surprisingly, ordinary prose and string data
 * — the literal `'bulk-import'`, which is ADR-0015's own plugin name, scanned
 * as a side-effecting `import '…'`.
 *
 * Adding an entry is the correct fix and is preferred over renaming around
 * the scanner, which is what two sessions did before this list was extended.
 * Renaming leaves the trap armed for the next writer; listing the file is
 * visible, reviewable, and asserted. Do **not** loosen the patterns to make a
 * false positive go away — a scan that misses a real edge is worse than one
 * that occasionally over-matches, and this list is the intended relief valve.
 *
 * @see specs/010-catalog-backstage/contracts/package-boundary.md §4
 */
export const EXCLUDED_FROM_SCAN: readonly string[] = [
  'packages/adapters/catalog-backstage/test/envelope-shape-locality.test.ts',
  'packages/adapters/catalog-backstage/test/no-dynamic-loader.test.ts',
  'packages/adapters/catalog-backstage/test/source-scan.ts',
  // Consumer-side boundary guards. Each must name the very thing it forbids:
  // the schema file it pins by hash, and the adapter package it proves is
  // never imported. See package-boundary.md §4.
  'packages/catalog-envelope/test/no-core-schema-change.test.ts',
  'packages/catalog-envelope/test/no-adapter-import.test.ts',
];

export interface ScannedFile {
  /** Repository-relative path, forward-slashed, stable across platforms. */
  readonly path: string;
  /** File contents with comments removed; see {@link stripComments}. */
  readonly code: string;
}

function displayPath(path: string): string {
  return path.split(sep).join('/');
}

/**
 * Remove `//` and block comments, preserving newlines and the contents of
 * string and template literals.
 *
 * Why strip at all: these guards forbid *constructs*, not *words*. Both READMEs
 * and several doc comments in this package describe the forbidden constructs in
 * prose — a scanner that matched prose would fail on its own documentation, and
 * the fix for that would be to stop documenting the rule.
 *
 * Known limitation, stated rather than hidden: a regular-expression literal
 * containing an unescaped `//`, or a lone quote character inside one, can put
 * this scanner into the wrong state for the rest of that construct. The failure
 * direction is a false negative. It is accepted because the alternative is a
 * parser, and because {@link scanned} additionally asserts stripping never
 * empties a non-empty file.
 */
export function stripComments(source: string): string {
  let out = '';
  let index = 0;

  while (index < source.length) {
    const character = source[index] as string;
    const lookahead = source[index + 1];

    if (character === '/' && lookahead === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    if (character === '/' && lookahead === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') out += '\n';
        index += 1;
      }
      index += 2;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      out += character;
      index += 1;
      while (index < source.length) {
        const inner = source[index] as string;
        out += inner;
        index += 1;
        if (inner === '\\') {
          if (index < source.length) {
            out += source[index] as string;
            index += 1;
          }
          continue;
        }
        if (inner === character) break;
      }
      continue;
    }

    out += character;
    index += 1;
  }

  return out;
}

/**
 * Read every `.ts` file under the given package's `src/` and `test/` trees.
 *
 * Returns them sorted by path so the guards' reported file lists are
 * deterministic. `node_modules/` is out of range by construction: only `src/`
 * and `test/` are walked.
 */
export function scanned(packageRoot: string): ScannedFile[] {
  const files: ScannedFile[] = [];

  for (const subtree of ['src', 'test'] as const) {
    const base = join(packageRoot, subtree);
    let entries: string[];
    try {
      entries = readdirSync(base, { recursive: true }).map(String);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.ts')) continue;
      const absolute = join(base, entry);
      const path = displayPath(relative(REPO_ROOT, absolute));
      if (EXCLUDED_FROM_SCAN.includes(path)) continue;

      const raw = readFileSync(absolute, 'utf8');
      const code = stripComments(raw);
      if (raw.trim().length > 0 && code.trim().length === 0) {
        throw new Error(
          `${path}: comment stripping emptied a non-empty file, so this scan cannot see it. ` +
            'Refusing to report a result that would be indistinguishable from a clean file.',
        );
      }
      files.push({ path, code });
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
  /** Why the construct is forbidden, carried into the violation for the reader. */
  readonly why: string;
}

export interface Violation {
  readonly path: string;
  readonly ruleId: string;
  readonly matched: string;
  readonly why: string;
}

/** Apply `rules` to already-stripped source, returning every match. */
export function violations(files: readonly ScannedFile[], rules: readonly Rule[]): Violation[] {
  const found: Violation[] = [];
  for (const file of files) {
    for (const rule of rules) {
      const match = rule.pattern.exec(file.code);
      if (match) {
        found.push({ path: file.path, ruleId: rule.id, matched: match[0], why: rule.why });
      }
    }
  }
  return found;
}

/** Apply `rules` to one fixture string, as {@link violations} would see it. */
export function violationsInSource(path: string, source: string, rules: readonly Rule[]): Violation[] {
  return violations([{ path, code: stripComments(source) }], rules);
}

/**
 * Every module specifier imported or re-exported by `code`.
 *
 * Matched on comment-stripped source. Covers `from '…'` (import and re-export,
 * including multi-line forms) and side-effecting `import '…'`.
 */
export function importSpecifiers(code: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g]) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

/**
 * Relative import specifiers that resolve outside `packageRoot`.
 *
 * A package-name rule alone does not close the boundary: `../../catalog-envelope/src/…`
 * reaches the other package without ever naming it.
 */
export function escapingRelativeImports(
  file: ScannedFile,
  packageRoot: string,
): { readonly specifier: string; readonly resolved: string }[] {
  const fileDirectory = dirname(join(REPO_ROOT, file.path));
  const escaping: { specifier: string; resolved: string }[] = [];

  for (const specifier of importSpecifiers(file.code)) {
    if (!specifier.startsWith('.')) continue;
    const target = resolve(fileDirectory, specifier);
    const inside = relative(packageRoot, target);
    if (inside.startsWith('..') || inside === '') {
      escaping.push({ specifier, resolved: displayPath(relative(REPO_ROOT, target)) });
    }
  }

  return escaping;
}

/** The `scripts` block of a package manifest, as declared. */
export function packageScripts(packageRoot: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}
