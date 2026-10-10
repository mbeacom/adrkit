/**
 * The decision-portal Action's metadata and logic, with the generator and `@actions/core`
 * stubbed (ADR-0054 clauses 2, 9, 10).
 *
 * - `action.yml` is nested, build-only, and runs `../dist/portal-action.js` on `node24`, as
 *   the queue Action does; no root `action.yml` names it.
 * - Exit 0 succeeds; exit 1 succeeds with a warning and the `exit-code` output; exit 2 fails
 *   with the generator's message; a throw fails with a fixed message, never the error's text.
 * - A repository the payload marks private or internal, or one whose payload does not say it
 *   is public, is refused with a fixed message, and the generator is never called, unless
 *   `publish-private` is exactly `true`.
 *
 * ADR-0016 clause 2: observed failing, 2026-10-10, macOS, Bun 1.4.2, each by a planted
 * mutation of `src/portal-action.ts`, then reverted:
 * - `inputs.publishPrivate !== 'true'` replaced by `false` (the clause-10 gate removed):
 *   "a private repository is refused ...", "an internal repository is refused ...", and
 *   "a missing repository is refused ...", and "only the exact string true opens the gate"
 *   failed (the generator was called).
 * - The exit-1 branch changed to `core.setFailed(...)`: "exit 1 succeeds with a warning ..."
 *   failed (a failure was recorded and no warning).
 * - The catch changed to `core.setFailed(String(error))`: "a throw fails with a fixed
 *   message ..." failed (the planted sentinel reached the failure).
 * - `optional(inputs.asOf)` replaced by `inputs.asOf`: "absent optional inputs reach the
 *   generator as undefined" failed (`asOf: ''`, which the generator rejects as a usage error).
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GeneratePortalOptions, GeneratePortalResult } from '@adrkit/portal/src/generate.ts';
import {
  CRASH_MESSAGE,
  INTERNAL_REPOSITORY_MESSAGE,
  PRIVATE_REPOSITORY_MESSAGE,
  repositoryVisibility,
  runPortalAction,
  UNKNOWN_VISIBILITY_MESSAGE,
  type PortalActionInputs,
} from '../src/portal-action.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const ACTION_YML = resolve(ROOT, 'packages/ci/portal/action.yml');
const PUBLIC = { private: false, visibility: 'public' };

interface Recorded {
  outputs: Record<string, string>;
  failed: string[];
  warnings: string[];
  infos: string[];
  calls: GeneratePortalOptions[];
}

function inputs(overrides: Partial<PortalActionInputs> = {}): PortalActionInputs {
  return { dir: 'docs/adr', out: '_site', baseUrl: '', asOf: '', publishPrivate: 'false', ...overrides };
}

function result(exitCode: 0 | 1 | 2, extra: Partial<GeneratePortalResult> = {}): GeneratePortalResult {
  return { exitCode, dataFile: null, data: null, errors: [], message: null, ...extra };
}

async function run(options: {
  repository?: unknown;
  inputs?: Partial<PortalActionInputs>;
  generate?: (options: GeneratePortalOptions) => Promise<GeneratePortalResult>;
}) {
  const recorded: Recorded = { outputs: {}, failed: [], warnings: [], infos: [], calls: [] };
  const generate = options.generate ?? (async () => result(0));
  const outcome = await runPortalAction({
    inputs: inputs(options.inputs),
    repository: 'repository' in options ? options.repository : PUBLIC,
    workspace: '/workspace',
    generate: async (generateOptions) => {
      recorded.calls.push(generateOptions);
      return generate(generateOptions);
    },
    core: {
      setOutput: (name, value) => void (recorded.outputs[name] = value),
      setFailed: (message) => void recorded.failed.push(message),
      warning: (message) => void recorded.warnings.push(message),
      info: (message) => void recorded.infos.push(message),
    },
  });
  return { outcome, ...recorded };
}

describe('portal/action.yml', () => {
  const action = Bun.YAML.parse(readFileSync(ACTION_YML, 'utf8')) as {
    name: string;
    description: string;
    inputs: Record<string, { required: boolean; default: string }>;
    outputs: Record<string, unknown>;
    runs: { using: string; main: string };
    branding: { icon: string; color: string };
  };

  test('runs the nested portal bundle on node24, as the queue Action does', () => {
    expect(action.runs).toEqual({ using: 'node24', main: '../dist/portal-action.js' });
    const queue = Bun.YAML.parse(readFileSync(resolve(ROOT, 'packages/ci/queue/action.yml'), 'utf8')) as {
      runs: { using: string };
      branding: { color: string };
    };
    expect(action.runs.using).toBe(queue.runs.using);
    expect(action.branding.color).toBe(queue.branding.color);
  });

  test('declares exactly the five inputs, all optional, with their defaults', () => {
    expect(Object.keys(action.inputs).sort()).toEqual(['as-of', 'base-url', 'dir', 'out', 'publish-private']);
    expect(Object.values(action.inputs).every((input) => input.required === false)).toBe(true);
    expect(action.inputs.dir?.default).toBe('docs/adr');
    expect(action.inputs.out?.default).toBe('_site');
    expect(action.inputs['base-url']?.default).toBe('');
    expect(action.inputs['as-of']?.default).toBe('');
    expect(action.inputs['publish-private']?.default).toBe('false');
  });

  test('declares the exit-code output and no token input', () => {
    expect(Object.keys(action.outputs)).toEqual(['exit-code']);
    expect(action.inputs).not.toHaveProperty('token');
  });

  test('stays nested: no root alias names it', () => {
    const root = readFileSync(resolve(ROOT, 'action.yml'), 'utf8');
    expect(root).not.toContain('portal');
    expect(existsSync(resolve(ROOT, 'packages/ci/portal/dist'))).toBe(false);
  });

  test('ships with @adrkit/ci', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'packages/ci/package.json'), 'utf8')) as {
      files: string[];
      scripts: { build: string };
    };
    expect(pkg.files).toContain('portal');
    expect(pkg.scripts.build).toContain(
      'bun build ./src/portal-action-entrypoint.ts --target=node --conditions bun --outfile=dist/portal-action.js',
    );
  });
});

describe('exit codes (clause 9)', () => {
  test('exit 0 succeeds and sets exit-code 0', async () => {
    const run0 = await run({});
    expect(run0.failed).toEqual([]);
    expect(run0.warnings).toEqual([]);
    expect(run0.outputs).toEqual({ 'exit-code': '0' });
  });

  test('exit 1 succeeds with a warning annotation and sets exit-code 1', async () => {
    const errors = [
      { severity: 'error', code: 'x', message: 'one' },
      { severity: 'error', code: 'y', message: 'two' },
    ] as unknown as GeneratePortalResult['errors'];
    const run1 = await run({ generate: async () => result(1, { errors }) });
    expect(run1.failed).toEqual([]);
    expect(run1.outputs).toEqual({ 'exit-code': '1' });
    expect(run1.warnings).toHaveLength(1);
    expect(run1.warnings[0]).toContain('2 error finding(s)');
    expect(run1.warnings[0]).toContain('The complete bundle was written');
  });

  test("exit 2 fails with the generator's message and sets exit-code 2", async () => {
    const message = 'Corpus directory "docs/adr" is outside the repository.';
    const run2 = await run({ generate: async () => result(2, { message }) });
    expect(run2.outputs).toEqual({ 'exit-code': '2' });
    expect(run2.failed).toEqual([`adrkit portal: ${message}`]);
    expect(run2.warnings).toEqual([]);
  });

  test('a throw fails with a fixed message, never the error text or stack', async () => {
    const sentinel = 'SENTINEL-/home/runner/secret-path';
    const crashed = await run({
      generate: async () => {
        throw new Error(sentinel);
      },
    });
    expect(crashed.outcome).toEqual({ kind: 'crashed' });
    expect(crashed.failed).toEqual([CRASH_MESSAGE]);
    expect(crashed.outputs).toEqual({ 'exit-code': '2' });
    expect(JSON.stringify(crashed)).not.toContain('SENTINEL');
  });

  test('passes the workspace and inputs to the generator', async () => {
    const passed = await run({
      inputs: { dir: 'decisions', out: 'public', baseUrl: 'https://example.test/repo/', asOf: '2026-07-05' },
    });
    expect(passed.calls).toEqual([
      { cwd: '/workspace', dir: 'decisions', out: 'public', baseUrl: 'https://example.test/repo/', asOf: '2026-07-05' },
    ]);
  });

  test('absent optional inputs reach the generator as undefined', async () => {
    const passed = await run({ inputs: { dir: '', out: '', baseUrl: '', asOf: '' } });
    expect(passed.calls).toEqual([
      { cwd: '/workspace', dir: 'docs/adr', out: '_site', baseUrl: undefined, asOf: undefined },
    ]);
  });
});

describe('a private repository fails closed (clause 10)', () => {
  test('a private repository is refused with a fixed message, and the generator is not called', async () => {
    const refused = await run({ repository: { private: true, visibility: 'private' } });
    expect(refused.outcome).toEqual({ kind: 'refused', reason: 'private' });
    expect(refused.failed).toEqual([PRIVATE_REPOSITORY_MESSAGE]);
    expect(refused.calls).toEqual([]);
    expect(refused.outputs).toEqual({});
  });

  test('an internal repository is refused with a fixed message, and the generator is not called', async () => {
    const refused = await run({ repository: { private: false, visibility: 'internal' } });
    expect(refused.outcome).toEqual({ kind: 'refused', reason: 'internal' });
    expect(refused.failed).toEqual([INTERNAL_REPOSITORY_MESSAGE]);
    expect(refused.calls).toEqual([]);
  });

  test('a missing repository is refused, because public cannot be confirmed', async () => {
    for (const repository of [undefined, null, {}, { name: 'x' }, { private: 'false' }, { private: false, visibility: 'odd' }]) {
      const refused = await run({ repository });
      expect(refused.failed).toEqual([UNKNOWN_VISIBILITY_MESSAGE]);
      expect(refused.calls).toEqual([]);
    }
  });

  test('publish-private: true allows a private, an internal, and an unknown repository', async () => {
    for (const repository of [{ private: true }, { visibility: 'internal' }, undefined]) {
      const allowed = await run({ repository, inputs: { publishPrivate: 'true' } });
      expect(allowed.failed).toEqual([]);
      expect(allowed.calls).toHaveLength(1);
      expect(allowed.outputs).toEqual({ 'exit-code': '0' });
    }
  });

  test('only the exact string true opens the gate', async () => {
    for (const publishPrivate of ['True', 'TRUE', 'yes', '1', 'false', '']) {
      const refused = await run({ repository: { private: true }, inputs: { publishPrivate } });
      expect(refused.calls).toEqual([]);
      expect(refused.failed).toEqual([PRIVATE_REPOSITORY_MESSAGE]);
    }
  });

  test('a public repository needs no input', () => {
    expect(repositoryVisibility({ private: false, visibility: 'public' })).toBe('public');
    expect(repositoryVisibility({ private: false })).toBe('public');
    expect(repositoryVisibility({ visibility: 'public' })).toBe('public');
    expect(repositoryVisibility({ private: true, visibility: 'public' })).toBe('private');
  });
});
