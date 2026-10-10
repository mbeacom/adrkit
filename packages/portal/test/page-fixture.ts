/**
 * `portal-data.json` fixtures for the page tests, built by the real builder from a fake SDK
 * handle, so the render tests exercise builder and renderer together. Titles, bodies, tags,
 * paths, and routing targets carry hostile text that must come out as text.
 */

import type { CorpusIssue, DecisionRecord } from '@adrkit/sdk/src/index.ts';
import { buildPortalData } from '../src/data/build.ts';
import type { PortalData, PortalPathTable } from '../src/data/contract.ts';
import { fakeHandle, fakeQueueEntry, fakeRecord } from './fake-handle.ts';

export const COMMIT = 'a'.repeat(40);
export const HOSTILE_TITLE = '<img src=x onerror=alert(1)> Use "quotes" & <b>bold</b>';
export const SCRIPT_BODY = '<script>alert(document.cookie)</script>';

const BODY_0001 = [
  '# ADR-0001: The first',
  '',
  `Raw HTML stays text: ${SCRIPT_BODY} and <a href="javascript:alert(1)">a raw anchor</a>.`,
  '',
  'A [hostile link](javascript:alert(1)), a [data link](data:text/html,hi), an ![image alt](https://example.com/x.png),',
  'an [external link](https://example.com/docs), a [record link](./0002-decision.md), and a [jump](#options-considered).',
  '',
  '## Options considered',
  '',
  '| Option | Cost |',
  '| :----- | ---: |',
  '| A | 1 |',
  '',
  '```ts',
  'const x = "<b>not bold</b>";',
  '```',
  '',
  '> A quote with **strong** and *emphasis* and `code`.',
  '',
  '3. third',
  '4. fourth',
].join('\n');

export function records(): DecisionRecord[] {
  return [
    fakeRecord('0001', { title: HOSTILE_TITLE, status: 'superseded', standing: 'history', supersededBy: '0002', tags: ['<i>tag</i>'], body: BODY_0001 }),
    fakeRecord('0002', { supersedes: ['0001'], title: 'Second 👨‍👩‍👧‍👦 family emoji and a long title that must be clipped' }),
    fakeRecord('0003', { status: 'proposed', standing: 'activeProposals', title: 'Third, in review' }),
    fakeRecord('0004', { status: 'rejected', standing: 'history', title: 'Fourth' }),
  ];
}

export function pathTable(overrides: Partial<PortalPathTable> = {}): PortalPathTable {
  return {
    state: 'available',
    capped: false,
    caps: { count: 20000, bytes: 4194304 },
    governedPathCount: 2,
    entries: [
      { path: 'src/a.ts', governing: [{ id: '0002', evidence: ['affects', 'marker'] }], activeProposals: [{ id: '0003', evidence: ['affects'] }], history: [{ id: '0001', evidence: ['affects'] }] },
      { path: 'src/b.ts', governing: [{ id: '0002', evidence: ['affects'] }], activeProposals: [], history: [] },
    ],
    ...overrides,
  } as PortalPathTable;
}

export interface FixtureOptions {
  readonly records?: DecisionRecord[];
  readonly issues?: CorpusIssue[];
  readonly pathTable?: PortalPathTable;
  readonly commit?: string | null;
}

export function portalData(options: FixtureOptions = {}): PortalData {
  const handle = fakeHandle({
    records: options.records ?? records(),
    issues: options.issues ?? [],
    edges: [
      { from: '0002', to: '0001', kind: 'supersedes' },
      { from: '0003', to: '0002', kind: 'relatesTo' },
      { from: '0004', to: '0003', kind: 'conflictsWith' },
    ],
    entries: [
      fakeQueueEntry('0003', {
        title: 'Third <script>x</script>',
        routingTargets: ['@dave', '<b>@eve</b>'],
        approvalCount: 1,
        quorum: 2,
        unresolvedObjectionCount: 1,
        resolvedObjectionCount: 1,
        itemFindingCount: 2,
        slaState: 'overdue',
        deadline: '2026-07-11',
        tier: 'arb',
      }),
    ],
  });
  return buildPortalData(handle, {
    dir: 'docs/adr',
    commit: options.commit === undefined ? COMMIT : options.commit,
    asOf: '2026-10-10',
    pathTable: options.pathTable ?? pathTable(),
  });
}

/** A corpus with one error finding; its table is `unavailable`, as the generator writes it. */
export function brokenData(): PortalData {
  return portalData({
    issues: [{ code: 'frontmatter-parse', severity: 'error', message: 'Bad <b>frontmatter</b> in 0009', path: 'docs/adr/0009-broken.md' } as CorpusIssue],
    pathTable: { state: 'unavailable', reason: 'corpus-errors' },
  });
}
