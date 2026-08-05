/**
 * T007 / FR-005 (locality half) — neither new package writes to or regenerates
 * `schema/`, and the envelope shape each package needs is declared locally
 * rather than in a shared schema module.
 *
 * This guard covers **both** packages of feature 010, from here, because the
 * property it protects is a property of the pair rather than of either one.
 *
 * `package-boundary.md` §5 is the reason it matters. Both packages declare the
 * envelope's shape independently, and that is the single deliberate duplication
 * in the design: a shared type module would be an import edge, and if both sides
 * derived their view of the envelope from one declaration, a generator that
 * changed the shape would change it on both sides at once and the consumer's
 * structural validation would be a tautology rather than a check.
 *
 * How the "declared locally" half is enforced, stated plainly because it is not
 * obvious: **not** by counting shape declarations. At the time this guard was
 * written neither package declares one, so a count would pass vacuously — and a
 * check that has only ever passed vacuously is exactly what ADR-0016 says is not
 * coverage. It is enforced instead by three rules that hold now and keep holding
 * as the shapes land: no import edge between the two packages, no relative
 * import escaping either package root, and no import of any module the package
 * has not declared as a dependency. A shape can only arrive from a shared module
 * by tripping one of those three.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADAPTER_PACKAGE_NAME,
  ADAPTER_ROOT,
  CONSUMER_PACKAGE_NAME,
  CONSUMER_ROOT,
  escapingRelativeImports,
  importSpecifiers,
  packageScripts,
  type Rule,
  type ScannedFile,
  scanned,
  violations,
  violationsInSource,
} from './source-scan.ts';

/**
 * References to the published schema surface. A package that never names it
 * cannot write it or regenerate it, which is a stronger and far more robust
 * assertion than trying to enumerate the ways a file could be written.
 */
const SCHEMA_RULES: readonly Rule[] = [
  {
    id: 'published-schema-file',
    pattern: /schema\/adr\.schema\.json/,
    why: 'the published schema is not this feature\u2019s to write; the envelope stays a separate artifact (FR-005)',
  },
  {
    id: 'schema-module',
    pattern: /\badr\.schema\b/,
    why: 'the ADR schema module belongs to @adrkit/core and is not part of the envelope surface',
  },
  {
    id: 'core-schema-subpath',
    pattern: /@adrkit\/core\/schema/,
    why: 'importing core\u2019s schema subpath would put the envelope on the published schema surface',
  },
  {
    id: 'schema-emit',
    pattern: /\bschema:emit\b/,
    why: 'regenerating the published schema from this feature is forbidden (FR-005)',
  },
];

const ADAPTER_MUST_NOT_NAME_CONSUMER: readonly Rule[] = [
  {
    id: 'adapter-to-consumer',
    pattern: new RegExp(CONSUMER_PACKAGE_NAME.replace('/', '\\/')),
    why: 'FR-044: the adapter must not depend on the consumer; the envelope file on disk is the entire interface',
  },
];

const CONSUMER_MUST_NOT_NAME_ADAPTER: readonly Rule[] = [
  {
    id: 'consumer-to-adapter',
    pattern: new RegExp(ADAPTER_PACKAGE_NAME.replace('/', '\\/')),
    why: 'FR-044: the consumer must not depend on the adapter; the envelope file on disk is the entire interface',
  },
];

/** Module specifiers that need no dependency declaration. */
const BUILTIN = (specifier: string): boolean =>
  specifier.startsWith('node:') || specifier.startsWith('bun:') || specifier === 'bun';

/** `@scope/name/deep/path` → `@scope/name`; `name/deep` → `name`. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

function declaredDependencies(packageRoot: string): Set<string> {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const names = new Set<string>();
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const block = manifest[section];
    if (block && typeof block === 'object') for (const name of Object.keys(block)) names.add(name);
  }
  return names;
}

function undeclaredImports(files: readonly ScannedFile[], packageRoot: string): string[] {
  const declared = declaredDependencies(packageRoot);
  const undeclared = new Set<string>();
  for (const file of files) {
    for (const specifier of importSpecifiers(file.code)) {
      if (specifier.startsWith('.') || BUILTIN(specifier)) continue;
      const name = packageNameOf(specifier);
      if (!declared.has(name)) undeclared.add(`${file.path} -> ${name}`);
    }
  }
  return [...undeclared].sort();
}

const adapterFiles = scanned(ADAPTER_ROOT);
const consumerFiles = scanned(CONSUMER_ROOT);

describe('FR-005 — what this guard examined', () => {
  // The anti-blindness half. Every assertion below concludes something from an
  // absence, and an absence found in an empty file list is not a finding.
  test('read the adapter source tree, including its entry point', () => {
    expect(adapterFiles.map((file) => file.path)).toContain(
      'packages/adapters/catalog-backstage/src/index.ts',
    );
  });

  test('read the consumer source tree, including its entry point', () => {
    expect(consumerFiles.map((file) => file.path)).toContain('packages/catalog-envelope/src/index.ts');
  });
});

describe('FR-005 — neither package writes to or regenerates schema/', () => {
  test('the adapter names no part of the published schema surface', () => {
    expect(violations(adapterFiles, SCHEMA_RULES)).toEqual([]);
  });

  test('the consumer names no part of the published schema surface', () => {
    expect(violations(consumerFiles, SCHEMA_RULES)).toEqual([]);
  });

  test('neither package declares a script that emits or writes the schema', () => {
    const offending: string[] = [];
    for (const [packageName, root] of [
      [ADAPTER_PACKAGE_NAME, ADAPTER_ROOT],
      [CONSUMER_PACKAGE_NAME, CONSUMER_ROOT],
    ] as const) {
      for (const [name, command] of Object.entries(packageScripts(root))) {
        if (/schema/.test(command)) offending.push(`${packageName}: ${name} -> ${command}`);
      }
    }
    expect(offending).toEqual([]);
  });

  test('both packages declare the scripts this repository expects, so the check above read something', () => {
    // Guards the guard: a package with no scripts at all would pass the script
    // rule for the wrong reason.
    expect(Object.keys(packageScripts(ADAPTER_ROOT)).sort()).toEqual(['build', 'lint', 'typecheck']);
    expect(Object.keys(packageScripts(CONSUMER_ROOT)).sort()).toEqual(['build', 'lint', 'typecheck']);
  });
});

describe('FR-044 / package-boundary.md §5 — the shape is local, and there is no shared module', () => {
  test('no adapter source names the consumer package', () => {
    expect(violations(adapterFiles, ADAPTER_MUST_NOT_NAME_CONSUMER)).toEqual([]);
  });

  test('no consumer source names the adapter package', () => {
    expect(violations(consumerFiles, CONSUMER_MUST_NOT_NAME_ADAPTER)).toEqual([]);
  });

  test('no relative import escapes either package root', () => {
    // Closes the route that names neither package: `../../catalog-envelope/src/...`
    // reaches across the boundary without ever writing the package name.
    const escaping = [
      ...adapterFiles.flatMap((file) => escapingRelativeImports(file, ADAPTER_ROOT)),
      ...consumerFiles.flatMap((file) => escapingRelativeImports(file, CONSUMER_ROOT)),
    ];
    expect(escaping).toEqual([]);
  });

  test('neither package imports a module it has not declared as a dependency', () => {
    // The manifest allowlist in scripts/check-deps.ts governs what may be
    // *declared*. This governs what is actually *imported*, which is where a
    // shared envelope-shape module would show up first.
    expect(undeclaredImports(adapterFiles, ADAPTER_ROOT)).toEqual([]);
    expect(undeclaredImports(consumerFiles, CONSUMER_ROOT)).toEqual([]);
  });
});

describe('FR-005 / FR-044 — the rules above, observed rejecting (permanent negative cases)', () => {
  const SCHEMA_FIXTURES: readonly { readonly ruleId: string; readonly source: string }[] = [
    { ruleId: 'published-schema-file', source: 'const p = "schema/adr.schema.json";' },
    { ruleId: 'schema-module', source: 'import { AdrSchema } from "./adr.schema.ts";' },
    { ruleId: 'core-schema-subpath', source: 'import { x } from "@adrkit/core/schema";' },
    { ruleId: 'schema-emit', source: 'const cmd = "bun run schema:emit";' },
  ];

  for (const { ruleId, source } of SCHEMA_FIXTURES) {
    test(`${ruleId} fires on: ${source}`, () => {
      expect(
        violationsInSource('fixture.ts', source, SCHEMA_RULES).map((violation) => violation.ruleId),
      ).toContain(ruleId);
    });
  }

  test('every schema rule has been observed firing at least once', () => {
    const exercised = new Set(
      SCHEMA_FIXTURES.flatMap(({ source }) =>
        violationsInSource('fixture.ts', source, SCHEMA_RULES).map((violation) => violation.ruleId),
      ),
    );
    expect([...exercised].sort()).toEqual(SCHEMA_RULES.map((rule) => rule.id).sort());
  });

  test('the adapter-to-consumer rule fires on an import of the consumer', () => {
    const found = violationsInSource(
      'fixture.ts',
      'import { validate } from "@adrkit/catalog-envelope";',
      ADAPTER_MUST_NOT_NAME_CONSUMER,
    );
    expect(found.map((violation) => violation.ruleId)).toEqual(['adapter-to-consumer']);
  });

  test('the consumer-to-adapter rule fires on an import of the adapter', () => {
    const found = violationsInSource(
      'fixture.ts',
      'import { generate } from "@adrkit/catalog-backstage";',
      CONSUMER_MUST_NOT_NAME_ADAPTER,
    );
    expect(found.map((violation) => violation.ruleId)).toEqual(['consumer-to-adapter']);
  });

  test('escapingRelativeImports fires on a path that leaves the package root', () => {
    const escaping = escapingRelativeImports(
      {
        path: 'packages/adapters/catalog-backstage/src/pipeline.ts',
        code: 'import type { Envelope } from "../../../catalog-envelope/src/index.ts";',
      },
      ADAPTER_ROOT,
    );
    expect(escaping).toEqual([
      { specifier: '../../../catalog-envelope/src/index.ts', resolved: 'packages/catalog-envelope/src/index.ts' },
    ]);
  });

  test('escapingRelativeImports leaves an in-package relative import alone', () => {
    const escaping = escapingRelativeImports(
      {
        path: 'packages/adapters/catalog-backstage/src/pipeline.ts',
        code: 'import { PACKAGE_NAME } from "./index.ts";',
      },
      ADAPTER_ROOT,
    );
    expect(escaping).toEqual([]);
  });

  test('undeclaredImports fires on a workspace package the manifest never declared', () => {
    const found = undeclaredImports(
      [
        {
          path: 'packages/catalog-envelope/src/derive.ts',
          code: 'import { evaluate } from "@adrkit/evaluator";\nimport { join } from "node:path";',
        },
      ],
      CONSUMER_ROOT,
    );
    expect(found).toEqual(['packages/catalog-envelope/src/derive.ts -> @adrkit/evaluator']);
  });

  test('undeclaredImports accepts a declared dependency, a builtin, and a subpath of a declared dependency', () => {
    const found = undeclaredImports(
      [
        {
          path: 'packages/adapters/catalog-backstage/src/x.ts',
          code: [
            'import { canonicalStringify } from "@adrkit/core";',
            'import { readFile } from "node:fs/promises";',
            'import { test } from "bun:test";',
            'import picomatch from "picomatch";',
          ].join('\n'),
        },
      ],
      ADAPTER_ROOT,
    );
    expect(found).toEqual([]);
  });
});
