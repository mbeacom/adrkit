/**
 * T006 / FR-002 — the adapter is reachable only by explicit static import, and
 * registers no dynamic loader, plugin registry, or discovery hook.
 *
 * ADR-0013 and `spec.md` FR-002 forbid "no dynamic runtime adapter/plugin loader
 * of any kind, and no separate composition host that discovers, resolves, or
 * dynamically imports a catalog adapter at runtime — not even one restricted to
 * a single statically-known package name."
 *
 * Two halves, because either alone is weak:
 *
 * - **Positive.** A static import of the entry point yields a specific observed
 *   value. This is what proves reachability, rather than inferring it from the
 *   absence of a loader (ADR-0016 clause 3).
 * - **Negative.** Every rule below is driven against a fixture that must trip
 *   it. A rule nobody has watched reject anything is an untested function that
 *   happens to live in a test file (ADR-0016 clause 1).
 */

import { describe, expect, test } from 'bun:test';
import {
  ADAPTER_ROOT,
  EXCLUDED_FROM_SCAN,
  type Rule,
  scanned,
  violations,
  violationsInSource,
} from './source-scan.ts';

// The import under test. Static, by name, written here in source — which is the
// only way this package is reachable.
import * as adapter from '../src/index.ts';

/**
 * Constructs that would let a module be resolved at runtime, or let this package
 * announce itself to something that resolves modules at runtime.
 */
const LOADER_RULES: readonly Rule[] = [
  {
    id: 'dynamic-import',
    pattern: /\bimport\s*\(/,
    why: 'a dynamic import() expression resolves a module path at runtime',
  },
  {
    id: 'require',
    pattern: /\brequire\s*\(/,
    why: 'require() resolves a module path at runtime',
  },
  {
    id: 'create-require',
    pattern: /\bcreateRequire\b/,
    why: 'createRequire() constructs a runtime module resolver',
  },
  {
    id: 'require-resolve',
    pattern: /\brequire\s*\.\s*resolve\b/,
    why: 'require.resolve() performs runtime module resolution',
  },
  {
    id: 'import-meta-resolve',
    pattern: /\bimport\s*\.\s*meta\s*\.\s*resolve\b/,
    why: 'import.meta.resolve() performs runtime module resolution',
  },
  {
    id: 'module-internal-load',
    pattern: /\b_load\b/,
    why: "Module._load is the CommonJS loader's internal resolution entry point",
  },
  {
    id: 'registry-or-discovery',
    pattern:
      /\b(?:registerAdapter|registerPlugin|adapterRegistry|pluginRegistry|loadAdapter|resolveAdapter|discoverAdapter|discoverAdapters|adapterFor)\b/,
    why: 'an adapter/plugin registry or discovery hook, which FR-002 forbids even for a single statically-known name',
  },
];

/** Export names that would mean this package participates in discovery. */
const FORBIDDEN_EXPORT_NAME =
  /^(?:register|discover|load|resolve).*(?:Adapter|Plugin|Registry)$|Registry$/;

describe('FR-002 — reachable only by explicit static import', () => {
  test('the entry point yields a specific observed value when imported statically', () => {
    // Asserting a value rather than an absence: this is positive evidence that
    // the module resolved, which "no loader was found" would not be.
    expect(adapter.PACKAGE_NAME).toBe('@adrkit/catalog-backstage');
  });

  test('the public surface names no registration, discovery, or registry hook', () => {
    const exported = Object.keys(adapter).sort();

    // State what was examined. A future phase adding exports keeps this honest;
    // an empty surface would be reported here rather than passing quietly.
    expect(exported.length).toBeGreaterThan(0);
    expect(exported.filter((name) => FORBIDDEN_EXPORT_NAME.test(name))).toEqual([]);
  });
});

describe('FR-002 — no dynamic loader anywhere in the adapter source', () => {
  const files = scanned(ADAPTER_ROOT);

  test('examined the adapter source tree, and says which files', () => {
    // The anti-blindness assertion. Without it, a scan of zero files reports the
    // same clean result as a scan of a clean tree (ADR-0016).
    expect(files.map((file) => file.path)).toContain(
      'packages/adapters/catalog-backstage/src/index.ts',
    );
    expect(files.length).toBeGreaterThan(0);
  });

  test('the excluded-from-scan set is exactly the five self-referential guard files', () => {
    // These files contain the rule literals themselves. The exclusion is pinned
    // so it cannot grow into a way of hiding a violation: adding an entry fails
    // this test until someone updates it deliberately, which is the point.
    //
    // The two consumer entries were added on 2026-08-05. Each must name the very
    // thing it forbids — the schema file it pins by hash, and the adapter package
    // it proves is never imported — so both were unscannable without an entry
    // here. The alternative two sessions reached for first was renaming around
    // the scanner, which leaves the trap armed for the next writer.
    expect([...EXCLUDED_FROM_SCAN]).toEqual([
      'packages/adapters/catalog-backstage/test/envelope-shape-locality.test.ts',
      'packages/adapters/catalog-backstage/test/no-dynamic-loader.test.ts',
      'packages/adapters/catalog-backstage/test/source-scan.ts',
      'packages/catalog-envelope/test/no-core-schema-change.test.ts',
      'packages/catalog-envelope/test/no-adapter-import.test.ts',
    ]);
  });

  test('no scanned file uses a runtime module resolver or a discovery hook', () => {
    expect(violations(files, LOADER_RULES)).toEqual([]);
  });
});

describe('FR-002 — the rules above, observed rejecting (permanent negative cases)', () => {
  const REJECTED: readonly { readonly ruleId: string; readonly source: string }[] = [
    { ruleId: 'dynamic-import', source: 'const mod = await import(name);' },
    { ruleId: 'require', source: 'const mod = require("@adrkit/whatever");' },
    { ruleId: 'create-require', source: 'import { createRequire } from "node:module";' },
    { ruleId: 'require-resolve', source: 'const where = require.resolve("pkg");' },
    { ruleId: 'import-meta-resolve', source: 'const url = import.meta.resolve("pkg");' },
    { ruleId: 'module-internal-load', source: 'const m = Module._load("pkg", null, false);' },
    { ruleId: 'registry-or-discovery', source: 'export function registerAdapter(a: unknown) {}' },
    { ruleId: 'registry-or-discovery', source: 'export const adapterRegistry = new Map();' },
    {
      ruleId: 'registry-or-discovery',
      // FR-002's explicit edge: a loader restricted to one known name is still a loader.
      source: 'export function loadAdapter() { return "@adrkit/catalog-backstage"; }',
    },
  ];

  for (const { ruleId, source } of REJECTED) {
    test(`${ruleId} fires on: ${source}`, () => {
      const found = violationsInSource('fixture.ts', source, LOADER_RULES);
      expect(found.map((violation) => violation.ruleId)).toContain(ruleId);
    });
  }

  test('every rule has been observed firing at least once', () => {
    // Closes the gap where a rule is added but never exercised, which would make
    // it look like coverage while rejecting nothing.
    const exercised = new Set(
      REJECTED.flatMap(({ source }) =>
        violationsInSource('fixture.ts', source, LOADER_RULES).map((violation) => violation.ruleId),
      ),
    );
    expect([...exercised].sort()).toEqual(LOADER_RULES.map((rule) => rule.id).sort());
  });

  test('a forbidden export name is rejected, and an ordinary one is not', () => {
    expect(['registerAdapter', 'adapterRegistry', 'discoverPlugin'].filter((name) =>
      FORBIDDEN_EXPORT_NAME.test(name),
    )).toEqual(['registerAdapter', 'adapterRegistry', 'discoverPlugin']);
    expect(['PACKAGE_NAME', 'generate', 'validateManifest'].filter((name) =>
      FORBIDDEN_EXPORT_NAME.test(name),
    )).toEqual([]);
  });

  test('the same construct written inside a comment is not reported', () => {
    // The positive control for comment stripping. Without it the rules would
    // fail on this package's own documentation, and the cheapest repair would be
    // to stop documenting what is forbidden.
    const commented = ['// never write require("x") here', '/* nor await import(x) */', 'const a = 1;'].join(
      '\n',
    );
    expect(violationsInSource('fixture.ts', commented, LOADER_RULES)).toEqual([]);
  });
});
