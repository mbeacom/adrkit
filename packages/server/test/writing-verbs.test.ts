import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ADR-0055 clause 2, second half: the server stays read-only (ADR-0044, ADR-0051, ADR-0052).
 * The patterns are `packages/mcp/test/writing-verbs.test.ts`'s, applied to
 * `packages/server/src`: neither a writing transition nor a CLI verb that records a person's
 * act (`accept`, `approve`, `object`, `resolve`) may appear in its source.
 *
 * ADR-0016 clause 2: observed failing with `[].push('approve');` added to the getHealth
 * handler in src/server.ts. The retained input is that form, among the plants below.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const VERBS = ['accept', 'approve', 'object', 'resolve'] as const;
const TRANSITIONS = /\b(?:acceptAdrSource|approveAdrSource|objectAdrSource|resolveObjectionAdrSource)\b/;

function mentionsVerb(text: string): boolean {
  const alt = VERBS.join('|');
  const type = `['"\`](?:null|string|array|number|boolean|integer|object)['"\`]`;
  const code = text.replace(new RegExp(`\\[\\s*${type}(?:\\s*,\\s*${type})*(?:\\s*,)?\\s*\\]`, 'g'), '');
  return [
    new RegExp(`[\\[,(]\\s*['"\`](?:${alt})['"\`]\\s*[,\\])]`),
    new RegExp(`(?<![=!<>])=\\s*['"\`](?:${alt})['"\`]`),
    new RegExp(`\\badr_(?:${alt})\\b`, 'i'),
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

  test('no source file imports @adrkit/core or @adrkit/cli, or spawns a process', () => {
    const hits = sources().filter((path) =>
      /from\s+['"]@adrkit\/(?:core|cli)|node:child_process|['"]child_process['"]|(?<![.\w])(?:spawn|exec|execFile)(?:Sync)?\(/.test(
        readFileSync(path, 'utf8'),
      ),
    );
    expect(hits).toEqual([]);
  });

  test('the patterns catch the forms a route would use', () => {
    for (const plant of [
      "import { approveAdrSource } from '@adrkit/core';",
      "import { acceptAdrSource } from '@adrkit/core';",
      "args.push('approve')",
      "spawn(cli, ['object', id])",
      'execFile(`${cli} resolve`)',
    ]) {
      expect({ plant, caught: TRANSITIONS.test(plant) || mentionsVerb(plant) }).toEqual({ plant, caught: true });
    }
    for (const idiom of ["schema: { type: 'object' }", 'await Promise.resolve()', "const root = resolve(dir, '.')"]) {
      expect({ idiom, caught: TRANSITIONS.test(idiom) || mentionsVerb(idiom) }).toEqual({ idiom, caught: false });
    }
  });
});
