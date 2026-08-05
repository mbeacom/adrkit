/**
 * T086a — checks on the vendored accept corpus and on the acquisition script.
 *
 * Two jobs, and they are different:
 *
 * 1. **The vendored tree is what it claims to be.** Every file's git blob id is
 *    recomputed from the bytes on disk and matched against the vendor manifest, and
 *    every file is confirmed to carry **no** `adrkit.io/owned-paths` annotation. The
 *    second check is the one that matters most: if the overlay ever got baked into the
 *    vendored files, ADR-0020 clause 5's "otherwise unmodified" would stop being provable
 *    and `data-model.md` §10's upstream/maintainer boundary would stop being legible.
 *    Nothing here needs a network.
 *
 * 2. **The acquisition step stays separated from generation.** FR-018 and FR-052 require
 *    the generator to need no network, no credential and no service, and to not degrade
 *    to a networked path when one is available. Fetching a corpus is a one-time
 *    acquisition, not part of a run — so this asserts, by scanning source, that nothing
 *    the adapter or the comparison harness reaches imports this script.
 *
 * Every rule here is driven against an input that must trip it, per ADR-0016. The
 * verification helpers are pure, so a digest mismatch and a truncated tree are both
 * reachable without a network and without touching anything on disk.
 */

import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  importSpecifiers,
  stripComments,
} from '../packages/adapters/catalog-backstage/test/source-scan.ts';
import {
  CORPUS_DIR,
  DESCRIPTOR_BASENAME,
  REASON_BLOB_DIGEST_MISMATCH,
  REASON_DESCRIPTOR_COUNT,
  REASON_PATH_ABSENT,
  REASON_TREE_TRUNCATED,
  VENDOR_MANIFEST_NAME,
  VendorAbort,
  gitBlobId,
  isDescriptorPath,
  planFromFreeze,
  resolveSelected,
  sha256Hex,
  verifyBlob,
} from './vendor-accept-corpus.ts';

const REPO_ROOT = process.cwd();
const CORPUS_ROOT = join(REPO_ROOT, CORPUS_DIR);
const FREEZE = join(
  REPO_ROOT,
  'specs/010-catalog-backstage/evidence/accept-corpus-freeze/accept-corpus-freeze.json',
);

interface VendorManifest {
  readonly corpusRef: { readonly repository: string; readonly commit: string };
  readonly fileCount: number;
  readonly files: readonly {
    readonly path: string;
    readonly gitBlobSha1: string;
    readonly sha256: string;
    readonly byteLength: number;
  }[];
}

async function readManifest(): Promise<VendorManifest> {
  return JSON.parse(await readFile(join(CORPUS_ROOT, VENDOR_MANIFEST_NAME), 'utf8')) as VendorManifest;
}

async function readFreeze(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(FREEZE, 'utf8')) as Record<string, unknown>;
}

async function descriptorFiles(): Promise<string[]> {
  const entries = (await readdir(CORPUS_ROOT, { recursive: true })).map(String);
  return entries
    .filter((entry) => entry.endsWith(DESCRIPTOR_BASENAME))
    .map((entry) => entry.split('\\').join('/'))
    .sort();
}

describe('T086a — the vendored corpus matches the pin the freeze records', () => {
  test('the vendor manifest names the freeze\u2019s corpusRef, not some other pin', async () => {
    const [manifest, freeze] = await Promise.all([readManifest(), readFreeze()]);
    const corpusRef = freeze['corpusRef'] as { repository: string; commit: string };
    expect(manifest.corpusRef.repository).toBe(corpusRef.repository);
    expect(manifest.corpusRef.commit).toBe(corpusRef.commit);
  });

  test('exactly the freeze\u2019s selected sourcePaths are vendored \u2014 no more, no fewer', async () => {
    const freeze = await readFreeze();
    const selected = new Set(
      (freeze['expectedPaths'] as { sourcePath: string }[]).map((entry) => entry.sourcePath),
    );
    const vendored = new Set(await descriptorFiles());
    expect([...vendored].sort()).toEqual([...selected].sort());
    // `size` is the freeze's own recorded corpus size; the vendored FILE count matches it
    // here only because each selected entity comes from a distinct file. Entity DOCUMENT
    // count is a different number and is checked by the comparison harness, not here.
    expect(vendored.size).toBe(freeze['size'] as number);
  });

  test('every vendored file hashes to the git blob id the manifest records', async () => {
    const manifest = await readManifest();
    expect(manifest.files.length).toBe(manifest.fileCount);
    expect(manifest.files.length).toBeGreaterThan(0);

    for (const file of manifest.files) {
      const bytes = new Uint8Array(await Bun.file(join(CORPUS_ROOT, file.path)).arrayBuffer());
      expect(gitBlobId(bytes)).toBe(file.gitBlobSha1);
      expect(sha256Hex(bytes)).toBe(file.sha256);
      expect(bytes.byteLength).toBe(file.byteLength);
    }
  });

  test('no vendored descriptor carries the overlay annotation \u2014 the boundary is on disk', async () => {
    // The single most important property of the vendored tree. The maintainer-authored
    // overlay lives in evidence/accept-corpus-freeze/overlay.json and is applied at
    // generation time into an ephemeral run directory. A vendored file carrying it would
    // make ADR-0020 clause 5's "otherwise unmodified" unprovable by digest and would
    // erase the upstream/maintainer boundary data-model.md §10 exists to keep legible.
    const files = await descriptorFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(join(CORPUS_ROOT, file), 'utf8');
      expect(text).not.toContain('adrkit.io/owned-paths');
    }
  });

  test('the freeze\u2019s overlay is still a separate artifact carrying every annotation', async () => {
    const overlay = JSON.parse(
      await readFile(
        join(REPO_ROOT, 'specs/010-catalog-backstage/evidence/accept-corpus-freeze/overlay.json'),
        'utf8',
      ),
    ) as { overlay: readonly { annotationValue: string }[] };
    // 23, not 24: the freeze records one `annotation-absent` entity, which by definition
    // has no overlay entry. Read from accept-corpus-freeze.json's
    // overlayProvenance.entries and ownershipStatesExercised.
    expect(overlay.overlay.length).toBe(23);
  });
});

describe('T086a — the plan is derived from the freeze, never hard-coded', () => {
  test('planFromFreeze reads repository, commit, selected paths and the descriptor count', async () => {
    const plan = planFromFreeze(await readFreeze());
    expect(plan.repository).toBe('github.com/backstage/community-plugins');
    expect(plan.commit).toBe('92e9e4e09c76cc57f3475029b73e5ec84498a459');
    expect(plan.selectedPaths.length).toBe(24);
    // 156 exact-basename descriptor FILES at the pin, from the freeze's
    // corpusFacts.descriptorFilesExactBasename. That is not the 167 entity DOCUMENTS,
    // and not the 24 selected.
    expect(plan.descriptorFilesExactBasename).toBe(156);
  });

  test('selectedPaths are in ascending code-unit order, so the manifest is content-ordered', async () => {
    const plan = planFromFreeze(await readFreeze());
    const sorted = [...plan.selectedPaths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(plan.selectedPaths).toEqual(sorted);
  });

  test('a freeze with no corpusRef is refused rather than defaulted', () => {
    expect(() => planFromFreeze({ expectedPaths: [] })).toThrow(VendorAbort);
  });
});

describe('T086a — observed failing: each abort fires on an input built to trip it', () => {
  const plan = {
    repository: 'github.com/example/corpus',
    commit: 'a'.repeat(40),
    selectedPaths: ['one/catalog-info.yaml'],
    descriptorFilesExactBasename: 2,
  } as const;

  const tree = {
    truncated: false,
    tree: [
      { path: 'one/catalog-info.yaml', type: 'blob', sha: 'b'.repeat(40) },
      { path: 'two/catalog-info.yaml', type: 'blob', sha: 'c'.repeat(40) },
      { path: 'one', type: 'tree', sha: 'd'.repeat(40) },
    ],
  } as const;

  test('the baseline resolves, so the failures below are not vacuous', () => {
    const selected = resolveSelected(plan, tree);
    expect(selected.map((entry) => entry.path)).toEqual(['one/catalog-info.yaml']);
  });

  test('a truncated tree listing aborts', () => {
    expect(() => resolveSelected(plan, { ...tree, truncated: true })).toThrow(REASON_TREE_TRUNCATED);
  });

  test('a descriptor-file count that disagrees with the freeze aborts', () => {
    expect(() => resolveSelected({ ...plan, descriptorFilesExactBasename: 3 }, tree)).toThrow(
      REASON_DESCRIPTOR_COUNT,
    );
  });

  test('a selected path missing from the pinned tree aborts', () => {
    expect(() =>
      resolveSelected({ ...plan, selectedPaths: ['three/catalog-info.yaml'] }, tree),
    ).toThrow(REASON_PATH_ABSENT);
  });

  test('a blob whose recomputed id differs from the pinned id aborts, and the reason names both', () => {
    const bytes = new TextEncoder().encode('kind: Component\n');
    const entry = { path: 'one/catalog-info.yaml', type: 'blob', sha: 'f'.repeat(40) };
    expect(() => verifyBlob(entry, bytes)).toThrow(REASON_BLOB_DIGEST_MISMATCH);
    try {
      verifyBlob(entry, bytes);
    } catch (error) {
      expect((error as Error).message).toContain('f'.repeat(40));
      expect((error as Error).message).toContain(gitBlobId(bytes));
    }
  });

  test('a blob whose recomputed id matches is accepted, so the check is not always-fail', () => {
    const bytes = new TextEncoder().encode('kind: Component\n');
    const record = verifyBlob({ path: 'p', type: 'blob', sha: gitBlobId(bytes) }, bytes);
    expect(record.gitBlobSha1).toBe(gitBlobId(bytes));
    expect(record.byteLength).toBe(bytes.byteLength);
  });

  test('gitBlobId agrees with git\u2019s own hash-object on a real vendored file', async () => {
    // The recomputation is only worth anything if it is git's definition and not a
    // plausible-looking variant. Checked against `git hash-object` itself.
    const manifest = await readManifest();
    const file = manifest.files[0];
    expect(file).toBeDefined();
    const proc = Bun.spawn(['git', 'hash-object', file!.path], {
      cwd: CORPUS_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(file!.gitBlobSha1);
  });

  test('isDescriptorPath matches the exact basename rule and nothing adjacent to it', () => {
    expect(isDescriptorPath('catalog-info.yaml')).toBe(true);
    expect(isDescriptorPath('a/b/catalog-info.yaml')).toBe(true);
    expect(isDescriptorPath('a/catalog-info.yml')).toBe(false);
    expect(isDescriptorPath('a/my-catalog-info.yaml')).toBe(false);
    expect(isDescriptorPath('a/catalog-info.yaml.bak')).toBe(false);
  });
});

describe('T086a — acquisition is not reachable from generation (FR-018, FR-052)', () => {
  /** Every `.ts` file under a directory, repository-relative and forward-slashed. */
  async function sources(directory: string): Promise<string[]> {
    const entries = (await readdir(join(REPO_ROOT, directory), { recursive: true })).map(String);
    return entries
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => `${directory}/${entry}`.split('\\').join('/'))
      .sort();
  }

  /**
   * Files this scan deliberately skips, because they contain the rule literals themselves
   * and would match their own patterns.
   *
   * The same relief valve `test/source-scan.ts` documents and for the same reason: "a file
   * that *states* a rule is indistinguishable to it from a file that *breaks* one. Adding
   * an entry is the correct fix and is preferred over renaming around the scanner." The
   * list is named and asserted rather than filtered inline, so it cannot grow quietly.
   */
  const EXCLUDED_FROM_HOST_SCAN: readonly string[] = [
    // Must name the corpus host in order to assert that only one file names it.
    'scripts/vendor-accept-corpus.test.ts',
  ];

  test('the exclusion list is exactly one file, and that file exists', async () => {
    expect(EXCLUDED_FROM_HOST_SCAN).toEqual(['scripts/vendor-accept-corpus.test.ts']);
    expect(await Bun.file(join(REPO_ROOT, EXCLUDED_FROM_HOST_SCAN[0] as string)).exists()).toBe(true);
  });

  test('no adapter source or test IMPORTS the acquisition script', async () => {
    // Import specifiers, not prose. Phase E's sc-009 test names this script in a doc
    // comment explaining where the corpus came from, and a text scan cannot tell that
    // apart from a real import. `stripComments` + `importSpecifiers` are the adapter's
    // own scanning primitives — one authority for "what does this file import".
    const files = await sources('packages/adapters/catalog-backstage');
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(await readFile(join(REPO_ROOT, file), 'utf8'));
      if (importSpecifiers(code).some((specifier) => specifier.includes('vendor-accept-corpus'))) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the scan can see a violation, so an empty result means "looked and found nothing"', () => {
    // ADR-0016 clause 3: a scan that silently examined nothing reports the same green as
    // one that looked properly. Driven against a fixture that must trip it.
    const fixture = "import { gitBlobId } from '../../../scripts/vendor-accept-corpus.ts';\n";
    expect(
      importSpecifiers(stripComments(fixture)).some((one) => one.includes('vendor-accept-corpus')),
    ).toBe(true);
    // And a doc comment naming the script is NOT a violation, which is the distinction
    // the prose-based version of this check got wrong.
    const commentOnly = '/** see scripts/vendor-accept-corpus.ts */\nexport const x = 1;\n';
    expect(
      importSpecifiers(stripComments(commentOnly)).some((one) => one.includes('vendor-accept-corpus')),
    ).toBe(false);
  });

  test('the comparison harness does not import the acquisition script either', async () => {
    const code = stripComments(
      await readFile(join(REPO_ROOT, 'scripts/compare-accept-corpus.ts'), 'utf8'),
    );
    const imports = importSpecifiers(code);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier).not.toContain('vendor-accept-corpus');
    }
  });

  test('the acquisition script imports nothing from the adapter, so the split is two-way', async () => {
    const code = stripComments(
      await readFile(join(REPO_ROOT, 'scripts/vendor-accept-corpus.ts'), 'utf8'),
    );
    const imports = importSpecifiers(code);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier.startsWith('node:')).toBe(true);
    }
  });

  test('exactly one script names the corpus host, and it is the acquisition script', async () => {
    // A weaker guard than the import checks and stated as such: it catches a second
    // fetcher being added beside the generator, not every conceivable route to a network.
    const files = (await sources('scripts')).filter(
      (file) => !EXCLUDED_FROM_HOST_SCAN.includes(file),
    );
    const fetchers: string[] = [];
    for (const file of files) {
      const text = await readFile(join(REPO_ROOT, file), 'utf8');
      if (text.includes('https://api.github.com')) fetchers.push(file);
    }
    expect(fetchers).toEqual(['scripts/vendor-accept-corpus.ts']);
  });
});
