import { describe, expect, test } from 'bun:test';
import { makeSandbox, runScript, snapshotTree, withCorpus, withFeature } from './harness.ts';

/**
 * Behavior of the three command scripts, exercised end to end against a fake
 * `adr` in a sandbox whose PATH cannot reach a real one.
 *
 * The failure cases matter more than the happy ones here. A governance command
 * that exits 0 having found nothing — because it was pointed at the wrong
 * directory, or because the CLI was never installed — reports "nothing governs
 * this" in exactly the same words as a correct empty result. That is the defect
 * ADR-0016 was written about, and the reason each of these asserts a specific
 * message rather than merely a non-zero exit.
 */
describe('context.sh', () => {
  test('refuses to run when the corpus directory is absent', async () => {
    const sandbox = makeSandbox();
    const result = await runScript(sandbox, 'context.sh', [], { ADRKIT_CLI: sandbox.fakeCli });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no ADR corpus at 'docs/adr'");
    expect(result.stdout).toBe('');
    expect(result.argv).toEqual([]);
  });

  test('names the missing CLI instead of silently reporting nothing', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const result = await runScript(sandbox, 'context.sh');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("adrkit's CLI is not installed");
    expect(result.stderr).toContain('@adrkit/cli');
    expect(result.stdout).toBe('');
  });

  test('reports the open decision queue when given no paths', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const result = await runScript(sandbox, 'context.sh', [], { ADRKIT_CLI: sandbox.fakeCli });

    expect(result.exitCode).toBe(0);
    expect(result.argv).toEqual(['queue', '--dir', 'docs/adr', '--format', 'json']);
    expect(result.stdout).toContain('"fake":"adr"');
  });

  test('reports the decisions governing the paths it is given', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const result = await runScript(sandbox, 'context.sh', ['src/a.ts', 'src/b.ts'], {
      ADRKIT_CLI: sandbox.fakeCli,
    });

    expect(result.exitCode).toBe(0);
    expect(result.argv).toEqual([
      'check',
      'src/a.ts',
      'src/b.ts',
      '--dir',
      'docs/adr',
      '--json',
    ]);
  });

  test('honors ADRKIT_DIR for a corpus that is not at docs/adr', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox, 'governance/decisions');
    const result = await runScript(sandbox, 'context.sh', [], {
      ADRKIT_CLI: sandbox.fakeCli,
      ADRKIT_DIR: 'governance/decisions',
    });

    expect(result.exitCode).toBe(0);
    expect(result.argv).toEqual([
      'queue',
      '--dir',
      'governance/decisions',
      '--format',
      'json',
    ]);
  });

  test('runs a .js CLI entry point through node', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const result = await runScript(sandbox, 'context.sh', [], { ADRKIT_CLI: sandbox.fakeCliJs });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"fake":"adr-js"');
    expect(result.argv).toEqual(['queue', '--dir', 'docs/adr', '--format', 'json']);
  });

  test('rejects an ADRKIT_CLI pointing at nothing', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const result = await runScript(sandbox, 'context.sh', [], {
      ADRKIT_CLI: '/nonexistent/adr',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('/nonexistent/adr');
    expect(result.stderr).toContain('nothing exists at that path');
  });
});

describe('check.sh', () => {
  test('refuses to run with no reachable feature context', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const result = await runScript(sandbox, 'check.sh', [], { ADRKIT_CLI: sandbox.fakeCli });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no Spec Kit feature context reachable');
    expect(result.argv).toEqual([]);
  });

  test('refuses to run when the feature exists but has no plan', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const feature = withFeature(sandbox, { plan: false });
    const result = await runScript(sandbox, 'check.sh', [], {
      ADRKIT_CLI: sandbox.fakeCli,
      ADRKIT_FEATURE_DIR: feature,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no plan at');
    expect(result.stderr).toContain('/speckit.plan');
  });

  test('checks the plan artifact when given no paths, and says the evaluator did not run', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const feature = withFeature(sandbox, { plan: true });
    const result = await runScript(sandbox, 'check.sh', [], {
      ADRKIT_CLI: sandbox.fakeCli,
      ADRKIT_FEATURE_DIR: feature,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('==> adrkit:check');
    expect(result.stdout).not.toContain('==> adrkit:evaluate');
    expect(result.argv).toEqual([
      'check',
      `${feature}/plan.md`,
      '--dir',
      'docs/adr',
      '--json',
    ]);
    // The omission is announced. A routing check that quietly did not happen is
    // indistinguishable from one that happened and found nothing.
    expect(result.stderr).toContain('no ADRKIT_SNAPSHOT configured');
  });

  test('checks the paths it is given rather than the plan', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const feature = withFeature(sandbox, { plan: true });
    const result = await runScript(sandbox, 'check.sh', ['packages/core/src/index.ts'], {
      ADRKIT_CLI: sandbox.fakeCli,
      ADRKIT_FEATURE_DIR: feature,
    });

    expect(result.argv).toEqual([
      'check',
      'packages/core/src/index.ts',
      '--dir',
      'docs/adr',
      '--json',
    ]);
  });

  test('runs the deterministic evaluator when a snapshot bundle is configured', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const feature = withFeature(sandbox, { plan: true });
    const snapshot = `${sandbox.project}/snapshot.json`;
    await Bun.write(snapshot, '{}');

    const result = await runScript(sandbox, 'check.sh', [], {
      ADRKIT_CLI: sandbox.fakeCli,
      ADRKIT_FEATURE_DIR: feature,
      ADRKIT_SNAPSHOT: snapshot,
      ADRKIT_AS_OF: '2026-08-01',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('==> adrkit:check');
    expect(result.stdout).toContain('==> adrkit:evaluate');
    expect(result.argv).toEqual([
      'check',
      `${feature}/plan.md`,
      '--dir',
      'docs/adr',
      '--json',
      'evaluate',
      `${feature}/plan.md`,
      '--snapshot',
      snapshot,
      '--date',
      '2026-08-01',
      '--dir',
      'docs/adr',
      '--json',
    ]);
  });

  test('rejects a configured snapshot bundle that does not exist', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const feature = withFeature(sandbox, { plan: true });

    const result = await runScript(sandbox, 'check.sh', [], {
      ADRKIT_CLI: sandbox.fakeCli,
      ADRKIT_FEATURE_DIR: feature,
      ADRKIT_SNAPSHOT: '/nonexistent/snapshot.json',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no snapshot bundle exists there');
  });

  test('propagates the CLI exit code instead of flattening it to success', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const feature = withFeature(sandbox, { plan: true });

    const result = await runScript(sandbox, 'check.sh', [], {
      ADRKIT_CLI: sandbox.fakeCli,
      ADRKIT_FEATURE_DIR: feature,
      ADRKIT_FAKE_EXIT: '1',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('==> adrkit:check');
  });

  test('mutates nothing in the project it inspects', async () => {
    // The production analogue of spike 008's mutation baseline. Unlike the
    // spike's bar, which was applied to install and remove — lifecycle actions
    // whose whole job is to write files — byte-identity is exactly the right
    // bar for this command, because this is the one a hook can fire.
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const feature = withFeature(sandbox, { plan: true });
    const snapshot = `${sandbox.project}/snapshot.json`;
    await Bun.write(snapshot, '{}');

    const before = snapshotTree(sandbox.project);
    const result = await runScript(sandbox, 'check.sh', [], {
      ADRKIT_CLI: sandbox.fakeCli,
      ADRKIT_FEATURE_DIR: feature,
      ADRKIT_SNAPSHOT: snapshot,
    });
    const after = snapshotTree(sandbox.project);

    expect(result.exitCode).toBe(0);
    // Guard the guard: an empty tree would make the comparison meaningless.
    expect(Object.keys(before).length).toBeGreaterThan(3);
    expect(after).toEqual(before);
  });
});

describe('draft.sh', () => {
  test('treats a missing title as a usage error, not a missing dependency', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const feature = withFeature(sandbox, { plan: true });

    const result = await runScript(sandbox, 'draft.sh', [], {
      ADRKIT_CLI: sandbox.fakeCli,
      ADRKIT_FEATURE_DIR: feature,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('draft needs a title');
    expect(result.argv).toEqual([]);
  });

  test('refuses to draft without a plan to draft from', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const feature = withFeature(sandbox, { plan: false });

    const result = await runScript(sandbox, 'draft.sh', ['Adopt Postgres'], {
      ADRKIT_CLI: sandbox.fakeCli,
      ADRKIT_FEATURE_DIR: feature,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no plan at');
    expect(result.argv).toEqual([]);
  });

  test('scaffolds a draft record from a multi-word title', async () => {
    const sandbox = makeSandbox();
    withCorpus(sandbox);
    const feature = withFeature(sandbox, { plan: true });

    const result = await runScript(
      sandbox,
      'draft.sh',
      ['Adopt', 'Postgres', 'for', 'the', 'read', 'model'],
      { ADRKIT_CLI: sandbox.fakeCli, ADRKIT_FEATURE_DIR: feature },
    );

    expect(result.exitCode).toBe(0);
    expect(result.argv).toEqual([
      'new',
      'Adopt Postgres for the read model',
      '--status',
      'draft',
      '--dir',
      'docs/adr',
      '--json',
    ]);
    expect(result.stderr).toContain(`drafting from ${feature}/plan.md`);
  });
});
