/**
 * The builder is pure (ADR-0054 clause 3): ADR-0055's server calls it per request, so it may
 * read no clock, file, environment, or network and spawn nothing. Asserted twice:
 *
 * - **statically**, over every module under `src/data/`: imports are relative siblings or a
 *   type-only import of `@adrkit/sdk`, and no forbidden global appears in code;
 * - **at run time**: `Date`, `Math.random`, `performance`, `fetch`, `setTimeout`, and every
 *   property of `process` are replaced with throwing stubs while the builder runs (it is
 *   synchronous, so nothing else runs meanwhile), and the build still succeeds.
 *
 * ADR-0016 clause 2: observed failing. With `const stamp = Date.now();` added inside
 * `buildPortalData`, both "no forbidden global appears" and "builds with the clock, process,
 * and network stubbed to throw" failed; with `import { readFileSync } from 'node:fs';` added
 * to `src/data/markdown.ts`, "imports only siblings and SDK types" failed. The retained input
 * is each line, removed.
 */

import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPathTable, buildPortalData, serializePortalData } from '../src/data/build.ts';
import { fakeHandle, fakeRecord } from './fake-handle.ts';

const DATA_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src', 'data');

/** Strip comments so the rules are about code, not prose describing them. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

async function dataModules(): Promise<Array<{ name: string; code: string }>> {
  const names = (await readdir(DATA_DIR)).filter((name) => name.endsWith('.ts')).sort();
  return Promise.all(names.map(async (name) => ({ name, code: codeOf(await readFile(join(DATA_DIR, name), 'utf8')) })));
}

const FORBIDDEN = [
  /(^|[^.\w])process\b/,
  /(^|[^.\w])Date\b/,
  /\bMath\.random\b/,
  /(^|[^.\w])performance\b/,
  /(^|[^.\w])fetch\s*\(/,
  /(^|[^.\w])(setTimeout|setInterval|setImmediate|queueMicrotask)\b/,
  /(^|[^.\w])Bun\b/,
  /(^|[^.\w])require\s*\(/,
  /(^|[^.\w])import\s*\(/,
  /(^|[^.\w])globalThis\b/,
  /(^|[^.\w])crypto\b/,
  /['"`]node:/,
];

describe('src/data is pure', () => {
  test('the scan covers the three data modules', async () => {
    expect((await dataModules()).map((module) => module.name)).toEqual(['build.ts', 'contract.ts', 'markdown.ts']);
  });

  test('imports only siblings and SDK types', async () => {
    for (const { name, code } of await dataModules()) {
      const imports = [...code.matchAll(/^\s*(import|export)\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm)];
      for (const [, , clause, specifier] of imports) {
        const allowed =
          /^\.\/[\w-]+\.ts$/.test(specifier!) || (specifier === '@adrkit/sdk/src/index.ts' && /^type\s/.test(clause!));
        expect({ name, specifier, allowed }).toEqual({ name, specifier, allowed: true });
      }
      expect({ name, bareImports: code.match(/^\s*import\s+['"][^'"]+['"]/gm) ?? [] }).toEqual({ name, bareImports: [] });
    }
  });

  test('contract.ts imports nothing, so the browser page can import its types alone', async () => {
    const contract = (await dataModules()).find((module) => module.name === 'contract.ts')!;
    expect(contract.code).not.toMatch(/^\s*import\b/m);
  });

  test('no forbidden global appears in code', async () => {
    for (const { name, code } of await dataModules()) {
      const hits = FORBIDDEN.filter((pattern) => pattern.test(code)).map(String);
      expect({ name, hits }).toEqual({ name, hits: [] });
    }
  });

  test('builds with the clock, process, and network stubbed to throw', () => {
    const handle = fakeHandle({
      records: [
        fakeRecord('0001', { body: '# T\n\n| a |\n|---|\n| [x](https://e.example) |\n\n- *i* `c`\n\n> q\n' }),
        fakeRecord('0002', { body: 'See [one](./0001-decision.md).' }),
      ],
    });
    const table = buildPathTable([
      { path: 'src/a.ts', governing: [{ id: '0001', title: 't', status: 'accepted', standing: 'governing', matchedBy: [{ kind: 'marker', line: 1 }] }], activeProposals: [], history: [], issues: [] },
    ]);
    const expected = serializePortalData(buildPortalData(handle, { dir: 'docs/adr', commit: null, asOf: '2026-07-05', pathTable: table }));

    const global = globalThis as Record<string, unknown>;
    const saved = new Map<string, unknown>();
    const thrower = (name: string) => {
      const fail = () => {
        throw new Error(`impure: ${name}`);
      };
      return new Proxy(fail, { get: fail, apply: fail, construct: fail });
    };
    // `Bun` itself is read-only; the static scan above covers it.
    const random = Math.random;
    let actual: string;
    try {
      for (const name of ['Date', 'performance', 'fetch', 'setTimeout', 'setInterval', 'queueMicrotask', 'process']) {
        saved.set(name, global[name]);
        global[name] = thrower(name);
      }
      Math.random = thrower('Math.random') as unknown as () => number;
      actual = serializePortalData(buildPortalData(handle, { dir: 'docs/adr', commit: null, asOf: '2026-07-05', pathTable: table }));
    } finally {
      for (const [name, value] of saved) global[name] = value;
      Math.random = random;
    }
    expect(actual).toBe(expected);
  });
});
