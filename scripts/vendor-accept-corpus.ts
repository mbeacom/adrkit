/**
 * T086a — **one-time acquisition** of the frozen accept corpus's descriptor files.
 *
 * # Why this script exists
 *
 * `evidence/accept-corpus-freeze/accept-corpus-freeze.json` freezes the corpus's
 * *metadata* — the repository, the commit, the 24 selected `sourcePath` values, the
 * maintainer-authored overlay, and the expected path matches. It does **not** contain
 * the descriptor files themselves, and `evidence/README.md` §4 is explicit that it must
 * not: the freeze tree carries no `InputManifest` and no corpus the generator could
 * read, because R5 mechanism 1 (input absence) depends on that.
 *
 * Phase E recorded the consequence rather than working around it
 * (`packages/adapters/catalog-backstage/test/sc-009.test.ts`, SC-009 limb 2): the
 * descriptors are not present in this repository, so no pass over the frozen accept
 * corpus is possible. T088 diffs "every annotated entity in the frozen accept corpus"
 * and cannot run without them either.
 *
 * This script closes that gap by vendoring the 24 selected descriptors verbatim.
 *
 * # What is vendored, and what deliberately is not
 *
 * **Pristine upstream bytes only.** ADR-0020 clause 5 requires the descriptors be
 * "authored upstream and **otherwise unmodified**", and that is provable by digest only
 * if what lands on disk is byte-identical to what upstream published. The
 * maintainer-authored `adrkit.io/owned-paths` overlay is therefore **not** baked into
 * these files. It stays where the freeze put it — `accept-corpus-freeze/overlay.json` —
 * and is applied by the comparison harness at generation time, into an ephemeral run
 * directory that is deleted afterwards.
 *
 * Pre-merging the two would destroy the boundary `data-model.md` §10's `provenance`
 * field exists to make legible: no reader could tell by inspection which bytes are
 * upstream and which are ours. The freeze already separates them; this preserves that.
 *
 * # What "verify against the digest" means here, stated precisely
 *
 * **The freeze records no per-descriptor digest.** Its only recorded hashes are the two
 * artifact-level `contentHash` values (`evidence/README.md` §3), which cover the frozen
 * metadata, not the corpus bytes. Asserting otherwise would be a claim about an artifact
 * that does not carry it, so it is stated plainly instead.
 *
 * What the freeze *does* fix is a **commit pin**: `corpusRef.commit`. A git commit names
 * exactly one tree, which names exactly one blob per path, and a git blob id is a
 * content-addressed digest of that blob's bytes. Three checks follow from that, and all
 * three abort rather than warn:
 *
 * 1. **Tree completeness.** The recursive tree listing must not be truncated. A
 *    truncated listing could silently omit a selected path, and "not found" would then be
 *    indistinguishable from "not fetched".
 * 2. **Corpus-fact agreement.** The number of blobs whose basename is exactly
 *    `catalog-info.yaml` must equal `corpusFacts.descriptorFilesExactBasename` — a figure
 *    the freeze re-derived from this pin. A pin that moved, or a fetch that resolved
 *    somewhere else, changes this number.
 * 3. **Per-blob content address.** For every selected path, the git blob id is
 *    **recomputed from the received bytes** — `sha1("blob " + byteLength + "\0" + bytes)`
 *    — and compared to the id the pinned tree records. The recomputation is over what
 *    arrived, never a transcription of what was claimed; `data-model.md` §16's rule ("an
 *    audit that transcribes the author's declared hash has verified nothing") applies to
 *    a fetch exactly as it applies to an audit.
 *
 * Any mismatch means the pin moved or the fetch is wrong. Neither is something to paper
 * over, so this script exits non-zero and writes nothing.
 *
 * # The offline posture (FR-018, FR-052) is not weakened by this
 *
 * Fetching a corpus is an **acquisition step**, not part of a generation run. It happens
 * once, by hand, and its output is committed. The generator remains offline,
 * credential-free and network-free: it reads one local manifest and the local files that
 * manifest names.
 *
 * The separation is kept structural rather than asserted. This module is not imported by
 * the adapter, by the comparison harness, or by anything either of them reaches;
 * `scripts/vendor-accept-corpus.test.ts` asserts exactly that, by scanning source rather
 * than by trusting this paragraph.
 *
 * # Honesty
 *
 * Vendoring corpus **data** is not validation. Per ADR-0014's honesty rules and
 * `evidence/README.md` §5, only the corpus data is third-party; the overlay, the expected
 * paths, the audit and every check here are the maintainer's own. This work sits at
 * ADR-0014 **rung 1**: not reference-verified (rung 2), not externally validated (rung 3).
 *
 * @see `specs/010-catalog-backstage/evidence/accept-corpus-freeze/accept-corpus-freeze.json`
 * @see `docs/adr/0020-rescope-sc-010-and-authorize-work-toward-the-backstage-catalog-adapter.md` clause 5
 * @see `docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md`
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository-relative location of the vendored corpus. */
export const CORPUS_DIR = 'specs/010-catalog-backstage/corpus';

/** The vendor manifest's file name, inside {@link CORPUS_DIR}. */
export const VENDOR_MANIFEST_NAME = 'VENDOR-MANIFEST.json';

/** Repository-relative location of the freeze this script reads its inputs from. */
export const FREEZE_PATH =
  'specs/010-catalog-backstage/evidence/accept-corpus-freeze/accept-corpus-freeze.json';

/** Exact basename a corpus descriptor file must have, per the freeze's selection rule. */
export const DESCRIPTOR_BASENAME = 'catalog-info.yaml';

/** Reasons this script aborts. Each is asserted verbatim by the test. */
export const REASON_TREE_TRUNCATED =
  'the pinned tree listing came back truncated, so a missing path cannot be distinguished from an unfetched one';
export const REASON_DESCRIPTOR_COUNT =
  'the number of exact-basename descriptor files at the pin does not match the freeze-recorded corpusFacts.descriptorFilesExactBasename';
export const REASON_PATH_ABSENT = 'a selected sourcePath is not a blob in the pinned tree';
export const REASON_BLOB_DIGEST_MISMATCH =
  'the git blob id recomputed from the received bytes does not match the id the pinned tree records';

/** One vendored file, as recorded in the vendor manifest. */
export interface VendoredFile {
  /** Repository-relative path **inside the upstream corpus**, verbatim from the freeze. */
  readonly path: string;
  /** The pinned tree's blob id, recomputed from the received bytes and matched against it. */
  readonly gitBlobSha1: string;
  /** Lowercase-hex SHA-256 of the received bytes, for drift detection after vendoring. */
  readonly sha256: string;
  readonly byteLength: number;
}

export interface VendorPlan {
  readonly repository: string;
  readonly commit: string;
  readonly selectedPaths: readonly string[];
  readonly descriptorFilesExactBasename: number;
}

/** Anything this script refuses to proceed past. */
export class VendorAbort extends Error {
  constructor(
    readonly reason: string,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'VendorAbort';
  }
}

interface TreeEntry {
  readonly path: string;
  readonly type: string;
  readonly sha: string;
}

interface TreeResponse {
  readonly tree: readonly TreeEntry[];
  readonly truncated: boolean;
}

/**
 * Read the freeze and derive everything this script needs from it.
 *
 * Nothing about the corpus is hard-coded here: the repository, the commit, the selected
 * paths and the descriptor-file count all come out of the frozen artifact, so a script
 * run against a different freeze acquires that freeze's corpus and checks that freeze's
 * facts.
 */
export function planFromFreeze(freeze: unknown): VendorPlan {
  if (typeof freeze !== 'object' || freeze === null) {
    throw new VendorAbort('freeze-unreadable', 'the freeze artifact is not a JSON object');
  }
  const record = freeze as Record<string, unknown>;

  const corpusRef = record['corpusRef'] as Record<string, unknown> | undefined;
  const repository = corpusRef?.['repository'];
  const commit = corpusRef?.['commit'];
  if (typeof repository !== 'string' || typeof commit !== 'string') {
    throw new VendorAbort('freeze-unreadable', 'corpusRef.repository / corpusRef.commit missing');
  }

  const facts = record['corpusFacts'] as Record<string, unknown> | undefined;
  const descriptorFilesExactBasename = facts?.['descriptorFilesExactBasename'];
  if (typeof descriptorFilesExactBasename !== 'number') {
    throw new VendorAbort(
      'freeze-unreadable',
      'corpusFacts.descriptorFilesExactBasename missing, so the pin cannot be cross-checked',
    );
  }

  const expected = record['expectedPaths'];
  if (!Array.isArray(expected)) {
    throw new VendorAbort('freeze-unreadable', 'expectedPaths is not an array');
  }
  const paths = new Set<string>();
  for (const entry of expected) {
    const sourcePath = (entry as Record<string, unknown>)['sourcePath'];
    if (typeof sourcePath !== 'string') {
      throw new VendorAbort('freeze-unreadable', 'an expectedPaths entry has no string sourcePath');
    }
    paths.add(sourcePath);
  }

  return {
    repository,
    commit,
    // Ascending UTF-16 code-unit order, matching the repository's own comparator, so the
    // vendor manifest's order is a function of content rather than of iteration.
    selectedPaths: [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    descriptorFilesExactBasename,
  };
}

/**
 * Git's own content address for a blob: `sha1("blob " + byteLength + "\0" + bytes)`.
 *
 * Recomputed from the bytes that arrived. This is the check that makes "otherwise
 * unmodified" provable rather than asserted.
 */
export function gitBlobId(bytes: Uint8Array): string {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const hasher = new Bun.CryptoHasher('sha1');
  hasher.update(header);
  hasher.update(bytes);
  return hasher.digest('hex');
}

export function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex');
}

/** Whether a tree path names a descriptor file under the freeze's exact-basename rule. */
export function isDescriptorPath(path: string): boolean {
  return path === DESCRIPTOR_BASENAME || path.endsWith(`/${DESCRIPTOR_BASENAME}`);
}

/**
 * Check the pinned tree against the freeze before a single blob is fetched.
 *
 * Ordered so the cheapest, most diagnostic failure comes first. Returns the tree entries
 * for the selected paths, in the plan's order.
 */
export function resolveSelected(plan: VendorPlan, tree: TreeResponse): readonly TreeEntry[] {
  if (tree.truncated) {
    throw new VendorAbort(REASON_TREE_TRUNCATED, `${plan.repository}@${plan.commit}`);
  }

  const blobs = tree.tree.filter((entry) => entry.type === 'blob');
  const descriptors = blobs.filter((entry) => isDescriptorPath(entry.path));
  if (descriptors.length !== plan.descriptorFilesExactBasename) {
    throw new VendorAbort(
      REASON_DESCRIPTOR_COUNT,
      `freeze records ${plan.descriptorFilesExactBasename}, the pin yields ${descriptors.length}`,
    );
  }

  const byPath = new Map(blobs.map((entry) => [entry.path, entry] as const));
  const selected: TreeEntry[] = [];
  for (const path of plan.selectedPaths) {
    const entry = byPath.get(path);
    if (entry === undefined) throw new VendorAbort(REASON_PATH_ABSENT, path);
    selected.push(entry);
  }
  return selected;
}

/**
 * Verify one fetched blob against the id the pinned tree records.
 *
 * Separated from the fetch so the check is testable without a network, which is the only
 * way to observe it failing (ADR-0016).
 */
export function verifyBlob(entry: TreeEntry, bytes: Uint8Array): VendoredFile {
  const recomputed = gitBlobId(bytes);
  if (recomputed !== entry.sha) {
    throw new VendorAbort(
      REASON_BLOB_DIGEST_MISMATCH,
      `${entry.path}: pinned tree records ${entry.sha}, received bytes hash to ${recomputed}`,
    );
  }
  return {
    path: entry.path,
    gitBlobSha1: recomputed,
    sha256: sha256Hex(bytes),
    byteLength: bytes.byteLength,
  };
}

// ── Everything below this line touches the network, and nothing above it does. ────────

function apiHeaders(): Record<string, string> {
  const token = Bun.env['GH_TOKEN'] ?? Bun.env['GITHUB_TOKEN'];
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'adrkit-vendor-accept-corpus',
    'x-github-api-version': '2022-11-28',
    ...(token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` }),
  };
}

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: apiHeaders() });
  if (!response.ok) {
    throw new VendorAbort('github-api-error', `${response.status} ${response.statusText} for ${url}`);
  }
  return (await response.json()) as T;
}

async function fetchTree(plan: VendorPlan): Promise<TreeResponse> {
  const [, owner, repo] = plan.repository.split('/');
  return await api<TreeResponse>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${plan.commit}?recursive=1`,
  );
}

async function fetchBlob(plan: VendorPlan, sha: string): Promise<Uint8Array> {
  const [, owner, repo] = plan.repository.split('/');
  const blob = await api<{ content?: string; encoding?: string }>(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
  );
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') {
    throw new VendorAbort('github-api-error', `blob ${sha} did not come back base64-encoded`);
  }
  return Uint8Array.from(Buffer.from(blob.content, 'base64'));
}

async function main(repoRoot: string): Promise<void> {
  const freeze = JSON.parse(await readFile(join(repoRoot, FREEZE_PATH), 'utf8')) as unknown;
  const plan = planFromFreeze(freeze);

  console.log(`vendor-accept-corpus: pin ${plan.repository}@${plan.commit}`);
  const tree = await fetchTree(plan);
  const selected = resolveSelected(plan, tree);
  console.log(
    `vendor-accept-corpus: pin verified — ${plan.descriptorFilesExactBasename} descriptor files, ` +
      `${selected.length} selected`,
  );

  // Fetch and verify EVERY blob before writing ANY of them. A partial vendoring is a
  // corpus that looks complete and is not, which is worse than none at all.
  const fetched: { readonly entry: TreeEntry; readonly bytes: Uint8Array; readonly record: VendoredFile }[] =
    [];
  for (const entry of selected) {
    const bytes = await fetchBlob(plan, entry.sha);
    fetched.push({ entry, bytes, record: verifyBlob(entry, bytes) });
  }

  const corpusRoot = join(repoRoot, CORPUS_DIR);
  for (const { entry, bytes } of fetched) {
    const destination = join(corpusRoot, entry.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }

  const manifest = {
    '//': `T086a — one-time acquisition record for the ADR-0020 clause-5 accept corpus. Written by scripts/vendor-accept-corpus.ts. The files below are PRISTINE upstream bytes: the maintainer-authored adrkit.io/owned-paths overlay is NOT applied here and lives in ${'evidence/accept-corpus-freeze/overlay.json'}, applied by the comparison harness into an ephemeral run directory.`,
    task: 'T086a',
    barrierSide: 'BEHIND',
    corpusRef: { repository: plan.repository, commit: plan.commit },
    verification: {
      freezeRecordsNoPerFileDigest:
        'The freeze records artifact-level contentHash values only (evidence/README.md §3); it records no per-descriptor digest. Stated rather than implied.',
      whatWasVerified: [
        'the recursive tree listing at the pin was not truncated',
        `the pin yields exactly ${plan.descriptorFilesExactBasename} blobs whose basename is exactly ${DESCRIPTOR_BASENAME}, matching corpusFacts.descriptorFilesExactBasename`,
        'for every file below, the git blob id was RECOMPUTED from the received bytes and matched against the id the pinned tree records',
      ],
      gitBlobIdDefinition: 'sha1("blob " + byteLength + "\\0" + bytes), lowercase hex',
      abortsOnMismatch:
        'Any mismatch exits non-zero and writes nothing. A mismatch means the pin moved or the fetch is wrong; neither is papered over.',
    },
    honesty: {
      rung: 'ADR-0014 rung 1 only. Vendoring corpus data is acquisition, not validation.',
      thirdPartyBoundary:
        'Only the corpus DATA is third-party. The overlay, the expected paths, the audit and every check are the maintainer\u2019s own (evidence/README.md §5).',
      offlinePosture:
        'This script is a one-time acquisition step and is not reachable from the generator or the comparison harness. Generation itself requires no network, no credential and no service (FR-018, FR-052).',
    },
    fileCount: fetched.length,
    files: fetched.map(({ record }) => record),
  };

  await writeFile(
    join(corpusRoot, VENDOR_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log(`vendor-accept-corpus: wrote ${fetched.length} descriptors to ${CORPUS_DIR}/`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main(process.cwd());
  } catch (error) {
    if (error instanceof VendorAbort) {
      console.error(`vendor-accept-corpus: ABORTED — ${error.message}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
