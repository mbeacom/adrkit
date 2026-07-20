import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { loadSnapshotBundle, parseSnapshotJson, SnapshotContractError } from '../src/evaluate-snapshot.ts';

/**
 * Strict snapshot-bundle parsing + validation (parent finding #1). The duplicate-key-
 * aware reader enforces exact RFC 8259 number grammar; the validator rejects
 * noncanonical assertion keys, invalid canonical target keys, duplicate principal ids,
 * and unknown nested keys, while normalizing set-like target-key arrays into immutable
 * sets. Malformed bundles map through the CLI to exit 2.
 */

const V1 = 'adrkit.pass0.snapshot/v1';

function bundle(body: Record<string, unknown>): string {
  return JSON.stringify({ schemaVersion: V1, ...body });
}

function expectReject(text: string): void {
  expect(() => loadSnapshotBundle(text)).toThrow(SnapshotContractError);
}

describe('RFC 8259 number grammar', () => {
  const valid = ['0', '-0', '1', '123', '10', '1.5', '1.5e10', '1.5E-10', '-12.34e+5'];
  const invalid = ['01', '1.', '1.e5', '+1', '1e', '1e+', '1E', '00', '0.', '.5', '1..2', '1.2.3'];

  for (const n of valid) {
    test(`accepts ${JSON.stringify(n)}`, () => {
      expect(parseSnapshotJson(n)).toBe(Number(n));
    });
  }
  for (const n of invalid) {
    test(`rejects ${JSON.stringify(n)}`, () => {
      expect(() => parseSnapshotJson(n)).toThrow(SnapshotContractError);
    });
  }

  test('rejects an invalid number nested inside a bundle', () => {
    expectReject(`{"schemaVersion":"${V1}","routingEvidence":{"costEvidence":{"normalizedCost":01,"threshold":5}}}`);
  });
});

describe('duplicate keys', () => {
  test('rejects a duplicate top-level key', () => {
    expectReject(`{"schemaVersion":"${V1}","log":"a","log":"b"}`);
  });
  test('rejects a duplicate nested key', () => {
    expectReject(`{"schemaVersion":"${V1}","routingEvidence":{"dataResidency":{"present":true,"present":false}}}`);
  });
});

describe('deterministic parser depth', () => {
  function nestedArray(depth: number): string {
    return `${'['.repeat(depth)}null${']'.repeat(depth)}`;
  }

  test('accepts the fixed parser depth bound', () => {
    expect(() => parseSnapshotJson(nestedArray(128))).not.toThrow();
  });

  test('rejects nesting beyond the fixed bound with a contract error', () => {
    expect(() => parseSnapshotJson(nestedArray(129))).toThrow(SnapshotContractError);
  });
});

describe('assertion + target key canonicality', () => {
  test('rejects a whitespace-padded (noncanonical) assertion key', () => {
    expectReject(bundle({ assertionInputs: { inputs: { '[ "", "docs/adr/0042-x.md", "a" ]': { document: {} } } } }));
  });
  test('rejects a wrong-arity assertion key', () => {
    expectReject(bundle({ assertionInputs: { sources: { '["","docs/adr/0042-x.md"]': { fileContent: '$.a' } } } }));
  });
  test('accepts the exact canonical assertion key', () => {
    const normalized = loadSnapshotBundle(bundle({ assertionInputs: { inputs: { '["","docs/adr/0042-x.md","a"]': { document: { a: 1 } } } } }));
    expect(normalized.assertionInputs.inputs['["","docs/adr/0042-x.md","a"]']).toEqual({ document: { a: 1 } });
  });
  test('rejects an invalid canonical target key (no kind prefix)', () => {
    expectReject(bundle({ routingEvidence: { securitySurfaceTargetKeys: ['not-a-target-key'] } }));
  });
  test('rejects a target key with an unknown kind', () => {
    expectReject(bundle({ routingEvidence: { regulatedTargetKeys: ['bogus:x'] } }));
  });
});

describe('identity + nested keys', () => {
  test('rejects duplicate principal ids', () => {
    expectReject(
      bundle({
        identity: {
          principals: [
            { id: '@a', active: true, kind: 'human' },
            { id: '@a', active: false, kind: 'human' },
          ],
          teams: [],
        },
      }),
    );
  });
  test('rejects an unknown nested key in a target inventory entry', () => {
    expectReject(bundle({ targets: { resources: [{ id: 'r', bogus: 1 }] } }));
  });
  test('rejects an unknown nested key in an assertion source', () => {
    expectReject(bundle({ assertionInputs: { sources: { '["","docs/adr/0042-x.md","a"]': { fileContent: '$.a', bogus: 1 } } } }));
  });
});

describe('identity team/principal consistency (finding #4)', () => {
  const human = (id: string, active = true) => ({ id, active, kind: 'human' as const });
  const teamPrincipal = (id: string) => ({ id, active: true, kind: 'team' as const });

  test('accepts a consistent team/principal snapshot', () => {
    const normalized = loadSnapshotBundle(
      bundle({ identity: { principals: [human('@a'), teamPrincipal('team:x')], teams: [{ id: 'team:x', members: ['@a'] }] } }),
    );
    expect(normalized.identity?.teams).toHaveLength(1);
  });

  test('rejects duplicate team ids (last-write Map bypass of the ambiguity barrier)', () => {
    expectReject(
      bundle({
        identity: {
          principals: [human('@a'), human('@b'), teamPrincipal('team:x')],
          teams: [
            { id: 'team:x', members: ['@a', '@b'] },
            { id: 'team:x', members: ['@a'] },
          ],
        },
      }),
    );
  });

  test('rejects a team id that collides with a human principal', () => {
    expectReject(bundle({ identity: { principals: [human('team:x')], teams: [{ id: 'team:x', members: [] }] } }));
  });

  test('rejects a team with no matching principal', () => {
    expectReject(bundle({ identity: { principals: [human('@a')], teams: [{ id: 'team:x', members: ['@a'] }] } }));
  });

  test('rejects a team principal with no membership entry', () => {
    expectReject(bundle({ identity: { principals: [teamPrincipal('team:x')], teams: [] } }));
  });
});

describe('prototype-pollution boundary (finding #1)', () => {
  test('a parsed object retains __proto__ as an own key and pollutes nothing', () => {
    const parsed = parseSnapshotJson('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.keys(parsed).sort()).toEqual(['__proto__', 'a']);
    // Object.prototype is untouched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test('a bundle with a top-level __proto__ key is rejected (unknown key)', () => {
    expectReject('{"schemaVersion":"adrkit.pass0.snapshot/v1","__proto__":1}');
  });

  test('a bundle with a top-level constructor key is rejected (unknown key)', () => {
    expectReject('{"schemaVersion":"adrkit.pass0.snapshot/v1","constructor":1}');
  });

  test('integer-like own keys are retained through parsing', () => {
    const parsed = parseSnapshotJson('{"10":1,"2":2}') as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['10', '2']);
  });
});

describe('canonical routing target keys (finding #3)', () => {
  test('accepts a canonical path target key', () => {
    const normalized = loadSnapshotBundle(bundle({ routingEvidence: { securitySurfaceTargetKeys: ['path:src/a.ts'] } }));
    expect(normalized.routingEvidence?.securitySurfaceTargets?.has('path:src/a.ts')).toBe(true);
  });

  test('rejects a noncanonical leading-dot path key', () => {
    expectReject(bundle({ routingEvidence: { securitySurfaceTargetKeys: ['path:./src/a.ts'] } }));
  });

  test('rejects a backslash path key', () => {
    expectReject(bundle({ routingEvidence: { regulatedTargetKeys: ['path:src\\\\a.ts'] } }));
  });
});

describe('successful set normalization', () => {
  test('converts set-like target-key arrays into immutable sets', () => {
    const normalized = loadSnapshotBundle(
      bundle({
        routingEvidence: {
          securitySurfaceTargetKeys: ['path:src/a.ts', 'path:src/b.ts'],
          regulatedTargetKeys: ['entity:svc:pay'],
          productionTargetKeys: ['path:src/a.ts'],
        },
      }),
    );
    expect(normalized.routingEvidence?.securitySurfaceTargets).toBeInstanceOf(Set);
    expect(normalized.routingEvidence?.securitySurfaceTargets?.has('path:src/a.ts')).toBe(true);
    expect(normalized.routingEvidence?.securitySurfaceTargets?.size).toBe(2);
    expect(normalized.routingEvidence?.regulatedTargets?.has('entity:svc:pay')).toBe(true);
    expect(normalized.routingEvidence?.productionTargets?.has('path:src/a.ts')).toBe(true);
  });

  test('omitted optional backing normalizes to empty runtime containers (inert, not malformed)', () => {
    const normalized = loadSnapshotBundle(bundle({}));
    expect(normalized.targets).toEqual({});
    expect(normalized.assertionInputs).toEqual({ sources: {}, inputs: {} });
    expect(normalized.routingEvidence).toBeUndefined();
  });
});

describe('malformed bundles map through the CLI to exit 2', () => {
  const DIR_NAME = 'cli-evaluate-snapshot';
  const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');

  async function runAdr(args: string[]) {
    const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  afterEach(async () => {
    await cleanupTestDir(DIR_NAME);
  });

  const badBundles: ReadonlyArray<{ name: string; text: string }> = [
    { name: 'duplicate key', text: `{"schemaVersion":"${V1}","log":"a","log":"b"}` },
    { name: 'invalid number', text: `{"schemaVersion":"${V1}","routingEvidence":{"costEvidence":{"normalizedCost":01,"threshold":5}}}` },
    { name: 'noncanonical assertion key', text: bundle({ assertionInputs: { inputs: { '[ "", "p", "a" ]': { document: {} } } } }) },
    { name: 'invalid target key', text: bundle({ routingEvidence: { securitySurfaceTargetKeys: ['nope'] } }) },
    { name: 'noncanonical target key', text: bundle({ routingEvidence: { securitySurfaceTargetKeys: ['path:./src/a.ts'] } }) },
    { name: 'top-level __proto__ key', text: '{"schemaVersion":"adrkit.pass0.snapshot/v1","__proto__":1}' },
    { name: 'duplicate team id', text: bundle({ identity: { principals: [{ id: '@a', active: true, kind: 'human' }, { id: '@b', active: true, kind: 'human' }, { id: 'team:x', active: true, kind: 'team' }], teams: [{ id: 'team:x', members: ['@a', '@b'] }, { id: 'team:x', members: ['@a'] }] } }) },
    { name: 'duplicate principal', text: bundle({ identity: { principals: [{ id: '@a', active: true, kind: 'human' }, { id: '@a', active: true, kind: 'human' }], teams: [] } }) },
  ];

  for (const { name, text } of badBundles) {
    test(`exit 2 for ${name}`, async () => {
      const root = await resetTestDir(DIR_NAME);
      const proposal = join(root, 'p.md');
      await writeText(proposal, '---\nschemaVersion: 0.1.0\nid: "0042"\ntitle: A clear decision title\nstatus: proposed\ndate: 2026-07-19\n---\n\n# ADR-0042\n');
      const snap = join(root, 'snap.json');
      await writeText(snap, text);
      const result = await runAdr(['evaluate', proposal, '--snapshot', snap, '--date', '2026-07-19']);
      expect(result.exitCode).toBe(2);
    });
  }
});
