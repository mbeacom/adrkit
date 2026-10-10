import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const CONTAINERFILE = readFileSync(join(ROOT, 'Containerfile'), 'utf8');
const ENTRYPOINT_PATH = join(ROOT, 'scripts', 'container-entrypoint.sh');
const ENTRYPOINT = readFileSync(ENTRYPOINT_PATH, 'utf8');
const DOCKERIGNORE = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const CI_WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
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
    target: 'server',
    aliases: ['server', 'adrkit-server'],
    artifact: '/opt/adrkit/server.js',
    entrypoint: '["node", "/opt/adrkit/server.js"]',
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
    expect(help.stdout.toString()).toContain('help <command>');
    expect(ENTRYPOINT).not.toContain('help | -h');
  });

  test('smokes every published selector through the all-in-one image', () => {
    expect(CI_WORKFLOW).toContain('adrkit:ci cli --version');
    expect(CI_WORKFLOW).toContain('scripts/smoke-container.mjs adrkit:ci mcp');
    expect(CI_WORKFLOW).toContain('adrkit:ci ci 2>&1');
    expect(CI_WORKFLOW).toContain('adrkit:ci queue-action 2>&1');
    expect(CI_WORKFLOW).toContain('adrkit:ci server');
  });

  // ADR-0055 clauses 12 to 14. The server is network-facing, so its documented run keeps
  // everything of the stdio MCP posture but `--network none`: a read-only root file system,
  // `:ro` mounts, and a loopback default that only an explicit ADRKIT_SERVER_HOST overrides.
  // ADR-0016 clause 2: observed failing with the `COPY packages/server/src` line removed from
  // the Containerfile, and (the selector test above) with the entrypoint's
  // `server | adrkit-server)` case renamed; the retained inputs are both lines, restored.
  test('builds and documents the server selector with its read-only posture', () => {
    expect(CONTAINERFILE).toContain('COPY packages/sdk/src ./packages/sdk/src');
    expect(CONTAINERFILE).toContain('COPY packages/portal/src ./packages/portal/src');
    expect(CONTAINERFILE).toContain('COPY packages/server/src ./packages/server/src');
    expect(CONTAINERFILE).toContain('bun build packages/server/src/bin.ts');
    const allInOne = CONTAINERFILE.split('FROM runtime AS adrkit\n')[1] ?? '';
    expect(allInOne).toContain('/out/server.js /opt/adrkit/server.js');

    const help = Bun.spawnSync(['sh', ENTRYPOINT_PATH, '--help']).stdout.toString();
    expect(help).toContain('server | adrkit-server');
    expect(help).toContain('authenticates no one');

    const section = README.split('### The read-only REST server')[1]?.split('\n## ')[0] ?? '';
    expect(section.trimStart()).toStartWith('**This server authenticates no one.**');
    expect(section).toContain('ADRKIT_SERVER_CORPORA');
    expect(section).toContain('--read-only');
    expect(section).toMatch(/:ro\b/);
    const run = section.split('```sh')[1]?.split('```')[0] ?? '';
    expect(run).toContain('adrkit:vX.Y.Z server');
    expect(run).not.toContain('--network none');
    expect(run).not.toMatch(/-p (?!127\.0\.0\.1:)/);

    for (const line of ['!packages/sdk/src/**', '!packages/portal/src/**', '!packages/server/src/**']) {
      expect(dockerignoreLines().has(line)).toBe(true);
    }
    expect(CI_WORKFLOW).toContain('docker build -f Containerfile --target server -t adrkit-server:ci .');
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

// The build stage copies only package manifests before `bun install --frozen-lockfile`, and
// Bun 1.4.2 refuses a pruned workspace set in which a copied workspace depends on one that is
// not on disk ("a pruned checkout must keep every workspace that its remaining workspaces
// depend on"). `@adrkit/ci` gained `@adrkit/portal` for the portal Action (ADR-0054), and the
// container build failed exactly that way until the portal manifest was copied.
// ADR-0016 clause 2: observed failing with the `packages/portal/package.json` COPY line
// removed (and the build itself was observed failing first, `podman build --target build`).
describe('container build-stage manifests', () => {
  test('every workspace dependency of a copied manifest is copied too', () => {
    const copied = [...CONTAINERFILE.matchAll(/^COPY (packages\/\S+\/package\.json) /gm)].map((match) => match[1]!);
    const byName = new Map<string, string>();
    for (const path of copied) {
      const manifest = JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as { name: string };
      byName.set(manifest.name, path);
    }
    const missing: string[] = [];
    for (const path of copied) {
      const manifest = JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
        if (version.startsWith('workspace:') && !byName.has(name)) missing.push(`${path} -> ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
