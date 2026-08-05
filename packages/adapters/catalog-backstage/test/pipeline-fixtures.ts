/**
 * Shared fixtures for the Phase E pipeline tests.
 *
 * # Every fixture runs against a real git checkout
 *
 * `repository/identity.ts` reads `git remote get-url origin` and `git rev-parse HEAD`
 * as subprocesses — the two reads `input-manifest.md` §5 permits. A fixture that
 * supplied those values instead of reading them would leave the one stage that touches
 * the outside world unexercised, and every "the full assembled pipeline" claim in
 * Phase E would quietly be about a pipeline with a stage stubbed out.
 *
 * So {@link createCheckout} initialises a real repository in a temporary directory: an
 * `origin` remote, one empty commit for `HEAD` to name. Descriptor files are written
 * into the worktree and **not** committed, so `HEAD` is stable while file content
 * varies — one checkout can therefore serve every case in a file.
 *
 * # No network, and nothing outside the temporary directory
 *
 * `git init`, `git remote add`, and `git commit --allow-empty` are all local. Nothing
 * here fetches, clones, or resolves a remote; the `origin` URL is a string in the git
 * config that is never contacted.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256Hex } from '../src/manifest/digests.ts';
import type { ManifestSource } from '../src/manifest/schema.ts';
import type { ProvenanceDeclaration } from '../src/envelope/provenance.ts';
import { allMaintainerOverlay } from '../src/envelope/provenance.ts';
import type { GenerationRequest } from '../src/pipeline.ts';

/** A temporary git checkout a fixture generates against. */
export interface Checkout {
  readonly root: string;
  /** The `origin` URL, verbatim as configured. */
  readonly remoteUrl: string;
  /** The normalized repository id the manifest should declare. */
  readonly repositoryId: string;
  /** `git rev-parse HEAD`. */
  readonly revision: string;
  /** Remove the temporary directory. */
  dispose(): Promise<void>;
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  return stdout.trim();
}

/**
 * Create a temporary git checkout with an `origin` remote and one commit.
 *
 * @param owner repository owner segment of the `origin` URL
 * @param repo repository name segment of the `origin` URL
 */
export async function createCheckout(owner = 'mbeacom', repo = 'adrkit-phase-e-fixture'): Promise<Checkout> {
  const root = await mkdtemp(join(tmpdir(), 'adrkit-catalog-'));
  const remoteUrl = `https://github.com/${owner}/${repo}.git`;

  await git(['init', '-q', '-b', 'main'], root);
  await git(['remote', 'add', 'origin', remoteUrl], root);
  await git(
    [
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'user.name=fixture',
      'commit',
      '--allow-empty',
      '-q',
      '-m',
      'fixture',
    ],
    root,
  );

  const revision = await git(['rev-parse', 'HEAD'], root);

  return {
    root,
    remoteUrl,
    repositoryId: `github.com/${owner}/${repo}`.toLowerCase(),
    revision,
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Write a file into the checkout and return the manifest source entry describing it. */
export async function writeSource(
  checkout: Checkout,
  relativePath: string,
  text: string,
): Promise<ManifestSource> {
  const absolute = join(checkout.root, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, text, 'utf8');
  return {
    path: relativePath,
    digestAlgorithm: 'sha256',
    digest: sha256Hex(new TextEncoder().encode(text)),
  };
}

/** Fields a fixture may override on the manifest it writes. */
export interface ManifestOverrides {
  readonly manifestSchemaVersion?: string;
  readonly requestedSnapshotSchemaVersion?: string;
  readonly requiredCapabilities?: readonly string[];
  readonly repository?: { readonly id?: string; readonly revision?: string };
  /** Replaces the whole serialized manifest. For malformed-input cases. */
  readonly rawText?: string;
  /** Merged into the manifest object before serialization. For unrecognized fields. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** Write a manifest naming `sources`, and return its path. */
export async function writeManifest(
  checkout: Checkout,
  sources: readonly ManifestSource[],
  overrides: ManifestOverrides = {},
  fileName = 'input-manifest.json',
): Promise<string> {
  const path = join(checkout.root, fileName);

  if (overrides.rawText !== undefined) {
    await writeFile(path, overrides.rawText, 'utf8');
    return path;
  }

  const manifest = {
    manifestSchemaVersion: overrides.manifestSchemaVersion ?? '1',
    requestedSnapshotSchemaVersion: overrides.requestedSnapshotSchemaVersion ?? '1',
    requiredCapabilities: overrides.requiredCapabilities ?? ['pathOwnership'],
    repository: {
      id: overrides.repository?.id ?? checkout.repositoryId,
      revision: overrides.repository?.revision ?? checkout.revision,
    },
    sources,
    ...overrides.extra,
  };

  await writeFile(path, JSON.stringify(manifest, null, 2), 'utf8');
  return path;
}

/** A YAML descriptor document's authored fields. */
export interface DescriptorSpec {
  readonly apiVersion?: string | undefined;
  readonly kind?: string | undefined;
  readonly name?: string | undefined;
  readonly namespace?: string | undefined;
  /** The raw `adrkit.io/owned-paths` annotation line's value, verbatim. */
  readonly ownedPaths?: string | undefined;
  /** Extra YAML appended verbatim, for duplicate keys and syntax faults. */
  readonly rawSuffix?: string | undefined;
}

/**
 * Render one descriptor document as YAML.
 *
 * The annotation value is emitted as a single-quoted scalar so a JSON array survives
 * intact — `owned-paths-annotation.md` §1 step 2 requires a YAML **string scalar**, and
 * an unquoted `["a/**"]` would parse as a sequence and be rejected at step 2, which is
 * a different case from the one most fixtures want.
 */
export function descriptor(spec: DescriptorSpec): string {
  const lines: string[] = [];
  if (spec.apiVersion !== undefined) lines.push(`apiVersion: ${spec.apiVersion}`);
  if (spec.kind !== undefined) lines.push(`kind: ${spec.kind}`);
  lines.push('metadata:');
  if (spec.name !== undefined) lines.push(`  name: ${spec.name}`);
  if (spec.namespace !== undefined) lines.push(`  namespace: ${spec.namespace}`);
  if (spec.ownedPaths !== undefined) {
    lines.push('  annotations:');
    lines.push(`    adrkit.io/owned-paths: '${spec.ownedPaths.replaceAll("'", "''")}'`);
  }
  if (spec.rawSuffix !== undefined) lines.push(spec.rawSuffix);
  return `${lines.join('\n')}\n`;
}

/** A well-formed `Component` descriptor, as the baseline every fixture varies from. */
export function validDescriptor(name: string, ownedPaths?: string): string {
  return descriptor({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    name,
    ...(ownedPaths === undefined ? {} : { ownedPaths }),
  });
}

/** Build a generation request over `sources`, declaring every one a maintainer overlay. */
export function request(
  checkout: Checkout,
  manifestPath: string,
  sources: readonly ManifestSource[],
  provenance?: ProvenanceDeclaration,
): GenerationRequest {
  return {
    manifestPath,
    checkoutRoot: checkout.root,
    provenance: provenance ?? allMaintainerOverlay(sources.map((source) => source.path)),
  };
}

/**
 * Write sources and a manifest, and return a ready request.
 *
 * The common path for a fixture that only wants "a valid run over these documents".
 */
export async function stage(
  checkout: Checkout,
  files: Readonly<Record<string, string>>,
  overrides: ManifestOverrides = {},
  manifestName?: string,
): Promise<{ readonly sources: readonly ManifestSource[]; readonly request: GenerationRequest }> {
  const sources: ManifestSource[] = [];
  for (const [path, text] of Object.entries(files)) {
    sources.push(await writeSource(checkout, path, text));
  }
  const manifestPath = await writeManifest(checkout, sources, overrides, manifestName);
  return { sources, request: request(checkout, manifestPath, sources) };
}
