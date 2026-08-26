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
  versioning: ReleaseVersioning;
  /**
   * Whether the package ships a built Node artifact. A Spec Kit extension ships
   * a manifest, command markdown, and shell scripts — there is no `dist` to
   * require and no Node version it constrains, so asserting either would be
   * asserting a fact about a different kind of package.
   */
  shipsNodeArtifact: boolean;
}

export interface ReleaseArtifact {
  name: string;
  version: string;
  tarball: string;
  integrity: string;
}

/**
 * How a release package is versioned.
 *
 * `lockstep` — moves with the repository's release tag. Core, CLI, evaluator,
 * and MCP form one API surface, so a consumer pinning one pins them all.
 *
 * `independent` — the package carries its own version. ADR-0007: "Adapters live
 * under `packages/adapters/*`, are versioned independently... Their semver
 * contract is with their upstream, not with our core." An adapter that broke
 * because Spec Kit changed has nothing to say about `@adrkit/core`'s API, and
 * dragging it through a major bump would say exactly that.
 */
export type ReleaseVersioning = 'lockstep' | 'independent';

export interface ReleaseManifest {
  version: string;
  /**
   * The exact tag this release must be published from. Carried explicitly rather
   * than rebuilt as `v${version}` downstream, because an independently versioned
   * adapter releases under its own tag and that string is no longer derivable
   * from the release version alone.
   */
  tag: string;
  artifacts: ReleaseArtifact[];
}

/**
 * The tag a package releases under.
 *
 * Lockstep packages share the repository tag, `v0.3.0`. An adapter releases on
 * its own, `spec-kit-v0.1.0`, so that shipping a fix for a Spec Kit change does
 * not require republishing four unchanged packages under a new version — which
 * would make "versioned independently" true of the number and false of
 * everything that matters.
 */
export function releaseTagFor(definition: ReleasePackageDefinition, version: string): string {
  if (definition.versioning === 'lockstep') return `v${version}`;
  const slug = definition.name.split('/')[1];
  assert(slug, `Cannot derive a release tag slug from ${definition.name}`);
  return `${slug}-v${version}`;
}

/** Resolve `--only` to its definition, or undefined for a full lockstep release. */
export function resolveOnly(only: string | undefined): ReleasePackageDefinition | undefined {
  if (!only) return undefined;
  const definition = RELEASE_PACKAGES.find((candidate) => candidate.name === only);
  assert(definition, `--only ${only} is not a release package`);
  assert(
    definition.versioning === 'independent',
    `--only is for independently versioned packages; ${only} is lockstep and releases with the repository tag`,
  );
  return definition;
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
    versioning: 'lockstep',
    shipsNodeArtifact: true,
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
    versioning: 'lockstep',
    shipsNodeArtifact: true,
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
    versioning: 'lockstep',
    shipsNodeArtifact: true,
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
    versioning: 'lockstep',
    shipsNodeArtifact: true,
  },
  {
    // The first independently versioned package. Not a Node library: it ships a
    // Spec Kit manifest, three command files, and the shell scripts behind them.
    name: '@adrkit/spec-kit',
    directory: 'packages/adapters/spec-kit',
    expectedFiles: [
      'LICENSE',
      'NOTICE',
      'README.md',
      'commands/check.md',
      'commands/context.md',
      'commands/draft.md',
      'extension.yml',
      'package.json',
      'scripts/adrkit-lib.sh',
      'scripts/check.sh',
      'scripts/context.sh',
      'scripts/draft.sh',
    ],
    workspaceDependencies: [],
    versioning: 'independent',
    shipsNodeArtifact: false,
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
  only?: ReleasePackageDefinition,
): string {
  const lockstepVersions = new Set<string>();
  let sawLockstep = false;

  for (const definition of RELEASE_PACKAGES) {
    const manifest = manifests.get(definition.name);
    assert(manifest, `Missing source manifest for ${definition.name}`);
    assert(manifest.name === definition.name, `Expected package name ${definition.name}`);
    assert(typeof manifest.version === 'string' && manifest.version.length > 0, `${definition.name} needs a version`);
    assert(manifest.private !== true, `${definition.name} must not be private`);
    assert(typeof manifest.description === 'string' && manifest.description.length > 0, `${definition.name} needs a description`);
    assert(manifest.repository?.url === REPOSITORY_URL, `${definition.name} repository URL must be ${REPOSITORY_URL}`);
    assert(manifest.repository?.directory === definition.directory, `${definition.name} repository directory is incorrect`);
    assert(manifest.publishConfig?.access === 'public', `${definition.name} must publish with public access`);
    assert(manifest.files?.includes('README.md'), `${definition.name} must publish README.md`);

    // Only meaningful for packages that ship executable JavaScript. A package of
    // manifests, markdown, and shell scripts constrains no Node version and has
    // no dist; requiring either would be asserting a fact about a package this
    // is not.
    if (definition.shipsNodeArtifact) {
      assert(manifest.engines?.node === '>=22', `${definition.name} must require Node >=22`);
      assert(manifest.files?.includes('dist'), `${definition.name} must publish dist`);
    } else {
      assert(
        !manifest.files?.includes('dist'),
        `${definition.name} declares no Node artifact but publishes dist`,
      );
    }

    assert(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version),
      `${definition.name} version ${manifest.version} must be stable SemVer`,
    );

    if (definition.versioning === 'lockstep') {
      sawLockstep = true;
      lockstepVersions.add(manifest.version);
    }
  }

  // The release version is the lockstep surface's version, and the tag names it.
  // Independently versioned adapters ride along at their own versions; the
  // publish step skips any already on the registry at matching integrity, so an
  // unchanged adapter is a no-op rather than a republish attempt.
  assert(sawLockstep, 'Release must contain at least one lockstep package');
  assert(
    lockstepVersions.size === 1,
    `Lockstep release package versions must match: ${[...lockstepVersions].join(', ')}`,
  );
  const [version] = lockstepVersions;
  assert(version, 'Release version is missing');

  // Every manifest is validated above regardless of scope — an adapter-only
  // release is still a good moment to notice that the lockstep surface drifted.
  // Only the tag expectation narrows.
  if (tag) {
    const expected = only
      ? releaseTagFor(only, versionFor(only, manifests, version))
      : `v${version}`;
    assert(tag === expected, `Release tag ${tag} must be ${expected}`);
  }
  return version;
}

/** The version a given release package publishes at. */
export function versionFor(
  definition: ReleasePackageDefinition,
  manifests: ReadonlyMap<string, PackageManifest>,
  lockstepVersion: string,
): string {
  if (definition.versioning === 'lockstep') return lockstepVersion;
  const manifest = manifests.get(definition.name);
  assert(manifest?.version, `Missing source manifest version for ${definition.name}`);
  return manifest.version;
}

export function validatePackedManifest(
  definition: ReleasePackageDefinition,
  manifest: PackageManifest,
  version: string,
  versionOfDependency: (name: string) => string,
): void {
  assert(manifest.name === definition.name, `Packed package name mismatch for ${definition.name}`);
  assert(manifest.version === version, `Packed version mismatch for ${definition.name}`);
  const workspaceProtocols = findWorkspaceProtocols(manifest);
  assert(
    workspaceProtocols.length === 0,
    `${definition.name} leaked workspace protocols at ${workspaceProtocols.join(', ')}`,
  );
  for (const dependency of definition.workspaceDependencies) {
    // Resolve against the dependency's own version, not the depender's. They are
    // the same number today for every lockstep package, and would silently stop
    // being the same the moment an independently versioned package grew a
    // workspace dependency.
    const expected = versionOfDependency(dependency);
    assert(
      manifest.dependencies?.[dependency] === expected,
      `${definition.name} must resolve ${dependency} to ${expected}, got ${manifest.dependencies?.[dependency]}`,
    );
  }
}

function parseArguments(args: readonly string[]): {
  outputDir: string;
  skipBuild: boolean;
  skipSmokeInstall: boolean;
  tag?: string;
  only?: string;
} {
  let outputDir = DEFAULT_OUTPUT_DIR;
  let skipBuild = false;
  let skipSmokeInstall = false;
  let tag: string | undefined;
  let only: string | undefined;
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
    } else if (argument === '--only') {
      only = args[index + 1];
      assert(only, '--only requires a value');
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
  return { outputDir, skipBuild, skipSmokeInstall, tag, only };
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
if (typeof core.filterAdrGraph !== 'function') throw new Error('Installed @adrkit/core is missing filterAdrGraph');
if (typeof core.renderMermaidGraph !== 'function') throw new Error('Installed @adrkit/core is missing renderMermaidGraph');
if (typeof cli.main !== 'function') throw new Error('Installed @adrkit/cli is missing main');
if (typeof evaluator.evaluatePass0 !== 'function') throw new Error('Installed @adrkit/evaluator is missing evaluatePass0');
if (typeof mcp.createAdrkitMcpServer !== 'function') throw new Error('Installed @adrkit/mcp is missing createAdrkitMcpServer');

const repoRoot = process.argv[2];
if (!repoRoot) throw new Error('Expected repository root argument');

const coreGraph = {
  nodes: [
    { id: '0001', title: 'Use the original', status: 'superseded' },
    { id: '0002', title: 'Use the replacement', status: 'accepted' },
  ],
  edges: [{ from: '0002', to: '0001', kind: 'supersedes' }],
};
const coreFocusedGraph = core.filterAdrGraph(coreGraph, { focus: '0002' });
if (coreFocusedGraph.nodes.length !== 2 || coreFocusedGraph.edges.length !== 1) {
  throw new Error('Installed @adrkit/core filterAdrGraph returned the wrong focused graph');
}
if (!core.renderMermaidGraph(coreFocusedGraph).startsWith('flowchart LR\\n')) {
  throw new Error('Installed @adrkit/core renderMermaidGraph did not emit a flowchart');
}

// The public @adrkit/mcp surface is only the sealed lifecycle handle.
const handle = mcp.createAdrkitMcpServer({ cwd: repoRoot, dir: 'docs/adr' });
if (Object.getPrototypeOf(handle) !== null) throw new Error('Installed MCP handle must be a null-prototype object');
if (!Object.isFrozen(handle)) throw new Error('Installed MCP handle must be frozen');
if (JSON.stringify(Object.getOwnPropertyNames(handle).sort()) !== JSON.stringify(['close', 'start'])) {
  throw new Error('Installed MCP handle must expose exactly start and close');
}
if (mcp.buildRegisteredServer !== undefined) throw new Error('Installed @adrkit/mcp must not export its internal builder');

const MCP_MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'smoke', version: '0' },
};

async function runMcpStdio(bin, cwd, era) {
  const proc = spawn(bin, ['--cwd', cwd], { stdio: ['pipe', 'pipe', 'inherit'] });
  const messages = new Map();
  const wanted = [2, 3, 4, 5, 6];
  let buffer = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP stdio smoke timed out (' + era + ' era)')), 20000);
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
    const _meta = era === 'modern' ? MCP_MODERN_META : undefined;
    const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: _meta ? { name, arguments: args, _meta } : { name, arguments: args } });
    const frames = era === 'modern'
      ? [
          { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta } },
          { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta } },
        ]
      : [
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        ];
    frames.push(
      call(3, 'search_decisions', { query: 'git' }),
      call(4, 'get_decision', { ref: '0001' }),
      call(5, 'get_decision_context', { files: ['README.md'] }),
      call(6, 'list_superseded', {}),
    );
    proc.stdin.write(frames.map((f) => JSON.stringify(f) + '\\n').join(''));
  });
  proc.stdin.end();
  proc.kill();
  for (const id of [1, 2, 3, 4, 5, 6]) {
    const error = messages.get(id)?.error;
    if (error) throw new Error('Installed adrkit-mcp answered id ' + id + ' with an error (' + era + ' era): ' + JSON.stringify(error));
  }
  const list = messages.get(2);
  // Asserted UNSORTED: tools/list order is wire-visible and deterministic.
  const names = (list?.result?.tools ?? []).map((t) => t.name);
  const expected = ['get_decision', 'get_decision_context', 'list_superseded', 'search_decisions'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Installed adrkit-mcp did not list the four tools in order (' + era + ' era): ' + names);
  if (era === 'modern') {
    const supported = messages.get(1)?.result?.supportedVersions ?? [];
    if (!supported.includes('2026-07-28')) throw new Error('Installed adrkit-mcp did not advertise 2026-07-28: ' + JSON.stringify(supported));
  }
  const outcomes = {};
  for (const id of [3, 4, 5, 6]) {
    const outcome = messages.get(id)?.result?.structuredContent?.result?.outcome;
    if (!outcome) throw new Error('Installed adrkit-mcp tool call ' + id + ' did not return a structured outcome (' + era + ' era)');
    outcomes[id] = outcome;
  }
  return outcomes;
}

const mcpBin = join(import.meta.dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'adrkit-mcp.cmd' : 'adrkit-mcp');
const legacyOutcomes = await runMcpStdio(mcpBin, repoRoot, 'legacy');
const modernOutcomes = await runMcpStdio(mcpBin, repoRoot, 'modern');
if (JSON.stringify(legacyOutcomes) !== JSON.stringify(modernOutcomes)) {
  throw new Error('Installed adrkit-mcp tool outcomes differ by protocol era: ' + JSON.stringify(legacyOutcomes) + ' vs ' + JSON.stringify(modernOutcomes));
}

const bin = join(import.meta.dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'adr.cmd' : 'adr');
const lint = spawnSync(bin, ['lint', join(repoRoot, 'docs/adr')], { cwd: repoRoot, encoding: 'utf8' });
if (lint.stdout) process.stdout.write(lint.stdout);
if (lint.stderr) process.stderr.write(lint.stderr);
if (lint.status !== 0) throw new Error(\`Installed adr lint failed with exit \${lint.status}\`);

const graphDir = join(repoRoot, 'docs/adr');
const graphDefault = spawnSync(bin, ['graph', '--dir', graphDir], { cwd: repoRoot, encoding: 'utf8' });
if (graphDefault.stderr) process.stderr.write(graphDefault.stderr);
if (graphDefault.status !== 0 || !graphDefault.stdout.startsWith('digraph adr {\\n')) {
  throw new Error('Installed adr graph default did not emit DOT');
}

const graphJson = spawnSync(bin, ['graph', '--dir', graphDir, '--focus', '0014', '--format', 'json'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (graphJson.stderr) process.stderr.write(graphJson.stderr);
if (graphJson.status !== 0) throw new Error(\`Installed adr graph JSON failed with exit \${graphJson.status}\`);
const graphPayload = JSON.parse(graphJson.stdout);
if (!graphPayload.nodes.some((node) => node.id === '0014')) {
  throw new Error('Installed adr graph JSON omitted the focus node');
}
if (!graphPayload.edges.every((edge) => edge.from === '0014' || edge.to === '0014')) {
  throw new Error('Installed adr graph JSON included an edge outside the focused neighborhood');
}

const graphKinds = spawnSync(
  bin,
  ['graph', '--dir', graphDir, '--kind', 'supersedes', '--format', 'json'],
  { cwd: repoRoot, encoding: 'utf8' },
);
if (graphKinds.stderr) process.stderr.write(graphKinds.stderr);
if (graphKinds.status !== 0) throw new Error(\`Installed adr graph kind filter failed with exit \${graphKinds.status}\`);
if (!JSON.parse(graphKinds.stdout).edges.every((edge) => edge.kind === 'supersedes')) {
  throw new Error('Installed adr graph kind filter emitted another relationship kind');
}

const graphMermaid = spawnSync(bin, ['graph', '--dir', graphDir, '--format', 'mermaid'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (graphMermaid.stderr) process.stderr.write(graphMermaid.stderr);
if (graphMermaid.status !== 0 || !graphMermaid.stdout.startsWith('flowchart LR\\n')) {
  throw new Error('Installed adr graph Mermaid did not emit a flowchart');
}

const graphTerminal = spawnSync(bin, ['graph', '--dir', graphDir, '--format', 'terminal'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (graphTerminal.stderr) process.stderr.write(graphTerminal.stderr);
if (graphTerminal.status !== 0 || !graphTerminal.stdout.includes('ADR decision graph')) {
  throw new Error('Installed adr graph terminal output was missing its heading');
}

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
  const only = resolveOnly(options.only);
  const version = validateSourceManifests(sourceManifests, options.tag, only);
  // Scope narrows what is packed and published; it never narrows what is
  // validated.
  const selected = only ? [only] : RELEASE_PACKAGES;

  if (!options.skipBuild) {
    await run([process.execPath, 'run', 'build'], RELEASE_ROOT, 'building release packages');
  }

  const artifacts: ReleaseArtifact[] = [];
  const versionOfDependency = (name: string): string => {
    const definition = RELEASE_PACKAGES.find((candidate) => candidate.name === name);
    assert(definition, `Unknown workspace dependency ${name}`);
    return versionFor(definition, sourceManifests, version);
  };

  for (const definition of selected) {
    const packageVersion = versionFor(definition, sourceManifests, version);
    // `npm pack` drops a leading `@` and turns the scope separator into a dash,
    // so `@adrkit/cli` becomes `adrkit-cli-<version>.tgz`. Strip only the `@`:
    // an unconditional `slice(1)` is indistinguishable from correct for every
    // scoped name and silently eats the first letter of an unscoped one. Every
    // release package is scoped again, so this is currently unobservable here —
    // it is kept, with a unit test, because the previous form was wrong rather
    // than merely unexercised, and the next unscoped name would inherit it.
    const filename = `${definition.name.replace(/^@/, '').replace('/', '-')}-${packageVersion}.tgz`;
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
    validatePackedManifest(definition, packedManifest, packageVersion, versionOfDependency);
    if (definition.name === '@adrkit/cli') {
      assert(packedManifest.bin?.adr === './dist/index.js', 'Packed CLI must expose the adr binary');
      assert(
        packedManifest.bin?.adrkit === './dist/index.js',
        'Packed CLI must expose the adrkit binary, which is the unambiguous alias for the `adr` name npm already assigns to an unrelated package',
      );
    }
    if (definition.name === '@adrkit/mcp') {
      assert(packedManifest.bin?.['adrkit-mcp'] === './dist/bin.js', 'Packed MCP must expose the adrkit-mcp binary');
    }
    artifacts.push({
      name: definition.name,
      version: packageVersion,
      tarball: relative(npmDir, tarball),
      integrity: await sha512Integrity(tarball),
    });
  }

  const releaseVersion = only ? versionFor(only, sourceManifests, version) : version;
  const tag = only ? releaseTagFor(only, releaseVersion) : `v${version}`;
  const manifest: ReleaseManifest = { version: releaseVersion, tag, artifacts };
  await Bun.write(join(npmDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // The smoke project imports the lockstep surface, so it is meaningless for an
  // adapter-only release — and an adapter that ships no JavaScript has nothing
  // for it to import in the first place.
  if (!options.skipSmokeInstall && !only) {
    await prepareSmokeProject(options.outputDir, artifacts);
  }
  console.log(`release-pack: prepared ${artifacts.length} package(s) for ${tag}`);
  return manifest;
}

if (import.meta.main) {
  await packRelease();
}
