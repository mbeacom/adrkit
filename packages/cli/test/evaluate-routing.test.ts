import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';
import { makeAssertionKey } from '../../evaluator/src/index.ts';
import { sha256Hex, sha256HexUtf8 } from '../../evaluator/src/crypto/sha256.ts';
import { canonicalJsonString } from '../../evaluator/src/assertions/limits.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-evaluate-routing';

async function runAdr(args: string[], cwd = process.cwd()) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function proposal(id: string, extra: string): string {
  return `---\nschemaVersion: 0.1.0\nid: "${id}"\ntitle: A decision with a clear title\nstatus: proposed\ndate: 2026-07-19\n${extra}---\n\n# ADR-${id}\n`;
}

function sealEnvelope(): unknown {
  const source = 'package example\nallow = true';
  const moduleBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  let binary = '';
  for (const b of moduleBytes) binary += String.fromCharCode(b);
  const withoutHash = {
    mediaType: 'application/vnd.adrkit.rego-wasm-policy.v1+json',
    schemaVersion: 'adrkit.rego-wasm-policy/v1',
    source,
    sourceSha256: sha256HexUtf8(source),
    moduleBase64: btoa(binary),
    moduleSha256: sha256Hex(moduleBytes),
    data: {},
    entrypoint: '/example/allow',
    abi: { major: 1, minor: 3 },
    compiler: { name: 'opa', version: '0.60.0', capabilitiesProfile: 'adrkit.rego-wasm.capabilities/v1', capabilitiesSha256: sha256HexUtf8('caps') },
    requiredHostBuiltins: [],
  };
  return { ...withoutHash, envelopeSha256: sha256HexUtf8(canonicalJsonString(withoutHash)) };
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('adr evaluate — routing, boundary, and exit codes', () => {
  test('exit 0 for an escalated proposal (one-way-door) with no error rule', async () => {
    const root = await resetTestDir(DIR_NAME);
    const p = join(root, 'p.md');
    await writeText(p, proposal('0042', 'reversibility: one-way-door\n'));
    const snap = join(root, 'snap.json');
    await writeText(snap, JSON.stringify({ schemaVersion: 'adrkit.pass0.snapshot/v1' }));
    const result = await runAdr(['evaluate', p, '--snapshot', snap, '--date', '2026-07-19', '--json']);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.result.report.routing.escalate).toBe(true);
    expect(payload.result.report.routing.reasons).toContain('one-way-door');
  });

  test('exit 1 only for a rubric error (dangling ref)', async () => {
    const root = await resetTestDir(DIR_NAME);
    const p = join(root, 'p.md');
    await writeText(p, proposal('0042', 'relatesTo: ["9999"]\n'));
    const snap = join(root, 'snap.json');
    await writeText(snap, JSON.stringify({ schemaVersion: 'adrkit.pass0.snapshot/v1' }));
    const result = await runAdr(['evaluate', p, '--snapshot', snap, '--date', '2026-07-19', '--json']);
    expect(result.exitCode).toBe(1);
  });

  test('exit 2 when the snapshot JSON tries to name a registry/port (unknown key)', async () => {
    const root = await resetTestDir(DIR_NAME);
    const p = join(root, 'p.md');
    await writeText(p, proposal('0042', ''));
    const snap = join(root, 'snap.json');
    await writeText(snap, JSON.stringify({ schemaVersion: 'adrkit.pass0.snapshot/v1', assertionEngines: { jsonpath: 'evil-module' } }));
    const result = await runAdr(['evaluate', p, '--snapshot', snap, '--date', '2026-07-19']);
    expect(result.exitCode).toBe(2);
  });

  test('a valid compiled artifact with no registered rego engine is inert (exit 0), never executed', async () => {
    const root = await resetTestDir(DIR_NAME);
    const relPath = `${DIR_NAME.replace('cli-', '.test-output/cli-')}/p.md`;
    const p = join(root, 'p.md');
    await writeText(
      p,
      proposal('0042', 'assertions:\n  - id: policy\n    engine: rego\n    expressionFile: policy.rego\n    input: source\n    severity: error\n'),
    );
    // The evaluator normalizes the proposal path relative to cwd; compute the key the same way.
    const key = makeAssertionKey(undefined, `.test-output/${DIR_NAME}/p.md`, 'policy');
    const snap = join(root, 'snap.json');
    await writeText(
      snap,
      JSON.stringify({
        schemaVersion: 'adrkit.pass0.snapshot/v1',
        assertionInputs: { sources: { [key]: { compiledArtifact: sealEnvelope() } } },
      }),
    );
    const before = await Bun.file(p).text();
    const result = await runAdr(['evaluate', p, '--snapshot', snap, '--date', '2026-07-19', '--json']);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    const compile = payload.result.report.results.find((r: { rule: string }) => r.rule === 'assertions-compile');
    expect(compile.status).toBe('inert');
    expect(compile.reason).toBe('assertions-compile.engine-absent');
    // no persistence: the proposal file is untouched
    expect(await Bun.file(p).text()).toBe(before);
    void relPath;
  });

  test('a malformed compiled artifact is an exit-2 bundle error', async () => {
    const root = await resetTestDir(DIR_NAME);
    const p = join(root, 'p.md');
    await writeText(p, proposal('0042', ''));
    const key = makeAssertionKey(undefined, `.test-output/${DIR_NAME}/p.md`, 'policy');
    const snap = join(root, 'snap.json');
    await writeText(
      snap,
      JSON.stringify({
        schemaVersion: 'adrkit.pass0.snapshot/v1',
        assertionInputs: { sources: { [key]: { compiledArtifact: { mediaType: 'wrong', schemaVersion: 'x' } } } },
      }),
    );
    const result = await runAdr(['evaluate', p, '--snapshot', snap, '--date', '2026-07-19']);
    expect(result.exitCode).toBe(2);
  });
});
