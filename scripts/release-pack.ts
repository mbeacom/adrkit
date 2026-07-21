import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

const REPOSITORY_URL = 'git+https://github.com/mbeacom/adrkit.git';
const RELEASE_ROOT = resolve(import.meta.dir, '..');
const DEFAULT_OUTPUT_DIR = join(RELEASE_ROOT, '.release');

export interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
  description?: string;
  repository?: { type?: string; url?: string; directory?: string };
  engines?: { node?: string };
  publishConfig?: { access?: string };
  dependencies?: Record<string, string>;
  files?: string[];
  bin?: Record<string, string>;
  [key: string]: unknown;
}

export interface ReleasePackageDefinition {
  name: string;
  directory: string;
  expectedFiles: readonly string[];
  workspaceDependencies: readonly string[];
}

export interface ReleaseArtifact {
  name: string;
  version: string;
  tarball: string;
  integrity: string;
}

export interface ReleaseManifest {
  version: string;
  artifacts: ReleaseArtifact[];
}

export const RELEASE_PACKAGES: readonly ReleasePackageDefinition[] = [
  {
    name: '@adrkit/core',
    directory: 'packages/core',
    expectedFiles: [
      'README.md',
      'dist/LICENSE',
      'dist/NOTICE',
      'dist/index.d.ts',
      'dist/index.js',
      'dist/schema/index.d.ts',
      'dist/schema/index.js',
      'package.json',
      'src/index.ts',
    ],
    workspaceDependencies: [],
  },
  {
    name: '@adrkit/evaluator',
    directory: 'packages/evaluator',
    expectedFiles: [
      'README.md',
      'dist/LICENSE',
      'dist/NOTICE',
      'dist/index.d.ts',
      'dist/index.js',
      'package.json',
      'src/index.ts',
    ],
    workspaceDependencies: ['@adrkit/core'],
  },
  {
    name: '@adrkit/cli',
    directory: 'packages/cli',
    expectedFiles: [
      'README.md',
      'dist/LICENSE',
      'dist/NOTICE',
      'dist/index.d.ts',
      'dist/index.js',
      'package.json',
      'src/index.ts',
    ],
    workspaceDependencies: ['@adrkit/core', '@adrkit/evaluator'],
  },
  {
    name: '@adrkit/mcp',
    directory: 'packages/mcp',
    expectedFiles: [
      'README.md',
      'dist/LICENSE',
      'dist/NOTICE',
      'dist/bin.js',
      'dist/index.d.ts',
      'dist/index.js',
      'package.json',
      'src/index.ts',
    ],
    workspaceDependencies: ['@adrkit/core'],
  },
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(path).text()) as T;
}

async function run(command: readonly string[], cwd: string, label: string): Promise<string> {
  const process = Bun.spawn([...command], {
    cwd,
    stdout: 'pipe',
    stderr: 'inherit',
    env: { ...Bun.env, FORCE_COLOR: '1' },
  });
  const output = await new Response(process.stdout).text();
  const exitCode = await process.exited;
  assert(exitCode === 0, `${label} failed with exit ${exitCode}`);
  return output.trim();
}

export function findWorkspaceProtocols(value: unknown, path = 'package.json'): string[] {
  if (typeof value === 'string') return value.startsWith('workspace:') ? [path] : [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findWorkspaceProtocols(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) => findWorkspaceProtocols(entry, `${path}.${key}`));
}

export function validateSourceManifests(
  manifests: ReadonlyMap<string, PackageManifest>,
  tag?: string,
): string {
  const versions = new Set<string>();
  for (const definition of RELEASE_PACKAGES) {
    const manifest = manifests.get(definition.name);
    assert(manifest, `Missing source manifest for ${definition.name}`);
    assert(manifest.name === definition.name, `Expected package name ${definition.name}`);
    assert(typeof manifest.version === 'string' && manifest.version.length > 0, `${definition.name} needs a version`);
    assert(manifest.private !== true, `${definition.name} must not be private`);
    assert(typeof manifest.description === 'string' && manifest.description.length > 0, `${definition.name} needs a description`);
    assert(manifest.repository?.url === REPOSITORY_URL, `${definition.name} repository URL must be ${REPOSITORY_URL}`);
    assert(manifest.repository?.directory === definition.directory, `${definition.name} repository directory is incorrect`);
    assert(manifest.engines?.node === '>=22', `${definition.name} must require Node >=22`);
    assert(manifest.publishConfig?.access === 'public', `${definition.name} must publish with public access`);
    assert(manifest.files?.includes('dist'), `${definition.name} must publish dist`);
    assert(manifest.files?.includes('README.md'), `${definition.name} must publish README.md`);
    versions.add(manifest.version);
  }
  assert(versions.size === 1, `Release package versions must match: ${[...versions].join(', ')}`);
  const [version] = versions;
  assert(version, 'Release version is missing');
  assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), `Release version ${version} must be stable SemVer`);
  if (tag) assert(tag === `v${version}`, `Release tag ${tag} must match package version v${version}`);
  return version;
}

export function validatePackedManifest(
  definition: ReleasePackageDefinition,
  manifest: PackageManifest,
  version: string,
): void {
  assert(manifest.name === definition.name, `Packed package name mismatch for ${definition.name}`);
  assert(manifest.version === version, `Packed version mismatch for ${definition.name}`);
  const workspaceProtocols = findWorkspaceProtocols(manifest);
  assert(
    workspaceProtocols.length === 0,
    `${definition.name} leaked workspace protocols at ${workspaceProtocols.join(', ')}`,
  );
  for (const dependency of definition.workspaceDependencies) {
    assert(
      manifest.dependencies?.[dependency] === version,
      `${definition.name} must resolve ${dependency} to ${version}, got ${manifest.dependencies?.[dependency]}`,
    );
  }
}

function parseArguments(args: readonly string[]): {
  outputDir: string;
  skipBuild: boolean;
  skipSmokeInstall: boolean;
  tag?: string;
} {
  let outputDir = DEFAULT_OUTPUT_DIR;
  let skipBuild = false;
  let skipSmokeInstall = false;
  let tag: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--skip-build') {
      skipBuild = true;
    } else if (argument === '--skip-smoke-install') {
      skipSmokeInstall = true;
    } else if (argument === '--tag') {
      tag = args[index + 1];
      assert(tag, '--tag requires a value');
      index += 1;
    } else if (argument === '--output') {
      const value = args[index + 1];
      assert(value, '--output requires a value');
      outputDir = resolve(RELEASE_ROOT, value);
      index += 1;
    } else {
      throw new Error(`Unknown release-pack argument: ${argument}`);
    }
  }
  return { outputDir, skipBuild, skipSmokeInstall, tag };
}

async function tarEntries(tarball: string): Promise<string[]> {
  const output = await run(['tar', '-tzf', tarball], RELEASE_ROOT, `listing ${basename(tarball)}`);
  return output
    .split('\n')
    .map((entry) => entry.replace(/^package\//, '').replace(/\/$/, ''))
    .filter(Boolean);
}

async function packedPackageJson(tarball: string): Promise<PackageManifest> {
  const output = await run(
    ['tar', '-xOzf', tarball, 'package/package.json'],
    RELEASE_ROOT,
    `reading ${basename(tarball)} package.json`,
  );
  return JSON.parse(output) as PackageManifest;
}

async function sha512Integrity(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return `sha512-${createHash('sha512').update(new Uint8Array(bytes)).digest('base64')}`;
}

async function prepareSmokeProject(outputDir: string, artifacts: readonly ReleaseArtifact[]): Promise<void> {
  const smokeDir = join(outputDir, 'smoke');
  await mkdir(smokeDir, { recursive: true });
  const dependencies = Object.fromEntries(
    artifacts.map((artifact) => [artifact.name, `file:../npm/${artifact.tarball}`]),
  );
  await Bun.write(
    join(smokeDir, 'package.json'),
    `${JSON.stringify(
      { name: 'adrkit-release-smoke', private: true, type: 'module', dependencies, overrides: dependencies },
      null,
      2,
    )}\n`,
  );
  await Bun.write(
    join(smokeDir, 'smoke.mjs'),
    `import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import * as core from '@adrkit/core';
import * as cli from '@adrkit/cli';
import * as evaluator from '@adrkit/evaluator';
import * as mcp from '@adrkit/mcp';

if (typeof core.lintCorpus !== 'function') throw new Error('Installed @adrkit/core is missing lintCorpus');
if (typeof cli.main !== 'function') throw new Error('Installed @adrkit/cli is missing main');
if (typeof evaluator.evaluatePass0 !== 'function') throw new Error('Installed @adrkit/evaluator is missing evaluatePass0');
if (typeof mcp.createAdrkitMcpServer !== 'function') throw new Error('Installed @adrkit/mcp is missing createAdrkitMcpServer');

const repoRoot = process.argv[2];
if (!repoRoot) throw new Error('Expected repository root argument');

// The public @adrkit/mcp surface is only the sealed lifecycle handle.
const handle = mcp.createAdrkitMcpServer({ cwd: repoRoot, dir: 'docs/adr' });
if (Object.getPrototypeOf(handle) !== null) throw new Error('Installed MCP handle must be a null-prototype object');
if (!Object.isFrozen(handle)) throw new Error('Installed MCP handle must be frozen');
if (JSON.stringify(Object.getOwnPropertyNames(handle).sort()) !== JSON.stringify(['close', 'start'])) {
  throw new Error('Installed MCP handle must expose exactly start and close');
}
if (mcp.buildRegisteredServer !== undefined) throw new Error('Installed @adrkit/mcp must not export its internal builder');

async function runMcpStdio(bin, cwd) {
  const proc = spawn(bin, ['--cwd', cwd], { stdio: ['pipe', 'pipe', 'inherit'] });
  const messages = new Map();
  const wanted = [2, 3, 4, 5, 6];
  let buffer = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP stdio smoke timed out')), 20000);
    proc.on('error', reject);
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.jsonrpc !== '2.0') throw new Error('MCP bin emitted a non-JSON-RPC stdout line');
        if (typeof message.id === 'number') messages.set(message.id, message);
        if (wanted.every((id) => messages.has(id))) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    const frames = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_decisions', arguments: { query: 'git' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_decision', arguments: { ref: '0001' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_decision_context', arguments: { files: ['README.md'] } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_superseded', arguments: {} } },
    ];
    proc.stdin.write(frames.map((f) => JSON.stringify(f) + '\\n').join(''));
  });
  proc.stdin.end();
  proc.kill();
  const list = messages.get(2);
  const names = (list?.result?.tools ?? []).map((t) => t.name).sort();
  const expected = ['get_decision', 'get_decision_context', 'list_superseded', 'search_decisions'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Installed adrkit-mcp did not list the four tools: ' + names);
  for (const id of [3, 4, 5, 6]) {
    const outcome = messages.get(id)?.result?.structuredContent?.result?.outcome;
    if (!outcome) throw new Error('Installed adrkit-mcp tool call ' + id + ' did not return a structured outcome');
  }
}

const mcpBin = join(import.meta.dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'adrkit-mcp.cmd' : 'adrkit-mcp');
await runMcpStdio(mcpBin, repoRoot);

const bin = join(import.meta.dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'adr.cmd' : 'adr');
const lint = spawnSync(bin, ['lint', join(repoRoot, 'docs/adr')], { cwd: repoRoot, encoding: 'utf8' });
if (lint.stdout) process.stdout.write(lint.stdout);
if (lint.stderr) process.stderr.write(lint.stderr);
if (lint.status !== 0) throw new Error(\`Installed adr lint failed with exit \${lint.status}\`);

const evaluate = spawnSync(bin, [
  'evaluate',
  join(repoRoot, 'packages/evaluator/test/fixtures/proposal-0042.md'),
  '--snapshot',
  join(repoRoot, 'packages/evaluator/test/fixtures/snapshot.clean.json'),
  '--date',
  '2026-07-19',
  '--json',
], { cwd: repoRoot, encoding: 'utf8' });
if (evaluate.stderr) process.stderr.write(evaluate.stderr);
if (evaluate.status !== 0) throw new Error(\`Installed adr evaluate failed with exit \${evaluate.status}\`);
const payload = JSON.parse(evaluate.stdout);
if (payload.result?.report?.results?.length !== 11) throw new Error('Installed evaluator did not emit eleven rules');

const queue = spawnSync(bin, ['queue', '--dir', join(repoRoot, 'docs/adr'), '--as-of', '2026-01-08', '--format', 'json'], { cwd: repoRoot, encoding: 'utf8' });
if (queue.stderr) process.stderr.write(queue.stderr);
if (queue.status !== 0) throw new Error(\`Installed adr queue failed with exit \${queue.status}\`);
const queuePayload = JSON.parse(queue.stdout);
if (queuePayload.version !== '1') throw new Error('Installed adr queue did not emit version "1"');

console.log(\`release-smoke: installed packages passed on \${process.version}\`);
`,
  );
  await run([process.execPath, 'install', '--ignore-scripts'], smokeDir, 'installing release tarballs');
}

export async function packRelease(args = Bun.argv.slice(2)): Promise<ReleaseManifest> {
  const options = parseArguments(args);
  const npmDir = join(options.outputDir, 'npm');
  await rm(options.outputDir, { recursive: true, force: true });
  await mkdir(npmDir, { recursive: true });

  const sourceManifests = new Map<string, PackageManifest>();
  for (const definition of RELEASE_PACKAGES) {
    sourceManifests.set(
      definition.name,
      await readJson<PackageManifest>(join(RELEASE_ROOT, definition.directory, 'package.json')),
    );
  }
  const version = validateSourceManifests(sourceManifests, options.tag);

  if (!options.skipBuild) {
    await run([process.execPath, 'run', 'build'], RELEASE_ROOT, 'building release packages');
  }

  const artifacts: ReleaseArtifact[] = [];
  for (const definition of RELEASE_PACKAGES) {
    const filename = `${definition.name.slice(1).replace('/', '-')}-${version}.tgz`;
    const packageDir = join(RELEASE_ROOT, definition.directory);
    await run(
      [
        process.execPath,
        'pm',
        'pack',
        '--ignore-scripts',
        '--destination',
        npmDir,
      ],
      packageDir,
      `packing ${definition.name}`,
    );
    const tarball = join(npmDir, filename);
    const entries = new Set(await tarEntries(tarball));
    for (const expectedFile of definition.expectedFiles) {
      assert(entries.has(expectedFile), `${definition.name} tarball is missing ${expectedFile}`);
    }
    const packedManifest = await packedPackageJson(tarball);
    validatePackedManifest(definition, packedManifest, version);
    if (definition.name === '@adrkit/cli') {
      assert(packedManifest.bin?.adr === './dist/index.js', 'Packed CLI must expose the adr binary');
    }
    if (definition.name === '@adrkit/mcp') {
      assert(packedManifest.bin?.['adrkit-mcp'] === './dist/bin.js', 'Packed MCP must expose the adrkit-mcp binary');
    }
    artifacts.push({
      name: definition.name,
      version,
      tarball: relative(npmDir, tarball),
      integrity: await sha512Integrity(tarball),
    });
  }

  const manifest: ReleaseManifest = { version, artifacts };
  await Bun.write(join(npmDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (!options.skipSmokeInstall) await prepareSmokeProject(options.outputDir, artifacts);
  console.log(`release-pack: prepared ${artifacts.length} packages at v${version}`);
  return manifest;
}

if (import.meta.main) {
  await packRelease();
}
