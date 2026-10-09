import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from './manifest-fixture.ts';

/**
 * The extension never ratifies or reviews. `adr accept` (ADR-0044) and the review
 * commands `adr approve`, `adr object`, and `adr resolve` (ADR-0051) record a named
 * person's act, so no command, script, or hook here may run them, and any mention
 * counts, because a host model reads an example as an instruction. The patterns
 * match the argument-array, tool-name, and shell forms as well as prose, the same
 * as the agent plugin's guard, plus `adrkit_cli`, the wrapper every script here
 * calls the CLI through.
 */
const VERBS = ['accept', 'approve', 'object', 'resolve'] as const;

function mentionsVerb(text: string): boolean {
  const alt = VERBS.join('|');
  // A JSON-schema type list such as `['object', 'null']` is a type, not a call; drop
  // lists made only of type words before looking for a quoted verb.
  const code = text.replace(/\[\s*(?:['"`](?:null|string|array|number|boolean|integer|object)['"`]\s*,?\s*)+\]/g, '');
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
    new RegExp(`(?:\\badr|\\badrkit_cli|ADRKIT_CLI\\}?"?|@adrkit\\/cli|\\$\\{[^}]*\\})[\\s\\p{Cf}]+(?:${alt})\\b`, 'iu'),
  ].some((pattern) => pattern.test(code));
}

function shipped(): string[] {
  return [
    join(packageRoot, 'extension.yml'),
    ...readdirSync(join(packageRoot, 'commands')).map((file) => join(packageRoot, 'commands', file)),
    ...readdirSync(join(packageRoot, 'scripts')).map((file) => join(packageRoot, 'scripts', file)),
  ];
}

describe('writing verbs', () => {
  test('no command, script, or manifest names adr accept, approve, object, or resolve', () => {
    const files = shipped();
    expect(files.some((path) => path.endsWith('check.sh'))).toBe(true);
    expect(files.filter((path) => mentionsVerb(readFileSync(path, 'utf8')))).toEqual([]);
  });

  test('the patterns catch the shell and prose forms a script would use', () => {
    for (const plant of ['adrkit_cli approve "$id" --by "$me"', 'adr resolve 0007', '"$ADRKIT_CLI" object 7', 'npx @adrkit/cli accept 7', 'adr Accept 7', 'verb=\'approve\'', 'cmd="${ADRKIT_BIN} object"']) {
      expect({ plant, caught: mentionsVerb(plant) }).toEqual({ plant, caught: true });
    }
    expect(mentionsVerb('adrkit_cli check "$@" --dir "$adrkit_corpus" --json')).toBe(false);
  });
});
