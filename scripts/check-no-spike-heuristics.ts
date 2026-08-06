/**
 * T097 / FR-061 — **no spike-009 B/C/D comparison heuristic appears in the adapter** —
 * not as an inferred behaviour, not as an authoritative rule, not as a default, and not
 * as an opt-in.
 *
 * # What B, C and D actually are
 *
 * From spike 009's `contracts/comparison-heuristics.md` §1, read at its original location:
 *
 * | Option | What it is | Authoritative? |
 * |---|---|---|
 * | **A** (`adrkit.io/owned-paths`) | The sole candidate for default, authoritative entity-to-path binding | The only one measured as such (FR-002) |
 * | **B** (descriptor-parent) | Candidate paths = the descriptor file's own parent-directory glob | **Never** |
 * | **C** (repository-root) | Candidate paths = the entire repository (`**`) | **Never** |
 * | **D** (identity-only) | Canonical `kind:namespace/name` refs with no path binding at all | Not applicable |
 *
 * B and C were **measurement instruments**, labelled `non-authoritative` by their own
 * contract. `contracts/README.md` §2 excludes that contract from this feature outright:
 * *"This feature has no options to compare — ADR-0020 authorizes one design."*
 *
 * # Why the strongest check here is structural, not lexical
 *
 * A grep for the word "heuristic" would prove nothing: a heuristic implemented without
 * ever using the word is still a heuristic, and prose *describing* the prohibition is not
 * a violation of it. The two rules that actually bind are about **what the code can
 * express**:
 *
 * 1. `deriveOwnership` receives the annotation node and nothing else. It is handed no
 *    source path, no descriptor path, no checkout root — so a parent-directory glob (B)
 *    or a repository-root glob (C) is not something it could compute even if someone
 *    wanted it to. **Options B and C are inexpressible at the derivation boundary**, and
 *    that is a much stronger statement than their absence from a text scan.
 * 2. The `ownership/` module imports nothing that would give it access to those values.
 *
 * The lexical scan is retained as a second layer, for the case someone adds the parameter
 * — but it is the signature check that carries the claim.
 *
 * # And D
 *
 * Option D — identity with no path binding — is not forbidden as a *concept*; it is the
 * shape of an `annotation-absent` entity, which this feature emits deliberately. What is
 * forbidden is D **as a comparison option**: a labelled alternative, an opt-in mode, or a
 * report row. So the check targets the apparatus, not the shape.
 *
 * Run: `bun run check:no-spike-heuristics`
 *
 * @see `specs/009-catalog-binding-viability/contracts/comparison-heuristics.md` §1
 * @see `specs/010-catalog-backstage/contracts/README.md` §2 (Excluded)
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const REPO_ROOT = join(import.meta.dir, '..');

/** The two packages feature 010 adds. Both are in scope; nothing else is. */
export const SCANNED_PACKAGES: readonly string[] = [
  'packages/adapters/catalog-backstage',
  'packages/catalog-envelope',
];

/**
 * Files excluded from the lexical scan, because they contain the rule literals
 * themselves and would match their own patterns.
 *
 * The same documented relief valve as `test/source-scan.ts`'s `EXCLUDED_FROM_SCAN`
 * (`package-boundary.md` §4): a guard that must name what it forbids belongs here, and
 * adding an entry is preferred over renaming around the scanner. The list is asserted to
 * be exactly this set, so it cannot grow quietly.
 */
export const EXCLUDED_FROM_SCAN: readonly string[] = [];

export interface Rule {
  readonly id: string;
  readonly option: 'B' | 'C' | 'D' | 'apparatus';
  readonly pattern: RegExp;
  readonly why: string;
}

/**
 * Lexical rules, applied to comment-stripped source.
 *
 * Comments are stripped because this file's own prohibition is documented in prose
 * throughout both packages — a scanner that matched prose would fail on the
 * documentation of the rule it enforces, and the only fix would be to stop documenting
 * it.
 */
export const RULES: readonly Rule[] = [
  {
    id: 'option-bcd-identifier',
    option: 'apparatus',
    pattern: /\b(?:option[BCD]|OPTION_[BCD]|optionBCD)\b/u,
    why: 'spike 009 named the comparison options B/C/D; this feature compares nothing',
  },
  {
    id: 'non-authoritative-label',
    option: 'apparatus',
    pattern: /['"]non-authoritative['"]/u,
    why: 'the `non-authoritative` label exists only to mark a B/C heuristic report row',
  },
  {
    id: 'descriptor-parent-heuristic',
    option: 'B',
    pattern: /\b(?:descriptorParent|parentDirectoryGlob|parentDirGlob|descriptor_parent)\b/u,
    why: 'option B derives candidate paths from the descriptor file\u2019s parent directory',
  },
  {
    id: 'repository-root-heuristic',
    option: 'C',
    pattern: /\b(?:repositoryRootGlob|repoRootGlob|wholeRepositoryGlob|repository_root_glob)\b/u,
    why: 'option C derives candidate paths from the entire repository',
  },
  {
    id: 'identity-only-comparison-mode',
    option: 'D',
    pattern: /\b(?:identityOnlyMode|identityOnlyOption|identity_only_option)\b/u,
    why: 'option D as a comparison mode is apparatus; `annotation-absent` is not',
  },
  {
    id: 'heuristic-opt-in',
    option: 'apparatus',
    pattern: /\b(?:enableHeuristic|heuristicMode|useHeuristic|heuristics?\s*[:=]\s*(?:true|\{))/u,
    why: 'FR-061 forbids B/C/D even as an opt-in',
  },
];

export interface Violation {
  /** Repository-relative, forward-slashed. */
  readonly path: string;
  readonly ruleId: string;
  readonly option: Rule['option'];
  readonly matched: string;
  readonly why: string;
}

/**
 * Strip `//` and block comments, preserving string and template literal contents.
 *
 * Deliberately the same approach as `test/source-scan.ts`, and with the same accepted
 * limitation: a regular-expression literal containing an unescaped `//` can put the
 * stripper into the wrong state, and the failure direction is a false negative.
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

export interface ScannedFile {
  readonly path: string;
  readonly code: string;
}

/** Every `.ts` file under each scanned package's `src/` and `test/` trees. */
export function scanFiles(repoRoot: string = REPO_ROOT): ScannedFile[] {
  const files: ScannedFile[] = [];

  for (const packageDirectory of SCANNED_PACKAGES) {
    for (const subtree of ['src', 'test'] as const) {
      const base = join(repoRoot, packageDirectory, subtree);
      if (!existsSync(base)) continue;

      for (const entry of readdirSync(base, { recursive: true }).map(String)) {
        if (!entry.endsWith('.ts')) continue;
        const absolute = join(base, entry);
        const path = relative(repoRoot, absolute).split(sep).join('/');
        if (EXCLUDED_FROM_SCAN.includes(path)) continue;

        const raw = readFileSync(absolute, 'utf8');
        const code = stripComments(raw);
        if (raw.trim().length > 0 && code.trim().length === 0) {
          throw new Error(
            `${path}: comment stripping emptied a non-empty file, so this scan cannot see it. ` +
              'Refusing to report a result indistinguishable from a clean file.',
          );
        }
        files.push({ path, code });
      }
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Apply {@link RULES} to already-stripped source. */
export function lexicalViolations(files: readonly ScannedFile[]): Violation[] {
  const found: Violation[] = [];
  for (const file of files) {
    for (const rule of RULES) {
      const match = rule.pattern.exec(file.code);
      if (match) {
        found.push({
          path: file.path,
          ruleId: rule.id,
          option: rule.option,
          matched: match[0],
          why: rule.why,
        });
      }
    }
  }
  return found;
}

/**
 * The structural claim: options B and C are **inexpressible** at the derivation boundary.
 *
 * `deriveOwnership` is handed the annotation node and nothing else. Without a source
 * path, a descriptor path, or a checkout root, a parent-directory glob (B) and a
 * repository-root glob (C) are not values it can compute. This is the check that carries
 * FR-061; the lexical rules above are a second layer.
 */
export function structuralViolations(repoRoot: string = REPO_ROOT): Violation[] {
  const found: Violation[] = [];
  const ownershipDirectory = join(repoRoot, 'packages/adapters/catalog-backstage/src/ownership');

  if (!existsSync(ownershipDirectory)) {
    return [
      {
        path: 'packages/adapters/catalog-backstage/src/ownership',
        ruleId: 'ownership-module-missing',
        option: 'apparatus',
        matched: '(absent)',
        why: 'the module whose signature carries this claim does not exist',
      },
    ];
  }

  const derivePath = join(ownershipDirectory, 'derive.ts');
  const derive = stripComments(readFileSync(derivePath, 'utf8'));

  // The signature, as declared. A source path arriving here is how B or C would enter.
  const signature = /export function deriveOwnership\(([\s\S]*?)\)\s*:/u.exec(derive)?.[1] ?? '';
  for (const forbidden of ['sourcePath', 'descriptorPath', 'checkoutRoot', 'repositoryRoot', 'filePath']) {
    if (signature.includes(forbidden)) {
      found.push({
        path: 'packages/adapters/catalog-backstage/src/ownership/derive.ts',
        ruleId: 'derivation-receives-a-path',
        option: 'B',
        matched: forbidden,
        why:
          'deriveOwnership must receive the annotation and nothing else; a path parameter is ' +
          'what makes options B and C expressible at all',
      });
    }
  }

  // And the module must not reach for those values by another route.
  for (const entry of readdirSync(ownershipDirectory).filter((one) => one.endsWith('.ts'))) {
    const code = stripComments(readFileSync(join(ownershipDirectory, entry), 'utf8'));
    const path = `packages/adapters/catalog-backstage/src/ownership/${entry}`;

    if (/from\s+['"]node:path['"]/u.test(code)) {
      found.push({
        path,
        ruleId: 'ownership-imports-path',
        option: 'B',
        matched: 'node:path',
        why: 'the ownership module has no business computing directories; option B is exactly that',
      });
    }
    if (/from\s+['"]node:fs(?:\/promises)?['"]/u.test(code)) {
      found.push({
        path,
        ruleId: 'ownership-imports-fs',
        option: 'C',
        matched: 'node:fs',
        why: 'ownership derives from the annotation, never from what is on disk',
      });
    }
    // A bare `'**'` as a fallback is option C written out.
    if (/(?:\?\?|\|\||:|=)\s*\[\s*['"]\*\*['"]\s*\]/u.test(code)) {
      found.push({
        path,
        ruleId: 'repository-root-fallback',
        option: 'C',
        matched: "['**']",
        why: 'a `**` default is option C: candidate paths = the entire repository',
      });
    }
  }

  return found;
}

export function checkNoSpikeHeuristics(repoRoot: string = REPO_ROOT): Violation[] {
  return [...structuralViolations(repoRoot), ...lexicalViolations(scanFiles(repoRoot))];
}

function main(): number {
  const files = scanFiles();
  const violations = checkNoSpikeHeuristics();

  if (violations.length > 0) {
    console.error('check-no-spike-heuristics: FAIL — a spike-009 B/C/D comparison heuristic appears in scope.');
    for (const violation of violations) {
      console.error(`  ${violation.path}`);
      console.error(`    [option ${violation.option}] ${violation.ruleId}: matched ${JSON.stringify(violation.matched)}`);
      console.error(`    ${violation.why}`);
    }
    return 1;
  }

  // The file count is printed because a scan that read nothing reports the same green as
  // a scan that read everything — the defect `test/source-scan.ts` was built to avoid.
  console.log(`check-no-spike-heuristics: ok (${files.length} modules scanned across ${SCANNED_PACKAGES.length} packages)`);
  console.log('  option B (descriptor-parent): inexpressible — deriveOwnership receives no path');
  console.log('  option C (repository-root): inexpressible — no `**` fallback, no fs access in ownership/');
  console.log('  option D (identity-only) as a comparison mode: absent');
  return 0;
}

if (import.meta.main) process.exit(main());
