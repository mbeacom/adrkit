import { join, resolve } from 'node:path';
import type { ReleaseArtifact, ReleaseManifest } from './release-pack.ts';

const REPOSITORY_ROOT = resolve(import.meta.dir, '..');
const RELEASE_DIR = join(REPOSITORY_ROOT, '.release', 'npm');
const NPM_CLI_VERSION = '11.5.1';
const REGISTRY = 'https://registry.npmjs.org';
/**
 * Packages awaiting their first publish under this scope.
 *
 * npm Trusted Publishing cannot be configured for a name that does not exist
 * yet, so the very first publish of a new package needs a credential. Every
 * subsequent publish uses OIDC.
 *
 * **This set is empty, and that is the correct steady state.** A name belongs
 * here only between "the package does not exist on the registry" and "Trusted
 * Publishing is configured for it". Leaving one here afterwards keeps handing a
 * long-lived token to a package that no longer needs one — the credential
 * sprawl the set exists to bound. `@adrkit/mcp` was bootstrapped for 0.2.0 and
 * `@adrkit/spec-kit` for 0.1.0/0.1.1; both now publish over OIDC.
 */
const BOOTSTRAP_PACKAGES: ReadonlySet<string> = new Set();
type RegistryFetch = (url: string) => Promise<Response>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readManifest(): Promise<ReleaseManifest> {
  return JSON.parse(await Bun.file(join(RELEASE_DIR, 'manifest.json')).text()) as ReleaseManifest;
}

export async function existingIntegrity(
  artifact: ReleaseArtifact,
  fetcher: RegistryFetch = fetch,
): Promise<string | undefined> {
  const encodedName = encodeURIComponent(artifact.name);
  const response = await fetcher(`${REGISTRY}/${encodedName}/${artifact.version}`);
  if (response.status === 404) return undefined;
  assert(response.ok, `Registry lookup for ${artifact.name}@${artifact.version} failed with ${response.status}`);
  const metadata = (await response.json()) as { dist?: { integrity?: string } } | null;
  const integrity = metadata?.dist?.integrity;
  assert(integrity, `Registry metadata for ${artifact.name}@${artifact.version} has no integrity`);
  return integrity;
}

export function shouldPublishArtifact(
  artifact: ReleaseArtifact,
  registryIntegrity: string | undefined,
): boolean {
  if (!registryIntegrity) return true;
  assert(
    registryIntegrity === artifact.integrity,
    `${artifact.name}@${artifact.version} already exists with different integrity`,
  );
  return false;
}

/**
 * The tag a manifest must be published from.
 *
 * Split out so it is testable: the assertion used to rebuild `v${version}`
 * inline, which is right for a lockstep release and silently wrong for an
 * adapter released under `spec-kit-v0.1.0`.
 */
export function assertPublishTag(manifest: ReleaseManifest, refName: string | undefined): void {
  assert(
    refName === manifest.tag,
    `Tag ${refName ?? '(missing)'} must match ${manifest.tag}`,
  );
}

export function publishEnvironment(
  packageName: string,
  source: Record<string, string | undefined> = Bun.env,
): Record<string, string | undefined> {
  const environment = { ...source };
  const bootstrapToken = environment.NPM_BOOTSTRAP_TOKEN;
  delete environment.NPM_BOOTSTRAP_TOKEN;
  delete environment.NODE_AUTH_TOKEN;
  if (BOOTSTRAP_PACKAGES.has(packageName) && bootstrapToken) {
    environment.NODE_AUTH_TOKEN = bootstrapToken;
  }
  return environment;
}

async function npmPublish(artifact: ReleaseArtifact, dryRun: boolean): Promise<void> {
  const bunx = Bun.which('bunx');
  assert(bunx, 'bunx is required to run the OIDC-aware npm publishing client');
  const command = [
    bunx,
    '--package',
    `npm@${NPM_CLI_VERSION}`,
    'npm',
    'publish',
    join(RELEASE_DIR, artifact.tarball),
    '--access',
    'public',
  ];
  if (dryRun) command.push('--dry-run');
  else command.push('--provenance');
  const process = Bun.spawn(command, {
    cwd: REPOSITORY_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
    env: publishEnvironment(artifact.name),
  });
  const exitCode = await process.exited;
  assert(exitCode === 0, `Publishing ${artifact.name}@${artifact.version} failed with exit ${exitCode}`);
}

type IntegrityLookup = (artifact: ReleaseArtifact) => Promise<string | undefined>;
type ArtifactPublisher = (artifact: ReleaseArtifact, dryRun: boolean) => Promise<void>;

export async function publishArtifacts(
  artifacts: readonly ReleaseArtifact[],
  dryRun: boolean,
  lookupIntegrity: IntegrityLookup = existingIntegrity,
  publishArtifact: ArtifactPublisher = npmPublish,
): Promise<void> {
  for (const artifact of artifacts) {
    const integrity = await lookupIntegrity(artifact);
    if (!shouldPublishArtifact(artifact, integrity)) {
      console.log(`release-publish: ${artifact.name}@${artifact.version} already matches; skipping`);
      continue;
    }
    await publishArtifact(artifact, dryRun);
  }
}

export async function publishRelease(args = Bun.argv.slice(2)): Promise<void> {
  const unknownArgs = args.filter((argument) => argument !== '--dry-run');
  assert(unknownArgs.length === 0, `Unknown release-publish arguments: ${unknownArgs.join(', ')}`);
  const dryRun = args.includes('--dry-run');
  const manifest = await readManifest();

  if (!dryRun) {
    assert(Bun.env.GITHUB_ACTIONS === 'true', 'Real publication is restricted to GitHub Actions');
    assert(Bun.env.GITHUB_REF_TYPE === 'tag', 'Real publication requires a tag workflow');
    // The manifest carries its own tag: a lockstep release publishes from
    // `v0.3.0`, an adapter from `spec-kit-v0.1.0`. Rebuilding the expected tag
    // from the version here would silently reintroduce the lockstep assumption.
    assertPublishTag(manifest, Bun.env.GITHUB_REF_NAME);
  }

  await publishArtifacts(manifest.artifacts, dryRun);
}

if (import.meta.main) {
  await publishRelease();
}
