import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The MCP server stays read-only (ADR-0044, ADR-0051). It reads the corpus through
 * `@adrkit/core`, so it could reach a writing transition by importing it rather than
 * by running the CLI. Neither the transitions nor the CLI verbs that record a
 * person's act (`accept`, `approve`, `object`, `resolve`) may appear in its source.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const VERBS = ['accept', 'approve', 'object', 'resolve'] as const;
const TRANSITIONS = /\b(?:acceptAdrSource|approveAdrSource|objectAdrSource|resolveObjectionAdrSource)\b/;

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

function sources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.[cm]?[jt]s$/.test(path))
    .map((path) => join(SRC, path))
    .sort();
}

describe('writing verbs', () => {
  test('no source file imports a writing transition or names a ratifying or review verb', () => {
    const files = sources();
    expect(files.some((path) => path.endsWith('server.ts'))).toBe(true);
    const hits = files.filter((path) => {
      const text = readFileSync(path, 'utf8');
      return TRANSITIONS.test(text) || mentionsVerb(text);
    });
    expect(hits).toEqual([]);
  });

  test('the type-list filter runs in linear time (CodeQL js/redos)', () => {
    // `["null"` then many tab-separated `"null"`s with no closing bracket made the
    // first type-list filter backtrack exponentially: about 4x per two more items.
    const adversarial = `["null"${'\t"null"'.repeat(28)}`;
    const started = performance.now();
    expect(mentionsVerb(adversarial)).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });

  test('the patterns catch the forms a tool would use, and not ordinary code', () => {
    for (const plant of [
      "import { approveAdrSource } from '@adrkit/core';",
      "server.registerTool('adr_resolve', …)",
      "spawn(cli, ['object', id])",
      "spawn(process.execPath, [cli, 'approve', id])",
      "args.push('accept')",
      'execFile(`${cli} resolve`)',
    ]) {
      expect({ plant, caught: TRANSITIONS.test(plant) || mentionsVerb(plant) }).toEqual({ plant, caught: true });
    }
    for (const idiom of ["const root = resolve(dir, '.')", 'await Promise.resolve()', "type: 'object'", "z.object({})", "inputSchema: { type: 'object' }", "typeof x === 'object'"]) {
      expect({ idiom, caught: TRANSITIONS.test(idiom) || mentionsVerb(idiom) }).toEqual({ idiom, caught: false });
    }
  });
});
