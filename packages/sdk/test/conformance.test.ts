/**
 * `@adrkit/sdk` against the conformance fixture (ADR-0031 action item 6, ADR-0030 action
 * item 5, ADR-0053 action item 5): the committed corpus and the golden `adr queue --format
 * json` / `adr check --json` pair in `packages/core/test/conformance/golden/`.
 *
 * `packages/cli/test/conformance.test.ts` holds the CLI to the goldens byte for byte. This file
 * holds the SDK to the same goldens, so one artifact pins both contracts and a drift between
 * them — ADR-0031's "two contracts can drift" — fails here without a subprocess.
 *
 * The goldens are projected into the SDK's shapes field by field here; the SDK's own mappers
 * are not reused, because a test that maps both sides with the same code would pass however
 * wrong that code was.
 *
 * ADR-0016: observed failing. Mapping `deadline` from `queuedAt` failed the queue entries case;
 * dropping marker evidence in `governingFromExplained` failed the evidence case; and making
 * `governing()` skip `resolveSourceMarkers` failed the standing, evidence, and findings cases. Each
 * mutation in `src/decision-set.ts` was reverted.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDecisions, type DecisionSet, type DecisionStanding, type QueueEntry } from '../src/index.ts';

const FIXTURE = resolve(process.cwd(), 'packages/core/test/conformance/golden');

let manifest: { cwd: string; commands: Record<'queue' | 'check', { args: string[] }> };
let queueGolden: any;
let checkGolden: any;
let set: DecisionSet;
let asOf: string;
let checkPaths: string[];

beforeAll(async () => {
  manifest = JSON.parse(await readFile(resolve(FIXTURE, 'manifest.json'), 'utf8'));
  queueGolden = JSON.parse(await readFile(resolve(FIXTURE, 'queue.json'), 'utf8'));
  checkGolden = JSON.parse(await readFile(resolve(FIXTURE, 'check.json'), 'utf8'));
  const queueArgs = manifest.commands.queue.args;
  asOf = queueArgs[queueArgs.indexOf('--as-of') + 1] ?? '';
  // `check --json <paths...>`: every argument after the flags is a path.
  checkPaths = manifest.commands.check.args.filter((arg, index) => index > 0 && !arg.startsWith('--'));
  set = await openDecisions({ cwd: resolve(FIXTURE, manifest.cwd) });
});

describe('conformance fixture — queue()', () => {
  test('echoes the pinned as-of date', () => {
    expect(asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(set.queue({ asOf }).asOf).toBe(queueGolden.asOf);
  });

  test('entries are queue.json items, field by field', () => {
    const expected: QueueEntry[] = queueGolden.items.map((item: any) => ({
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
    }));
    expect(expected.length).toBeGreaterThan(0);
    expect(set.queue({ asOf }).entries).toEqual(expected);
  });

  test('issues are queue.json corpusFindings', () => {
    const expected = queueGolden.corpusFindings.map((finding: any) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      ...(finding.sourcePath === '' ? {} : { path: finding.sourcePath }),
    }));
    expect(set.queue({ asOf }).issues).toEqual(expected);
  });
});

describe('conformance fixture — governing() over check.json\'s paths', () => {
  async function governedByPath() {
    return Promise.all(checkPaths.map(async (path) => ({ path, view: await set.governing(path) })));
  }

  test('the same records land in the same standing', async () => {
    const views = await governedByPath();
    for (const standing of ['governing', 'activeProposals', 'history'] as DecisionStanding[]) {
      const sdk = new Set(views.flatMap(({ view }) => view[standing].map((decision) => decision.id)));
      const cli = new Set<string>(checkGolden[standing].map((decision: any) => decision.recordId));
      expect([...sdk].sort()).toEqual([...cli].sort());
    }
  });

  test('the same evidence reaches each record: affects matchers and marker lines', async () => {
    const views = await governedByPath();
    const sdk = new Map<string, Set<string>>();
    for (const { path, view } of views) {
      for (const decision of [...view.governing, ...view.activeProposals, ...view.history]) {
        const evidence = sdk.get(decision.id) ?? new Set<string>();
        for (const item of decision.matchedBy) {
          evidence.add(item.kind === 'affects' ? `affects ${item.type} ${item.pattern}` : `marker ${path}:${item.line}`);
        }
        sdk.set(decision.id, evidence);
      }
    }
    const cli = new Map<string, Set<string>>();
    for (const decision of checkGolden.governedBy) {
      cli.set(
        decision.recordId,
        new Set([
          ...decision.firedMatchers.map((matcher: any) => `affects ${matcher.type} ${matcher.pattern}`),
          ...(decision.declaredBy ?? []).map((declaration: any) => `marker ${declaration.path}:${declaration.line}`),
        ]),
      );
    }
    expect([...sdk.keys()].sort()).toEqual([...cli.keys()].sort());
    for (const [id, evidence] of cli) expect([...(sdk.get(id) ?? [])].sort()).toEqual([...evidence].sort());
  });

  test('check.json\'s findings are reported by governing() for the same path', async () => {
    const views = await governedByPath();
    expect(checkGolden.findings.length).toBeGreaterThan(0);
    for (const finding of checkGolden.findings) {
      const view = views.find(({ path }) => path === finding.path)?.view;
      expect(view?.issues).toContainEqual({ code: finding.rule, severity: finding.severity, message: finding.message, path: finding.path });
    }
  });

  test('a path check.json reports absent is an issue, not silence', async () => {
    expect(checkGolden.markerScan.absentPaths.length).toBeGreaterThan(0);
    for (const path of checkGolden.markerScan.absentPaths) {
      const view = await set.governing(path);
      expect(view.issues.map((issue) => issue.code)).toContain('marker-scan-absent');
    }
  });
});
