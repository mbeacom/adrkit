/**
 * Build the catalog release asset for an adapter release.
 *
 * The Spec Kit community catalog installs an extension from a `.zip` attached to
 * a GitHub release (143 of the 144 entries at the time of writing). This derives
 * that zip from the already-packed, already-validated npm tarball rather than
 * re-walking the source tree, so the two artifacts cannot disagree about what
 * the extension contains.
 *
 * `package.json` is dropped: it exists for the Bun workspace and npm, and the
 * `--dev` install path already excludes it via `.extensionignore`. Shipping it
 * to a catalog consumer would put workspace metadata in their repository.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ReleaseManifest } from './release-pack.ts';

const RELEASE_ROOT = new URL('..', import.meta.url).pathname;
const RELEASE_DIR = join(RELEASE_ROOT, '.release');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The asset name for a scoped package: `@adrkit/spec-kit` -> `adrkit.zip`. */
export function assetNameFor(extensionId: string): string {
  assert(/^[a-z0-9-]+$/.test(extensionId), `Extension id ${extensionId} is not catalog-safe`);
  return `${extensionId}.zip`;
}

/** Files the catalog consumer must never receive, even though npm ships them. */
export const EXCLUDED_FROM_ASSET: readonly string[] = ['package.json'];

async function run(command: readonly string[], cwd: string): Promise<void> {
  const proc = Bun.spawn([...command], { cwd, stdout: 'inherit', stderr: 'inherit' });
  const exitCode = await proc.exited;
  assert(exitCode === 0, `${command[0]} failed with exit ${exitCode}`);
}

export async function packExtensionZip(): Promise<string> {
  const manifest = JSON.parse(
    await Bun.file(join(RELEASE_DIR, 'npm', 'manifest.json')).text(),
  ) as ReleaseManifest;

  assert(
    manifest.artifacts.length === 1,
    `A catalog asset is built for a single-adapter release; this manifest has ${manifest.artifacts.length} artifacts`,
  );
  const artifact = manifest.artifacts[0];
  assert(artifact, 'Release manifest has no artifact');

  const tarball = join(RELEASE_DIR, 'npm', artifact.tarball);
  const staging = await mkdtemp(join(tmpdir(), 'adrkit-asset-'));
  try {
    await run(['tar', '-xzf', tarball, '-C', staging], RELEASE_ROOT);
    const root = join(staging, 'package');

    const manifestYml = Bun.file(join(root, 'extension.yml'));
    assert(await manifestYml.exists(), 'Packed adapter has no extension.yml at its root');

    // Derive the id from the manifest the consumer will actually read.
    const parsed = Bun.YAML.parse(await manifestYml.text()) as {
      extension?: { id?: string };
    } | null;
    const id = parsed?.extension?.id;
    assert(typeof id === 'string' && id.length > 0, 'extension.yml declares no extension.id');

    for (const excluded of EXCLUDED_FROM_ASSET) {
      await rm(join(root, excluded), { force: true });
    }

    const assetPath = join(RELEASE_DIR, assetNameFor(id));
    await rm(assetPath, { force: true });
    // Zip from inside `package/` so extension.yml lands at the archive root,
    // which is where Spec Kit looks first.
    await run(['zip', '-q', '-r', '-X', assetPath, '.'], root);

    const entries = (
      await new Response(Bun.spawn(['unzip', '-Z1', assetPath]).stdout).text()
    )
      .split('\n')
      .filter(Boolean);
    assert(entries.includes('extension.yml'), 'Asset does not carry extension.yml at its root');
    for (const excluded of EXCLUDED_FROM_ASSET) {
      assert(!entries.includes(excluded), `Asset leaked ${excluded}`);
    }

    console.log(`pack-extension-zip: ${basename(assetPath)} (${entries.length} entries)`);
    return assetPath;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await packExtensionZip();
}
