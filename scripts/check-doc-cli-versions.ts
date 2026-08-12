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
 * Only executable pins are guarded — an `npx`/`bunx` invocation a reader copies
 * and runs. Prose that legitimately names an older release ("if you were on
 * `@adrkit/cli@0.5.0`…") is not a recipe and must not fail the build.
 *
 * The version token is captured whole, suffix included. Matching only
 * `\d+\.\d+\.\d+` would match the `0.6.0` inside `0.6.0-rc.1` and pass; anchoring
 * that pattern instead makes the token stop matching at all, which also passes.
 * Both were observed before this shape was chosen.
 */
export const CLI_PIN_PATTERN = /(?:npx|bunx)\s+@adrkit\/cli@([^\s`'"]+)/g;

export interface DocFile {
  /** Repo-relative path, used only for reporting. */
  path: string;
  text: string;
}

export interface StalePin {
  path: string;
  found: string;
  expected: string;
}

/** Pure: every executable pin in `files` that is not exactly `expected`. */
export function findStalePins(files: readonly DocFile[], expected: string): StalePin[] {
  const stale: StalePin[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(CLI_PIN_PATTERN)) {
      if (match[1] !== expected) {
        stale.push({ path: file.path, found: match[1] as string, expected });
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
    const lines = stale.map((s) => `${s.path}: found @adrkit/cli@${s.found}, expected ${s.expected}`);
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
