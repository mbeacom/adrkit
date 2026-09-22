import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Shipped source must run on Node, not only on Bun.
 *
 * `@adrkit/cli` and `@adrkit/core` are built with `--target=node` and declare
 * `engines.node >= 22` (ADR-0010: Bun for development, **Node-targeted published
 * artifacts**). `bun build` does not shim the `Bun` global — it emits the reference
 * verbatim — so a `Bun.spawn` in shipped source is a `ReferenceError` in every published
 * install while every Bun-run test still passes.
 *
 * This was not hypothetical. `packages/cli/src/as-of.ts` shipped `Bun.spawn` behind a
 * `catch` that returned "missing", so under Node `adr explain --as-of HEAD` reported
 * "git is not installed or not on PATH" — a confident, wrong diagnosis — while the whole
 * suite stayed green. Test files are excluded: they only ever run under `bun test`.
 */
const SHIPPED_ROOTS = [
  resolve(process.cwd(), 'packages/cli/src'),
  resolve(process.cwd(), 'packages/core/src'),
  resolve(process.cwd(), 'packages/evaluator/src'),
];

/** Strip comments so the rule is about code, not about prose describing the rule. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

async function tsFilesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath ?? dir, entry.name));
}

describe('shipped source is Node-compatible', () => {
  test('no Bun global or "bun" import reaches a published artifact', async () => {
    const offenders: string[] = [];

    for (const root of SHIPPED_ROOTS) {
      for (const file of await tsFilesUnder(root)) {
        const code = codeOf(await readFile(file, 'utf8'));
        if (/(^|[^.\w])Bun\s*\./.test(code)) offenders.push(`${file}: Bun.* global`);
        if (/from\s+['"]bun['"]/.test(code)) offenders.push(`${file}: import from "bun"`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test('the rule is checking real files, not an empty glob', async () => {
    for (const root of SHIPPED_ROOTS) {
      expect((await tsFilesUnder(root)).length).toBeGreaterThan(0);
    }
  });
});
