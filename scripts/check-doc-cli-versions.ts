/**
 * Fail when a published doc pins an `@adrkit/cli` version that is not the
 * current release.
 *
 * `site/src/content/docs/badges.mdx` tells adopters to pin the CLI inside a
 * workflow holding `contents: write` (ADR-0025), so the pin cannot be relaxed to
 * a floating range without giving up the reason it is pinned. A pinned literal
 * in a doc is exactly the value that goes stale silently at the next release,
 * so it is guarded rather than left to review.
 *
 * This lives with the other repository guards rather than in the site build on
 * purpose. It compares the root `package.json` against site content, so it is a
 * repo-wide concern; and a stale pin is a content defect that should block a
 * merge, not block publishing the canonical schema at its `$id` (ADR-0011).
 * `clean-clone-builds` is a required check, so a stale pin cannot reach `main`.
 *
 *   bun run scripts/check-doc-cli-versions.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const docsDir = join(repoRoot, 'site', 'src', 'content', 'docs');

/**
 * Source for the pin matcher. A fresh `RegExp` is built per scan rather than
 * sharing one module-level instance: `matchAll` seeds its internal matcher from
 * the source regex's `lastIndex`, so a shared global regex that any caller had
 * poked with `.exec()`/`.test()` would silently start mid-string and skip pins.
 *
 * Only *executable* pins are guarded — an `npx`/`bunx` invocation a reader
 * copies and runs, with any flags (`-y`, `--yes`) tolerated between the runner
 * and the package. Prose that merely names an older release is not a recipe and
 * must not fail a required check.
 */
const CLI_PIN_SOURCE = String.raw`(?:npx|bunx)(?:\s+-{1,2}[A-Za-z][\w-]*)*\s+@adrkit/cli@([^\s\`'"]+)`;

/** Punctuation a version can never end in, but prose routinely appends. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>]+$/;

/** A fresh matcher. Never share one — see {@link CLI_PIN_SOURCE}. */
export function cliPinPattern(): RegExp {
  return new RegExp(CLI_PIN_SOURCE, 'g');
}

export interface DocFile {
  /** Repo-relative path, used only for reporting. */
  path: string;
  text: string;
}

export interface StalePin {
  path: string;
  /** The version as written, before punctuation was trimmed. */
  raw: string;
  found: string;
  expected: string;
}

/**
 * Pure: every executable pin in `files` whose version is not exactly `expected`.
 *
 * A sentence-ending `.` or a closing `)` is trimmed before comparison. Leaving
 * it attached made `npx @adrkit/cli@0.6.0.` compare unequal to `0.6.0` and fail
 * a required check — a false positive that blocks every merge in the repository,
 * which is a far worse failure than the stale pin this guard exists to catch.
 */
export function findStalePins(files: readonly DocFile[], expected: string): StalePin[] {
  const stale: StalePin[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(cliPinPattern())) {
      const raw = match[1] as string;
      const found = raw.replace(TRAILING_PUNCTUATION, '');
      if (found !== expected) {
        stale.push({ path: file.path, raw, found, expected });
      }
    }
  }
  return stale;
}

/** Recursive: a doc nested under a subdirectory is still a published doc. */
function collectDocs(dir: string): DocFile[] {
  const out: DocFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectDocs(full));
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      out.push({ path: relative(repoRoot, full), text: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

function main(): void {
  const expected = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version as string;
  const stale = findStalePins(collectDocs(docsDir), expected);

  if (stale.length > 0) {
    const lines = stale.map((s) => `${s.path}: found @adrkit/cli@${s.raw}, expected ${s.expected}`);
    throw new Error(
      `Stale @adrkit/cli pin in docs (current release is ${expected}):\n  ${lines.join('\n  ')}\n` +
        `Update the pinned version so published recipes do not install an old CLI.`,
    );
  }
  console.log(`check-doc-cli-versions: ok — every published @adrkit/cli pin is ${expected}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(
      `check-doc-cli-versions: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
