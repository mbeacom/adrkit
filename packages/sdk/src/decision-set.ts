/**
 * `@adrkit/sdk` — the mapping layer.
 *
 * Everything here turns an `@adrkit/core` result into a shape declared in `./index.ts`.
 * That translation is the product (ADR-0031 clause 4): no core type crosses this file
 * into the public surface, and every SDK field is assigned by name rather than spread
 * from a core object, so a field core adds later does not leak through by accident.
 *
 * **One I/O boundary, stated.** `openDecisions` (in `./index.ts`) reads the corpus once.
 * After that, every member of the handle is a pure projection of the already-loaded
 * corpus, with one documented exception: {@link DecisionSet.governing} reads the header
 * window of the file at the supplied path for inbound `@adr` markers, through core's
 * confined reader, and only when `readMarkers` is not `false`. Nothing in this package
 * writes, spawns, or touches the network.
 *
 * Every projection mirrors the CLI command that answers the same question, call for
 * call, so the SDK and the CLI JSON describe the same decisions (ADR-0031 trade-off
 * "two contracts can drift"): `records`/`issues` follow `adr lint --json`, `queue` follows
 * `adr queue --format json`, `graph` follows `adr graph --format json` filtered with
 * `--kind` (supersession only by default), and `governing` follows `adr explain <path> --json`. `test/cli-equivalence.test.ts`
 * asserts each pairing against the real CLI.
 */

import {
  buildAdrGraph,
  buildQueueReport,
  bucketDecisions,
  decisionBucketFor,
  mergeSourceDeclarations,
  readSourceMarkers,
  resolveAffects,
  resolveAsOf,
  resolveSourceMarkers,
  sortFindings,
  toGoverningDecisions,
  type Adr,
  type CorpusFinding,
  type ExplainedDecision,
  type Finding,
  type LintCorpusResult,
  type QueueItem,
  type SourceMarkerScan,
} from '@adrkit/core';
import type {
  CorpusIssue,
  DecisionEdge,
  DecisionEdgeKind,
  DecisionGraph,
  DecisionRecord,
  DecisionSet,
  DecisionStanding,
  DecisionStatus,
  GovernanceEvidence,
  GoverningDecision,
  GoverningOptions,
  GraphOptions,
  PathGovernance,
  QueueEntry,
  QueueOptions,
  QueueView,
} from './index.ts';

/* ------------------------------------------------------------------ *
 * Core -> SDK mappers. Pure; exported for the mapping-layer unit tests only, and not
 * re-exported from the package entry point.
 * ------------------------------------------------------------------ */

/** A core lint `Finding` as a {@link CorpusIssue}. The rule name is the code, verbatim. */
export function issueFromFinding(finding: Finding): CorpusIssue {
  return Object.freeze({
    code: finding.rule,
    severity: finding.severity,
    message: finding.message,
    ...(finding.path === undefined ? {} : { path: finding.path }),
  });
}

/** A queue `CorpusFinding` as a {@link CorpusIssue}, keeping the queue's `corpus.*` code. */
export function issueFromCorpusFinding(finding: CorpusFinding): CorpusIssue {
  return Object.freeze({
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    ...(finding.sourcePath === '' ? {} : { path: finding.sourcePath }),
  });
}

/** One loaded core record, flattened, with its standing precomputed. */
export function recordFromAdr(adr: Adr): DecisionRecord {
  const frontmatter = adr.frontmatter;
  const status = frontmatter.status as DecisionStatus;
  return Object.freeze({
    id: frontmatter.id,
    title: frontmatter.title,
    status,
    standing: decisionBucketFor(status) as DecisionStanding,
    date: frontmatter.date,
    path: adr.path,
    tags: Object.freeze([...frontmatter.tags]),
    supersedes: Object.freeze([...frontmatter.supersedes]),
    ...(frontmatter.supersededBy === undefined ? {} : { supersededBy: frontmatter.supersededBy }),
    // Core's parser kept the text after the closing fence when `lintCorpus` read the file;
    // this is that string, not a second read.
    body: adr.body,
  });
}

/** One queue item as a {@link QueueEntry}. */
export function entryFromQueueItem(item: QueueItem): QueueEntry {
  return Object.freeze({
    id: item.id,
    title: item.title,
    path: item.sourcePath,
    tier: item.tier,
    slaState: item.slaState,
    deadline: item.deadlineDate,
    approvalCount: item.approvalCount,
    quorum: item.quorum,
    unresolvedObjectionCount: item.unresolvedObjectionCount,
    resolvedObjectionCount: item.resolvedObjectionCount,
    routingTargets: Object.freeze([...item.routingTargets]),
    itemFindingCount: item.itemFindings.length,
  });
}

/**
 * One explained decision as a {@link GoverningDecision}. Outbound `affects` evidence comes
 * first, in core's (sorted, de-duplicated) matcher order, then inbound marker evidence in
 * source-line order. The marker's path is dropped because it is always the path asked
 * about; its `ref` is dropped because it resolved to this record's id.
 */
export function governingFromExplained(decision: ExplainedDecision): GoverningDecision {
  const matchedBy: GovernanceEvidence[] = [
    ...decision.firedMatchers.map(
      (matcher): GovernanceEvidence => Object.freeze({ kind: 'affects', type: matcher.type, pattern: matcher.pattern }),
    ),
    ...(decision.declaredBy ?? []).map(
      (declaration): GovernanceEvidence => Object.freeze({ kind: 'marker', line: declaration.line }),
    ),
  ];
  return Object.freeze({
    id: decision.recordId,
    title: decision.title,
    status: decision.status as DecisionStatus,
    standing: decision.bucket as DecisionStanding,
    matchedBy: Object.freeze(matchedBy),
  });
}

/**
 * The scan state is reported because "the file declares no markers" and "the reader could
 * not look" must not render identically (ADR-0016). `adr explain --json` carries this as a
 * separate `markers.state` key; the SDK's `PathGovernance` has no such key, so a scan that
 * did not happen becomes an issue rather than silence.
 */
export function issueFromMarkerScan(scan: SourceMarkerScan): CorpusIssue | undefined {
  switch (scan.state) {
    case 'scanned':
      return undefined;
    case 'absent':
      return Object.freeze({
        code: 'marker-scan-absent',
        severity: 'info',
        message: 'No file exists at this path, so it was not scanned for inbound @adr markers; only affects matchers were evaluated.',
        path: scan.path,
      });
    case 'unreadable':
      return Object.freeze({
        code: 'marker-scan-unreadable',
        severity: 'warn',
        message: 'The file at this path could not be read, so inbound @adr markers were not scanned; governance may be incomplete.',
        path: scan.path,
      });
    case 'out-of-tree':
      return Object.freeze({
        code: 'marker-scan-out-of-tree',
        severity: 'warn',
        message: 'The path is not a repo-relative path inside the working tree, so inbound @adr markers were not scanned; governance may be incomplete.',
        path: scan.path,
      });
  }
}

/* ------------------------------------------------------------------ *
 * The handle.
 * ------------------------------------------------------------------ */

const BARE_CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `adr graph --kind`'s vocabulary, in the order a canonical cache key lists it. */
const EDGE_KINDS: readonly DecisionEdgeKind[] = ['supersedes', 'relatesTo', 'conflictsWith'];
const DEFAULT_EDGE_KINDS: readonly DecisionEdgeKind[] = ['supersedes'];

/**
 * The requested kinds as a canonical, de-duplicated list, so `['relatesTo', 'supersedes']`
 * and `['supersedes', 'relatesTo', 'supersedes']` share one cached graph.
 */
function resolveEdgeKinds(kinds: readonly DecisionEdgeKind[] | undefined): readonly DecisionEdgeKind[] {
  if (kinds === undefined) return DEFAULT_EDGE_KINDS;
  if (!Array.isArray(kinds) || kinds.length === 0) {
    throw new RangeError(
      `graph({ kinds }) must be a non-empty array of ${EDGE_KINDS.map((kind) => JSON.stringify(kind)).join(', ')}; received ${JSON.stringify(kinds)}.`,
    );
  }
  for (const kind of kinds) {
    if (!EDGE_KINDS.includes(kind)) {
      throw new RangeError(
        `graph({ kinds }) received an unknown edge kind ${JSON.stringify(kind)}; expected one of ${EDGE_KINDS.map((known) => JSON.stringify(known)).join(', ')}.`,
      );
    }
  }
  return EDGE_KINDS.filter((kind) => kinds.includes(kind));
}

/**
 * Today's UTC calendar date — `cli-contract.md` §As-Of Resolution's absent-input clause.
 *
 * Inlined, as it is in `packages/cli/src/queue.ts`, `packages/ci/src/queue-action-entrypoint.ts`,
 * and `packages/core/src/scaffold/new.ts`. This is the fourth copy, and ADR-0031 action item 8
 * (a publication gate for this package) exists to replace all four with one core export. It is
 * the one ambient read in the handle, and it happens only when the caller omits `asOf`.
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveQueueAsOf(asOf: string | undefined): string {
  if (asOf === undefined) return todayUtc();
  // The contract is a bare calendar date only. `resolveAsOf` also accepts zoned datetimes
  // for the CLI flag; the SDK deliberately does not, so the timezone question is answered
  // once, by the caller, rather than silently here.
  if (typeof asOf !== 'string' || !BARE_CALENDAR_DATE.test(asOf) || !resolveAsOf(asOf).ok) {
    throw new RangeError(
      `queue({ asOf }) must be a real UTC calendar date in YYYY-MM-DD form; received ${JSON.stringify(asOf)}.`,
    );
  }
  return asOf;
}

function emptyScan(path: string): SourceMarkerScan {
  return { path, state: 'scanned', markers: [], truncated: false };
}

/**
 * Build the handle over one `lintCorpus` result. `cwd` is the directory the corpus was
 * resolved against; marker scans are confined to it, as `adr explain` confines them to
 * its working directory.
 */
export function createDecisionSet(corpus: LintCorpusResult, cwd: string): DecisionSet {
  const records: readonly DecisionRecord[] = Object.freeze(corpus.records.map(recordFromAdr));
  const issues: readonly CorpusIssue[] = Object.freeze(sortFindings(corpus.findings).map(issueFromFinding));

  // Last wins for a duplicated id, matching `toGoverningDecisions`' own `new Map(...)` in
  // core, so `get(id)` and `governing(path)` name the same record when a corpus (invalidly)
  // carries two. The duplicate itself is reported in `issues` as `unique-id`.
  const byId = new Map<string, DecisionRecord>(records.map((record) => [record.id, record]));
  const hasCorpusError = corpus.findings.some((finding) => finding.severity === 'error');

  // One `buildAdrGraph` per handle, then one frozen graph per distinct kinds selection.
  let built: ReturnType<typeof buildAdrGraph> | undefined;
  let nodes: readonly DecisionRecord[] | undefined;
  const graphs = new Map<string, DecisionGraph>();

  return Object.freeze({
    records,
    issues,

    get(id: string): DecisionRecord | undefined {
      const exact = byId.get(id);
      if (exact !== undefined) return exact;
      // `31` -> `0031`: the corpus pads numeric ids to at least four digits.
      return /^\d{1,3}$/.test(id) ? byId.get(id.padStart(4, '0')) : undefined;
    },

    queue(options: QueueOptions = {}): QueueView {
      const asOf = resolveQueueAsOf(options.asOf);
      const report = buildQueueReport({ corpus, asOf });
      return Object.freeze({
        asOf: report.asOf,
        entries: Object.freeze(report.items.map(entryFromQueueItem)),
        issues: Object.freeze(report.corpusFindings.map(issueFromCorpusFinding)),
      });
    },

    graph(options: GraphOptions = {}): DecisionGraph {
      const kinds = resolveEdgeKinds(options.kinds);
      const key = kinds.join(',');
      const cached = graphs.get(key);
      if (cached !== undefined) return cached;

      built ??= buildAdrGraph(corpus.records);
      // Nodes are the already-mapped records in `buildAdrGraph`'s order — a stable sort by
      // `id.localeCompare`, restated here (build.ts) — which is what `adr graph --format json`
      // prints, and every record whatever the kinds: unlike `filterAdrGraph`, a kinds selection
      // never drops a record. Never looked up by id: a corpus that (invalidly) repeats an id
      // must show both records, as the CLI does, not the last one twice.
      nodes ??= Object.freeze(
        [...records].sort((a, b) => a.id.localeCompare(b.id)),
      );
      // A dangling target is dropped by core's graph builder and reported in `issues` by lint
      // (`dangling-supersedes`, `dangling-supersededBy`, and the `relatesTo`/`conflictsWith`
      // reference findings). Direction is core's: supersedes runs successor -> replaced.
      const wanted = new Set<string>(kinds);
      const edges = built.edges
        .filter((edge) => wanted.has(edge.kind))
        .map((edge): DecisionEdge => Object.freeze({ from: edge.from, to: edge.to, kind: edge.kind }));
      const graph: DecisionGraph = Object.freeze({ nodes, edges: Object.freeze(edges) });
      graphs.set(key, graph);
      return graph;
    },

    async governing(path: string, options: GoverningOptions = {}): Promise<PathGovernance> {
      // The marker scan runs before the corpus-error gate, as in `adr explain`, so the
      // scan state reported is the same fact either way.
      const scan = options.readMarkers === false ? emptyScan(path) : await readSourceMarkers(path, cwd);
      const scanIssue = issueFromMarkerScan(scan);
      const withScanIssue = (found: readonly CorpusIssue[]): readonly CorpusIssue[] =>
        Object.freeze(scanIssue === undefined ? [...found] : [...found, scanIssue]);

      // `adr explain`'s gate: a corpus with an error-severity finding answers with empty
      // groups and the corpus's own findings. A record that failed to load may be the one
      // that governs this path, so "nothing binds" would be a confident false negative.
      if (hasCorpusError) {
        return Object.freeze({
          path,
          governing: Object.freeze([]),
          activeProposals: Object.freeze([]),
          history: Object.freeze([]),
          issues: withScanIssue(issues),
        });
      }

      const resolution = resolveAffects({ records: corpus.records, changedFiles: [path] });
      const markerResolution = resolveSourceMarkers({ records: corpus.records, markers: scan.markers });
      const explained = mergeSourceDeclarations(
        toGoverningDecisions(corpus.records, resolution.matches),
        corpus.records,
        markerResolution.matches,
      );
      const buckets = bucketDecisions(explained);
      const findings = sortFindings([...resolution.findings, ...markerResolution.findings]);

      return Object.freeze({
        path,
        governing: Object.freeze(buckets.governing.map(governingFromExplained)),
        activeProposals: Object.freeze(buckets.activeProposals.map(governingFromExplained)),
        history: Object.freeze(buckets.history.map(governingFromExplained)),
        issues: withScanIssue(findings.map(issueFromFinding)),
      });
    },
  });
}
