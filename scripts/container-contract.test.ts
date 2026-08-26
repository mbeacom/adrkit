import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const CONTAINERFILE = readFileSync(join(ROOT, 'Containerfile'), 'utf8');
const ENTRYPOINT_PATH = join(ROOT, 'scripts', 'container-entrypoint.sh');
const ENTRYPOINT = readFileSync(ENTRYPOINT_PATH, 'utf8');
const DOCKERIGNORE = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  packageManager: string;
};

const SURFACES = [
  {
    target: 'cli',
    aliases: ['cli', 'adr', 'adrkit'],
    artifact: '/opt/adrkit/adr.js',
    entrypoint: '["node", "/opt/adrkit/adr.js"]',
  },
  {
    target: 'mcp',
    aliases: ['mcp', 'adrkit-mcp'],
    artifact: '/opt/adrkit/adrkit-mcp.js',
    entrypoint: '["node", "/opt/adrkit/adrkit-mcp.js"]',
  },
  {
    target: 'ci',
    aliases: ['ci', 'adrkit-ci'],
    artifact: '/opt/adrkit/ci.js',
    entrypoint: '["node", "/opt/adrkit/ci.js"]',
  },
  {
    target: 'queue-action',
    aliases: ['queue-action', 'adrkit-queue-action'],
    artifact: '/opt/adrkit/queue-action.js',
    entrypoint: '["node", "/opt/adrkit/queue-action.js"]',
  },
] as const;

function dockerignoreLines(): Set<string> {
  return new Set(
    DOCKERIGNORE.split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

describe('container contract', () => {
  test('pins the repository Bun version and immutable multi-architecture bases', () => {
    const bunVersion = PACKAGE.packageManager.replace(/^bun@/, '');

    expect(CONTAINERFILE).toContain(`ARG BUN_VERSION=${bunVersion}`);
    expect(CONTAINERFILE).toMatch(/^ARG BUN_DIGEST=sha256:[a-f0-9]{64}$/m);
    expect(CONTAINERFILE).toContain('ARG NODE_VERSION=24-alpine');
    expect(CONTAINERFILE).toMatch(/^ARG NODE_DIGEST=sha256:[a-f0-9]{64}$/m);
    expect(CONTAINERFILE).toContain('bun install --frozen-lockfile --production --ignore-scripts');
  });

  test('keeps each dedicated target limited to its executable surface', () => {
    expect(CONTAINERFILE).toContain('chown node:node /workspace');
    expect(CONTAINERFILE).toContain('WORKDIR /workspace');
    expect(CONTAINERFILE).toContain('USER node');

    for (const surface of SURFACES) {
      const stage = CONTAINERFILE.split(`FROM runtime AS ${surface.target}\n`)[1]?.split('\n\n')[0] ?? '';
      expect(stage).toContain(surface.artifact);
      expect(stage).toContain(`ENTRYPOINT ${surface.entrypoint}`);
      for (const other of SURFACES.filter((candidate) => candidate.target !== surface.target)) {
        expect(stage).not.toContain(other.artifact);
      }
    }

    expect(CONTAINERFILE).toContain('FROM runtime AS adrkit');
  });

  test('keeps selectors, help, target names, and documentation synchronized', () => {
    for (const surface of SURFACES) {
      expect(ENTRYPOINT).toContain(`${surface.aliases.join(' | ')})`);
      expect(ENTRYPOINT).toContain(`"$ADRKIT_HOME${surface.artifact.slice('/opt/adrkit'.length)}"`);
      expect(README).toContain(surface.aliases.join('`/`'));
    }

    const syntax = Bun.spawnSync(['sh', '-n', ENTRYPOINT_PATH]);
    expect(syntax.exitCode).toBe(0);

    const help = Bun.spawnSync(['sh', ENTRYPOINT_PATH, '--help']);
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain('selectors:');
    expect(help.stdout.toString()).toContain('cli --help');
  });

  test('admits only runtime source and the committed Action bundles', () => {
    const lines = dockerignoreLines();

    expect(lines.has('!packages/core/src/**')).toBe(true);
    expect(lines.has('!packages/evaluator/src/**')).toBe(true);
    expect(lines.has('!packages/cli/src/**')).toBe(true);
    expect(lines.has('!packages/mcp/src/**')).toBe(true);
    expect(lines.has('!packages/ci/dist/**')).toBe(true);
    expect(lines.has('!packages/core/**')).toBe(false);
    expect(lines.has('!packages/ci/**')).toBe(false);
    expect(lines.has('packages/*/*')).toBe(true);
    expect(lines.has('packages/adapters/*/*')).toBe(true);
    expect(CONTAINERFILE).not.toContain('COPY packages ./packages');
    expect(CONTAINERFILE).toContain('COPY packages/core/src ./packages/core/src');
    expect(CONTAINERFILE).toContain('COPY packages/ci/dist ./packages/ci/dist');
  });
});
