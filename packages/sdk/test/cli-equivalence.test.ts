/**
 * `@adrkit/sdk` — the SDK and the CLI JSON describe the same decisions.
 *
 * ADR-0031 names this as its standing risk: "two contracts can drift from each other … and
 * nothing yet asserts they describe the same decisions." These tests are that assertion.
 * Each projection is compared with the real `adr` command answering the same question, run
 * as a subprocess against the same corpus: the two fixture corpora (one healthy, one that
 * does not parse) and this repository's own `docs/adr`.
 *
 * The comparison projects the CLI JSON into the SDK's shape field by field. It does not
 * reuse the SDK's mapping functions, because a test that maps both sides with the same code
 * would pass however wrong that code was.
 *
 * ADR-0016 clause 2: observed failing. Swapping `from`/`to` on the SDK's supersession edges
 * failed "graph edges ≡ adr graph … --kind supersedes edges" for the healthy fixture and this
 * repository; disabling `governing`'s corpus-error gate failed the broken fixture's explain
 * comparison; dropping marker evidence failed the `retry.ts` and `stale.ts` comparisons. Each
 * mutation was reverted. (The broken fixture has no valid supersession edge, so the edge swap
 * cannot show there — hence two edge failures, not three.)
 *
 * The additive fields (body, queue review counts, edge kinds) were observed failing the same
 * way, each mutation in `src/decision-set.ts` and reverted: mapping `unresolvedObjectionCount`
 * from the resolved count failed the healthy fixture's queue comparison; adding the routing
 * target count to `approvalCount` failed the healthy fixture's and this repository's queue
 * comparisons; hard-coding every edge's `kind` to `supersedes` failed the all-kinds and
 * per-kind edge comparisons for the healthy fixture and this repository (five tests);
 * defaulting `graph()` to all three kinds failed both `--kind supersedes` edge comparisons;
 * and trimming `body` failed the body comparison on all three corpora.
 *
 * The duplicate-id fixture was added against the code it exposes, before the fix: `graph()`
 * then built its nodes by looking each `buildAdrGraph` node id up in an id map (last wins), and
 * "graph nodes ≡ adr graph --format json nodes" failed for that fixture with the SDK giving
 * `Second title` twice where the CLI gives `First title`, `Second title`. Nodes are now the
 * mapped records in `buildAdrGraph`'s stable id order.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanupTestDir, resetTestDir } from '../../core/test/helpers.ts';
import { openDecisions, type CorpusIssue, type DecisionSet, type GoverningDecision } from '../src/index.ts';
import { writeBrokenCorpus, writeDuplicateIdCorpus, writeHealthyCorpus } from './fixture.ts';

const REPO_ROOT = resolve(process.cwd());
const CLI_PATH = resolve(REPO_ROOT, 'packages/cli/src/index.ts');
const HEALTHY = 'sdk-equivalence-healthy';
const BROKEN = 'sdk-equivalence-broken';
const DUPLICATE = 'sdk-equivalence-duplicate';
const AS_OF = '2026-07-05';

async function adrJson(args: string[], cwd: string): Promise<{ json: any; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { json: JSON.parse(stdout), exitCode };
}

/** A CLI lint/check `Finding` in the SDK's issue shape: the rule is the code, verbatim. */
function issueOf(finding: { rule: string; severity: string; message: string; path?: string }): CorpusIssue {
  return {
    code: finding.rule,
    severity: finding.severity as CorpusIssue['severity'],
    message: finding.message,
    ...(finding.path === undefined ? {} : { path: finding.path }),
  };
}

function decisionOf(decision: any): GoverningDecision {
  return {
    id: decision.recordId,
    title: decision.title,
    status: decision.status,
    standing: decision.bucket,
    matchedBy: [
      ...decision.firedMatchers.map((matcher: any) => ({ kind: 'affects', type: matcher.type, pattern: matcher.pattern })),
      ...(decision.declaredBy ?? []).map((declaration: any) => ({ kind: 'marker', line: declaration.line })),
    ],
  };
}

interface Corpus {
  name: string;
  cwd: () => string;
  set: () => DecisionSet;
  explainPaths: string[];
}

let healthyRoot = '';
let brokenRoot = '';
let duplicateRoot = '';
let healthy: DecisionSet;
let broken: DecisionSet;
let duplicate: DecisionSet;
let repository: DecisionSet;

beforeAll(async () => {
  healthyRoot = await resetTestDir(HEALTHY);
  brokenRoot = await resetTestDir(BROKEN);
  duplicateRoot = await resetTestDir(DUPLICATE);
  await writeHealthyCorpus(healthyRoot);
  await writeBrokenCorpus(brokenRoot);
  await writeDuplicateIdCorpus(duplicateRoot);
  [healthy, broken, duplicate, repository] = await Promise.all([
    openDecisions({ cwd: healthyRoot }),
    openDecisions({ cwd: brokenRoot }),
    openDecisions({ cwd: duplicateRoot }),
    openDecisions({ cwd: REPO_ROOT }),
  ]);
});

afterAll(async () => {
  await cleanupTestDir(HEALTHY);
  await cleanupTestDir(BROKEN);
  await cleanupTestDir(DUPLICATE);
});

const CORPORA: Corpus[] = [
  {
    name: 'healthy fixture',
    cwd: () => healthyRoot,
    set: () => healthy,
    explainPaths: ['src/sync/protocol.ts', 'src/sync/retry.ts', 'src/sync/stale.ts', 'src/sync/absent.ts', 'README.md'],
  },
  {
    name: 'broken fixture',
    cwd: () => brokenRoot,
    set: () => broken,
    explainPaths: ['src/sync/retry.ts'],
  },
  {
    name: 'duplicate-id fixture',
    cwd: () => duplicateRoot,
    set: () => duplicate,
    explainPaths: ['src/anything.ts'],
  },
  {
    name: "this repository's docs/adr",
    cwd: () => REPO_ROOT,
    set: () => repository,
    explainPaths: [
      'packages/sdk/src/index.ts',
      'packages/cli/src/index.ts',
      'packages/core/src/index.ts',
      'scripts/release-pack.ts',
      'docs/adr/0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md',
    ],
  },
];

for (const corpus of CORPORA) {
  describe(`SDK ≡ CLI JSON — ${corpus.name}`, () => {
    test('issues ≡ adr lint --json findings', async () => {
      const { json } = await adrJson(['lint', '--json'], corpus.cwd());
      expect(corpus.set().issues).toEqual(json.findings.map(issueOf));
    });

    test('queue ≡ adr queue --format json', async () => {
      const { json } = await adrJson(['queue', '--format', 'json', '--as-of', AS_OF], corpus.cwd());
      const view = corpus.set().queue({ asOf: AS_OF });
      expect(view.asOf).toBe(json.asOf);
      expect(view.entries).toEqual(
        json.items.map((item: any) => ({
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
          routingTargets: item.routingTargets,
          itemFindingCount: item.itemFindings.length,
        })),
      );
      expect(view.issues).toEqual(
        json.corpusFindings.map((finding: any) => ({
          code: finding.code,
          severity: finding.severity,
          message: finding.message,
          path: finding.sourcePath,
        })),
      );
    });

    // Nodes are every record, as unfiltered `adr graph` prints them; `--kind supersedes`
    // would also drop the records no supersession edge touches, which a consumer browsing
    // the corpus still needs. Edges are the supersession edges `--kind supersedes` prints.
    test('graph nodes ≡ adr graph --format json nodes', async () => {
      const { json } = await adrJson(['graph', '--format', 'json'], corpus.cwd());
      const graph = corpus.set().graph();
      expect(graph.nodes.map(({ id, title, status }) => ({ id, title, status }))).toEqual(json.nodes);
    });

    // `graph()` with no options is supersession only, as it was enumerated; each kinds
    // selection is compared with the `--kind` filter that names the same kinds, and all three
    // with unfiltered `adr graph`, which prints every kind.
    const edgeOf = (edge: any) => ({ from: edge.from, to: edge.to, kind: edge.kind });

    test('graph edges ≡ adr graph --format json --kind supersedes edges', async () => {
      const { json } = await adrJson(['graph', '--format', 'json', '--kind', 'supersedes'], corpus.cwd());
      expect(corpus.set().graph().edges).toEqual(json.edges.map(edgeOf));
    });

    test('graph({ kinds: all three }) edges ≡ adr graph --format json edges', async () => {
      const { json } = await adrJson(['graph', '--format', 'json'], corpus.cwd());
      const edges = corpus.set().graph({ kinds: ['supersedes', 'relatesTo', 'conflictsWith'] }).edges;
      expect(edges).toEqual(json.edges.map(edgeOf));
    });

    for (const kind of ['relatesTo', 'conflictsWith'] as const) {
      test(`graph({ kinds: ['${kind}'] }) edges ≡ adr graph --format json --kind ${kind} edges`, async () => {
        const { json } = await adrJson(['graph', '--format', 'json', '--kind', kind], corpus.cwd());
        expect(corpus.set().graph({ kinds: [kind] }).edges).toEqual(json.edges.map(edgeOf));
      });
    }

    // No CLI command prints a record's body, so the equivalence is with the file itself: the
    // text after the line that closes the frontmatter, split here by hand rather than with
    // core's parser, for the same reason the CLI side is not mapped with the SDK's mappers.
    test('record bodies ≡ each file after its closing frontmatter fence', async () => {
      for (const record of corpus.set().records) {
        const source = await readFile(resolve(corpus.cwd(), record.path), 'utf8');
        const lines = source.split('\n');
        expect(lines[0]?.replace(/\r$/, '')).toBe('---');
        const closing = lines.findIndex((line, index) => index > 0 && line.replace(/\r$/, '') === '---');
        expect(closing).toBeGreaterThan(0);
        expect(record.body).toBe(lines.slice(closing + 1).join('\n'));
      }
    });

    test('records ≡ adr graph --format json nodes, in the same order', async () => {
      const { json } = await adrJson(['graph', '--format', 'json'], corpus.cwd());
      const fromSdk = corpus.set().records.map(({ id, title, status }) => ({ id, title, status }));
      expect(fromSdk).toEqual(json.nodes);
    });

    for (const path of corpus.explainPaths) {
      test(`governing(${path}) ≡ adr explain --json`, async () => {
        const { json } = await adrJson(['explain', path, '--json'], corpus.cwd());
        const result = await corpus.set().governing(path);
        expect(result.path).toBe(json.path);
        expect(result.governing).toEqual(json.governing.map(decisionOf));
        expect(result.activeProposals).toEqual(json.activeProposals.map(decisionOf));
        expect(result.history).toEqual(json.history.map(decisionOf));

        // The CLI reports the scan state under a separate `markers` key; the SDK has no such
        // key and reports a scan that did not happen as an issue instead.
        const scanIssues = result.issues.filter((issue) => issue.code.startsWith('marker-scan-'));
        const otherIssues = result.issues.filter((issue) => !issue.code.startsWith('marker-scan-'));
        expect(otherIssues).toEqual(json.findings.map(issueOf));
        expect(scanIssues.map((issue) => issue.code)).toEqual(
          json.markers.state === 'scanned' ? [] : [`marker-scan-${json.markers.state}`],
        );
      });
    }
  });
}

test('get(id) on a duplicated id returns the last record, as governing resolves it', () => {
  expect(duplicate.records.map((record) => record.title)).toEqual(['First title', 'Second title', 'Follow up']);
  expect(duplicate.get('0001')?.title).toBe('Second title');
});

test('the comparison is not vacuous', () => {
  // Every assertion above would pass on two empty answers. These pin that the corpora under
  // comparison actually contain what the comparison is about.
  expect(repository.records.length).toBeGreaterThan(40);
  expect(repository.graph().edges.length).toBeGreaterThan(0);
  expect(healthy.queue({ asOf: AS_OF }).entries.length).toBeGreaterThan(0);
  for (const kind of ['relatesTo', 'conflictsWith'] as const) {
    expect(healthy.graph({ kinds: [kind] }).edges.length).toBeGreaterThan(0);
  }
  expect(repository.graph({ kinds: ['relatesTo'] }).edges.length).toBeGreaterThan(0);
  const entries = healthy.queue({ asOf: AS_OF }).entries;
  expect(entries.some((entry) => entry.approvalCount > 0 && entry.resolvedObjectionCount > 0)).toBe(true);
  expect(entries.some((entry) => entry.unresolvedObjectionCount > 0 && entry.itemFindingCount > 0)).toBe(true);
  expect(entries.some((entry) => entry.routingTargets.length > 0)).toBe(true);
  expect(repository.records.every((record) => record.body.length > 0)).toBe(true);
  expect(broken.issues.filter((issue) => issue.severity === 'error').length).toBeGreaterThan(0);
  expect(duplicate.graph().nodes.map((node) => node.title)).toEqual(['First title', 'Second title', 'Follow up']);
  expect(duplicate.issues.map((issue) => issue.code)).toContain('unique-id');
});
