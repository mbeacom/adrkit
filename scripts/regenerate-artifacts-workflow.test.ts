/**
 * Contract checks on `.github/workflows/regenerate-artifacts.yml` (ADR-0041).
 *
 * The workflow holds a write credential on `pull_request_target`, so the
 * properties that keep it safe are asserted against the parsed file, as
 * `trusted-gates-workflow.test.ts` does for the gates. Every one of them fails
 * silently if lost: a `${{ }}` in a run body still runs, a checkout of the pull
 * request still builds, a secret in the build job still works.
 *
 * The push job's path validation is security-critical shell, so it is not only
 * inspected: the tests extract that exact step and run it against uploads a
 * dependency could have forged in the build job.
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  run?: string;
}
interface Job {
  name?: string;
  if?: string;
  needs?: string | string[];
  'runs-on'?: string;
  permissions?: Record<string, string>;
  steps: Step[];
}

const SOURCE = readFileSync(join(import.meta.dir, '..', '.github', 'workflows', 'regenerate-artifacts.yml'), 'utf8');
const WORKFLOW = Bun.YAML.parse(SOURCE) as {
  on?: Record<string, { types?: string[] }>;
  true?: Record<string, { types?: string[] }>;
  permissions?: Record<string, string>;
  concurrency?: unknown;
  jobs: Record<string, Job>;
};
const TRIGGERS = WORKFLOW.on ?? WORKFLOW.true ?? {};
const JOBS = WORKFLOW.jobs;
const ALL_STEPS = Object.values(JOBS).flatMap((job) => job.steps);

function step(job: string, fragment: string): Step {
  const found = JOBS[job]?.steps.find((s) => s.name?.includes(fragment));
  if (!found) throw new Error(`no step in ${job} whose name contains "${fragment}"`);
  return found;
}

describe('the trigger', () => {
  test('is pull_request_target on labeled only', () => {
    expect(Object.keys(TRIGGERS)).toEqual(['pull_request_target']);
    expect(TRIGGERS.pull_request_target?.types).toEqual(['labeled']);
  });

  test('every job but cleanup is gated on the label, directly or through needs', () => {
    expect(JOBS.eligibility?.if).toBe("github.event.label.name == 'regenerate-artifacts'");
    expect(JOBS.build?.needs).toBe('eligibility');
    expect(JOBS.push?.needs).toEqual(['eligibility', 'build']);
    expect(JOBS.cleanup?.if).toBe("always() && github.event.label.name == 'regenerate-artifacts'");
  });

  // Against the parsed document, so the comments explaining why may name it.
  test('github.actor is never consulted', () => {
    expect(JSON.stringify(WORKFLOW)).not.toMatch(/github\.(actor|triggering_actor)\b/);
  });

  test('the granted head comes from the event, and is checked against the live API', () => {
    expect(step('eligibility', 'Decide eligibility').env?.GRANTED_HEAD).toBe('${{ github.event.pull_request.head.sha }}');
    expect(step('eligibility', 'Decide eligibility').run).toContain('--granted-head');
  });
});

describe('no pull-request code runs with a credential', () => {
  test('every checkout takes the default branch and keeps no credential', () => {
    const checkouts = ALL_STEPS.filter((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const s of checkouts) {
      expect(s.with?.ref).toBeUndefined();
      expect(s.with?.repository).toBeUndefined();
      expect(s.with?.['persist-credentials']).toBe(false);
    }
  });

  test('every action is pinned to a full 40-character SHA', () => {
    for (const s of ALL_STEPS.filter((x) => x.uses)) {
      expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  test('no run body interpolates an expression', () => {
    for (const s of ALL_STEPS.filter((x) => x.run)) {
      expect(s.run).not.toContain('${{');
    }
  });

  test('only build installs, with a frozen lockfile and no lifecycle scripts', () => {
    const installs = Object.entries(JOBS).flatMap(([name, job]) =>
      job.steps.filter((s) => /\bbun (install|add|i)\b/.test(s.run ?? '')).map((s) => [name, s.run!.trim()]),
    );
    expect(installs).toEqual([['build', 'bun install --frozen-lockfile --ignore-scripts']]);
  });

  test('the build runs where clean-clone-builds runs, with no secret', () => {
    expect(JOBS.build?.['runs-on']).toBe('ubuntu-24.04');
    expect(JSON.stringify(JOBS.build)).not.toContain('secrets.');
    expect(JOBS.build?.permissions).toEqual({ contents: 'read' });
  });

  test('the dependency-executing steps run with the network denied', () => {
    expect(step('build', 'Rebuild the Action bundles').run).toStartWith('bun scripts/run-network-denied.ts -- ');
    expect(step('build', 'Re-emit the JSON Schema').run).toStartWith('bun scripts/run-network-denied.ts -- ');
  });

  test('the push job checks nothing out, installs no Bun, and runs no repository script', () => {
    const push = JOBS.push!;
    expect(push.steps.some((s) => s.uses?.startsWith('actions/checkout@'))).toBe(false);
    expect(push.steps.some((s) => s.uses?.startsWith('oven-sh/setup-bun@'))).toBe(false);
    for (const s of push.steps) expect(s.run ?? '').not.toMatch(/\bbun\b|scripts\//);
  });
});

describe('privilege stays minimal and separated', () => {
  test('the workflow default grants nothing', () => {
    expect(WORKFLOW.permissions).toEqual({});
  });

  test('each job holds only what it uses', () => {
    expect(JOBS.eligibility?.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    expect(JOBS.push?.permissions).toEqual({});
    expect(JOBS.cleanup?.permissions).toEqual({ 'pull-requests': 'write' });
  });

  test('the App key is read only by the push job, scoped to contents: write', () => {
    for (const [name, job] of Object.entries(JOBS)) {
      if (name !== 'push') expect(JSON.stringify(job)).not.toContain('REGENERATE_ARTIFACTS_APP_PRIVATE_KEY');
    }
    const mint = step('push', 'Mint the App token');
    expect(mint.uses).toStartWith('actions/create-github-app-token@');
    expect(mint.with?.['permission-contents']).toBe('write');
  });

  test('there is no concurrency group that could replace a pending cleanup', () => {
    expect(WORKFLOW.concurrency).toBeUndefined();
  });
});

describe('the commit it writes', () => {
  const commit = () => step('push', 'Commit the regenerated artifacts').run ?? '';

  test('lets Dependabot keep rebasing, and carries a sign-off', () => {
    expect(commit()).toContain('[dependabot skip]');
    expect(commit()).toContain('Signed-off-by: ${bot_login} <${bot_id}+${bot_login}@users.noreply.github.com>');
  });

  test('is parented on the granted head and never force-pushed', () => {
    expect(commit()).toContain('parents: [$p]');
    expect(commit()).toContain('force: false');
    expect(commit()).not.toContain('force: true');
  });

  test('an empty regeneration pushes nothing', () => {
    expect(commit()).toContain('nothing to push');
  });
});

describe('the label is removed and the removal verified', () => {
  const body = () => step('cleanup', 'Remove the label').run ?? '';

  test('with a paginated live read', () => {
    expect(body()).toContain('gh api --paginate --slurp');
    expect(body()).toContain('ascii_downcase');
  });
});

describe('the push job refuses a forged upload', () => {
  const script = step('push', 'Validate the uploaded paths').run!;

  function run(paths: string, files: Record<string, string> = {}, link?: string): number {
    const temp = mkdtempSync(join(tmpdir(), 'regen-'));
    const root = join(temp, 'regenerated');
    mkdirSync(join(root, 'tree'), { recursive: true });
    writeFileSync(join(root, 'paths.txt'), paths);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, 'tree', path)), { recursive: true });
      writeFileSync(join(root, 'tree', path), content);
    }
    if (link) {
      mkdirSync(dirname(join(root, 'tree', link)), { recursive: true });
      symlinkSync('/etc/passwd', join(root, 'tree', link));
    }
    return spawnSync('bash', ['-c', script], { env: { ...process.env, RUNNER_TEMP: temp } }).status ?? -1;
  }

  test('accepts the real artifact set', () => {
    const files = { 'packages/ci/dist/index.js': 'x', 'schema/adr.schema.json': '{}' };
    expect(run('packages/ci/dist/index.js\nschema/adr.schema.json\n', files)).toBe(0);
  });

  test('accepts an empty list', () => {
    expect(run('')).toBe(0);
  });

  test('refuses a path outside the artifact set', () => {
    expect(run('scripts/check-dco.ts\n', { 'scripts/check-dco.ts': 'x' })).not.toBe(0);
  });

  // The fixture creates `packages/ci/dist/` so the traversal resolves to a real
  // file outside the upload tree; only the path rule can refuse it, not the
  // regular-file check.
  test('refuses traversal out of the upload tree', () => {
    const files = { 'packages/ci/dist/index.js': 'x', '../outside.js': 'runner secret' };
    expect(run('packages/ci/dist/../../../../outside.js\n', files)).not.toBe(0);
  });

  test('refuses a nested dist path', () => {
    expect(run('packages/ci/dist/sub/x.js\n', { 'packages/ci/dist/sub/x.js': 'x' })).not.toBe(0);
  });

  test('refuses an absolute path', () => {
    expect(run('/packages/ci/dist/index.js\n')).not.toBe(0);
  });

  test('refuses a listed file that was not uploaded', () => {
    expect(run('packages/ci/dist/index.js\n')).not.toBe(0);
  });

  test('refuses a symlink standing in for an artifact', () => {
    expect(run('packages/ci/dist/index.js\n', {}, 'packages/ci/dist/index.js')).not.toBe(0);
  });

  // Review finding on #231: the final component is a regular file, but an
  // ancestor directory is a symlink out of the upload tree.
  test('refuses a symlinked ancestor directory', () => {
    const temp = mkdtempSync(join(tmpdir(), 'regen-'));
    const root = join(temp, 'regenerated');
    const outside = join(temp, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'index.js'), 'runner secret');
    mkdirSync(join(root, 'tree', 'packages', 'ci'), { recursive: true });
    symlinkSync(outside, join(root, 'tree', 'packages', 'ci', 'dist'));
    writeFileSync(join(root, 'paths.txt'), 'packages/ci/dist/index.js\n');
    expect(spawnSync('bash', ['-c', script], { env: { ...process.env, RUNNER_TEMP: temp } }).status).not.toBe(0);
  });

  test('refuses an upload tree that is itself a symlink', () => {
    const temp = mkdtempSync(join(tmpdir(), 'regen-'));
    const root = join(temp, 'regenerated');
    const outside = join(temp, 'outside');
    mkdirSync(join(outside, 'packages', 'ci', 'dist'), { recursive: true });
    writeFileSync(join(outside, 'packages', 'ci', 'dist', 'index.js'), 'runner secret');
    mkdirSync(root, { recursive: true });
    symlinkSync(outside, join(root, 'tree'));
    writeFileSync(join(root, 'paths.txt'), 'packages/ci/dist/index.js\n');
    expect(spawnSync('bash', ['-c', script], { env: { ...process.env, RUNNER_TEMP: temp } }).status).not.toBe(0);
  });

  test('refuses a control character in the list', () => {
    expect(run('packages/ci/dist/index.js\u001b[2K\n', { 'packages/ci/dist/index.js': 'x' })).not.toBe(0);
  });

  test('refuses a missing list', () => {
    const temp = mkdtempSync(join(tmpdir(), 'regen-'));
    mkdirSync(join(temp, 'regenerated'));
    expect(spawnSync('bash', ['-c', script], { env: { ...process.env, RUNNER_TEMP: temp } }).status).not.toBe(0);
  });
});
