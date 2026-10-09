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
  return [
    new RegExp(`\\[\\s*['"\`](?:${alt})['"\`]\\s*,(?!\\s*['"\`](?:null|string|array|number|boolean|integer|object)['"\`])`),
    new RegExp(`\\badr_(?:${alt})\\b`, 'i'),
    new RegExp(`(?:\\badr|ADRKIT_CLI\\}?"?|@adrkit\\/cli)[\\s\\p{Cf}]+(?:${alt})\\b`, 'iu'),
  ].some((pattern) => pattern.test(text));
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

  test('the patterns catch the forms a tool would use, and not ordinary code', () => {
    for (const plant of ["import { approveAdrSource } from '@adrkit/core';", "server.registerTool('adr_resolve', …)", "spawn(cli, ['object', id])"]) {
      expect({ plant, caught: TRANSITIONS.test(plant) || mentionsVerb(plant) }).toEqual({ plant, caught: true });
    }
    for (const idiom of ["const root = resolve(dir, '.')", 'await Promise.resolve()', "type: 'object'"]) {
      expect({ idiom, caught: TRANSITIONS.test(idiom) || mentionsVerb(idiom) }).toEqual({ idiom, caught: false });
    }
  });
});
