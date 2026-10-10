/**
 * The portal's copies of the plugin's layout, view, and theme modules
 * (ADR-0054 clause 11).
 *
 * `scripts/emit-portal-vendor.ts` writes them and `clean-clone-builds` asserts
 * no diff afterwards (ADR-0040's MANIFEST mechanism). This file holds the
 * properties that a `git diff` cannot see:
 *
 * - The directory holds exactly the pinned set. A copy deleted and committed
 *   is recreated untracked by the emit step, which `git diff --exit-code`
 *   ignores; an extra file (a page module, the review writer) would never be
 *   in the emitted set at all.
 * - Each copy is the generated header followed by its source, byte for byte.
 * - No copy imports anything, statically, dynamically, or through `require`:
 *   the portal is a static page with no module graph behind these files.
 * - No copy names a ratifying or review verb as a command, by the same
 *   patterns `packages/mcp/test/writing-verbs.test.ts` uses.
 *
 * Observed failing (ADR-0016), 2026-10-10, macOS, Bun 1.4.2: one byte
 * appended to `src/vendor/board-view.mjs` failed "each copy is its header
 * followed by its source"; a fourth file (`board-page.mjs`) dropped into
 * `src/vendor/` failed "the vendor directory holds exactly the pinned set" and
 * "no plugin-only module is copied"; a planted `import './x.mjs';` line failed
 * "no copy imports anything"; a planted `spawn(cli, ['approve', id])` failed
 * "no copy names a ratifying or review verb". Each was restored and the file
 * passed again.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { header, SOURCE_DIR, VENDOR_DIR, VENDORED } from '../../../scripts/emit-portal-vendor.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const VENDOR = join(ROOT, VENDOR_DIR);
const SOURCE = join(ROOT, SOURCE_DIR);

/** The plugin modules the portal must never carry (ADR-0054 clause 11). */
const NEVER_COPIED = ['board-page.mjs', 'board.mjs', 'panel-http.mjs', 'board-review-write.mjs'];

const VERBS = ['accept', 'approve', 'object', 'resolve'] as const;
const TRANSITIONS = /\b(?:acceptAdrSource|approveAdrSource|objectAdrSource|resolveObjectionAdrSource)\b/;

/** `packages/mcp/test/writing-verbs.test.ts`'s `mentionsVerb`, unchanged. */
function mentionsVerb(text: string): boolean {
  const alt = VERBS.join('|');
  // A JSON-schema type list such as `['object', 'null']` is a type, not a call; drop
  // lists made only of type words before looking for a quoted verb.
  // Items are separated by a required comma, so the match cannot backtrack
  // exponentially (CodeQL js/redos).
  const type = `['"\`](?:null|string|array|number|boolean|integer|object)['"\`]`;
  const code = text.replace(new RegExp(`\\[\\s*${type}(?:\\s*,\\s*${type})*(?:\\s*,)?\\s*\\]`, 'g'), '');
  return [
    // The verb as a quoted array element or call argument: `['approve']`,
    // `[cli, 'approve', id]`, `args.push('approve')`, `` [`resolve`, id] ``.
    new RegExp(`[\\[,(]\\s*['"\`](?:${alt})['"\`]\\s*[,\\])]`),
    // The verb assigned to a name a template then interpolates: `const verb = 'approve'`.
    new RegExp(`(?<![=!<>])=\\s*['"\`](?:${alt})['"\`]`),
    // A tool named after the verb: `adr_approve`.
    new RegExp(`\\badr_(?:${alt})\\b`, 'i'),
    // A shell or template call: after `adr`, `$ADRKIT_CLI`, `@adrkit/cli`, or a
    // `${…}` placeholder, across whitespace and invisible characters, in any case.
    new RegExp(`(?:\\badr|ADRKIT_CLI\\}?"?|@adrkit\\/cli|\\$\\{[^}]*\\})[\\s\\p{Cf}]+(?:${alt})\\b`, 'iu'),
  ].some((pattern) => pattern.test(code));
}

/**
 * Any import: a static `import … from`, a bare `import '…'`, a re-export
 * `export … from`, a dynamic `import(…)`, `import.meta`, or `require(…)`.
 * A JSDoc type import (`@type {import('./x').T}`) counts too: it would make the
 * copy's typecheck depend on a module the portal does not hold.
 */
function importsSomething(text: string): boolean {
  return [
    /^\s*import\b/m,
    /^\s*export\s[^;]*\bfrom\s*['"`]/m,
    /\bimport\s*\(/,
    /\bimport\.meta\b/,
    /\brequire\s*\(/,
  ].some((pattern) => pattern.test(text));
}

const copies = () => VENDORED.map((name) => ({ name, text: readFileSync(join(VENDOR, name), 'utf8') }));

describe('the portal vendor copies (ADR-0054 clause 11)', () => {
  test('the pinned set is exactly the layout, view, and theme modules', () => {
    expect([...VENDORED]).toEqual(['board-layout.mjs', 'board-view.mjs', 'canvas-theme.mjs']);
  });

  test('the vendor directory holds exactly the pinned set', () => {
    expect(readdirSync(VENDOR).sort()).toEqual([...VENDORED].sort());
  });

  test('no plugin-only module is copied', () => {
    const present = readdirSync(VENDOR);
    for (const name of NEVER_COPIED) {
      // The plugin still has each one, so this is not vacuous.
      expect(readdirSync(SOURCE)).toContain(name);
      expect({ name, copied: present.includes(name) }).toEqual({ name, copied: false });
    }
  });

  test('each copy is its header followed by its source, byte for byte', () => {
    for (const name of VENDORED) {
      const source = readFileSync(join(SOURCE, name));
      const copy = readFileSync(join(VENDOR, name));
      const head = Buffer.from(header(name), 'utf8');
      expect({ name, header: copy.subarray(0, head.length).toString('utf8') }).toEqual({ name, header: header(name) });
      expect({ name, bodyMatchesSource: copy.subarray(head.length).equals(source) }).toEqual({ name, bodyMatchesSource: true });
    }
  });

  test('each header names its source and says it is generated', () => {
    for (const name of VENDORED) {
      expect(header(name)).toContain(`${SOURCE_DIR}/${name}`);
      expect(header(name)).toContain('generated by bun run emit:portal-vendor; do not edit');
    }
  });

  test('no copy imports anything', () => {
    const hits = copies().filter(({ text }) => importsSomething(text)).map(({ name }) => name);
    expect(hits).toEqual([]);
  });

  test('no copy names a ratifying or review verb as a command', () => {
    const hits = copies()
      .filter(({ text }) => TRANSITIONS.test(text) || mentionsVerb(text))
      .map(({ name }) => name);
    expect(hits).toEqual([]);
  });

  test('the import and verb patterns catch planted forms, and not ordinary code', () => {
    for (const plant of [
      "import { layout } from './board-layout.mjs';",
      "import './side-effect.mjs';",
      "export { x } from './x.mjs';",
      "const m = await import('./x.mjs');",
      "const fs = require('node:fs');",
      '/** @type {import("./x").T} */',
      'const here = import.meta.url;',
    ]) {
      expect({ plant, caught: importsSomething(plant) }).toEqual({ plant, caught: true });
    }
    for (const plant of [
      "import { approveAdrSource } from '@adrkit/core';",
      "spawn(cli, ['approve', id])",
      "args.push('accept')",
      'execFile(`${cli} resolve`)',
      'run `adr object 0042`',
    ]) {
      expect({ plant, caught: TRANSITIONS.test(plant) || mentionsVerb(plant) }).toEqual({ plant, caught: true });
    }
    for (const idiom of ['export function fitView(graph) {}', "typeof x === 'object'", 'await Promise.resolve()', '// the importance of layout']) {
      expect({ idiom, caught: importsSomething(idiom) || TRANSITIONS.test(idiom) || mentionsVerb(idiom) }).toEqual({ idiom, caught: false });
    }
  });
});
