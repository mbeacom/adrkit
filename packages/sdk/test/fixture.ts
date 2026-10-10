/**
 * Fixture corpora for the `@adrkit/sdk` tests, built on core's test helpers so the records
 * are the same shapes every other package's tests use.
 */

import { join } from 'node:path';
import {
  acceptedRecordMarkdown,
  recordMarkdown,
  supersededRecordMarkdown,
  writeText,
} from '../../core/test/helpers.ts';

export function withAffects(markdown: string, ...patterns: string[]): string {
  const lines = ['affects:', ...patterns.flatMap((pattern) => ['  - type: path', `    pattern: "${pattern}"`])];
  return markdown.replace('affects: []', lines.join('\n'));
}

function proposedRecordMarkdown(id: string, title: string, review: string): string {
  return recordMarkdown(id, title, review).replace('status: draft', 'status: proposed');
}

/**
 * A healthy corpus that exercises every projection:
 *
 * - 0001 accepted, governs `src/sync/**` by pattern;
 * - 0002 accepted, governs nothing by pattern (declared by marker in the tests), relates to 0001;
 * - 0003 superseded by 0004, once governed `src/sync/**`;
 * - 0004 accepted, supersedes 0003, governs `src/sync/protocol.ts`;
 * - 0005 proposed, queued with an SLA, would govern `src/sync/**`, conflicts with 0004; quorum 2,
 *   two approvals that are one identity under casefold (`@alice`, `@Alice`), one resolved and
 *   one open objection, and no deciders (so one `item.deciders-empty` item finding);
 * - 0006 proposed, no review block at all (`not-queued`), routed to two deciders;
 * - 0007 draft, tagged;
 * - one nested markdown file discovery cannot see (a `warn`, not an error).
 *
 * Plus source files carrying inbound `@adr` markers.
 */
export async function writeHealthyCorpus(root: string): Promise<void> {
  const dir = join(root, 'docs/adr');
  await writeText(
    join(dir, '0001-use-the-sync-protocol.md'),
    withAffects(acceptedRecordMarkdown('0001', 'Use the sync protocol'), 'src/sync/**'),
  );
  await writeText(
    join(dir, '0002-retry-on-transient-failure.md'),
    acceptedRecordMarkdown('0002', 'Retry on transient failure').replace('relatesTo: []', 'relatesTo: ["0001"]'),
  );
  await writeText(
    join(dir, '0003-poll-for-changes.md'),
    withAffects(supersededRecordMarkdown('0003', '0004', 'Poll for changes'), 'src/sync/**'),
  );
  await writeText(
    join(dir, '0004-push-changes-over-websockets.md'),
    withAffects(
      acceptedRecordMarkdown('0004', 'Push changes over websockets', 'supersedes: ["0003"]\n'),
      'src/sync/protocol.ts',
    ),
  );
  await writeText(
    join(dir, '0005-batch-sync-writes.md'),
    withAffects(
      proposedRecordMarkdown(
        '0005',
        'Batch sync writes',
        'conflictsWith: ["0004"]\n' +
          'review:\n  tier: async\n  queuedAt: 2026-07-01T00:00:00Z\n  slaDays: 10\n  quorum: 2\n' +
          '  approvals: ["@alice", "@Alice"]\n' +
          '  objections:\n' +
          '    - by: "@bob"\n      summary: Batching hides write failures\n      resolved: true\n' +
          '    - by: "@carol"\n      summary: Needs a size cap\n',
      ),
      'src/sync/**',
    ),
  );
  await writeText(
    join(dir, '0006-adopt-a-queue.md'),
    proposedRecordMarkdown('0006', 'Adopt a queue', '').replace('deciders: []', 'deciders: ["@dave", "@erin"]'),
  );
  await writeText(
    join(dir, '0007-sketch-offline-mode.md'),
    recordMarkdown('0007', 'Sketch offline mode').replace('tags: []', 'tags: [offline, sync]'),
  );
  await writeText(join(dir, 'notes/0008-nested-record.md'), acceptedRecordMarkdown('0008', 'Hide below the corpus root'));

  await writeText(join(root, 'src/sync/retry.ts'), '// @adr 0002\nexport const retry = true;\n');
  await writeText(join(root, 'src/sync/protocol.ts'), 'export const protocol = 1;\n');
  await writeText(join(root, 'src/sync/stale.ts'), '// @adr 0003\nexport const stale = true;\n');
}

/**
 * A corpus that does not parse: one valid accepted record, one record with broken YAML,
 * and one record naming a supersession target that does not exist.
 */
export async function writeBrokenCorpus(root: string): Promise<void> {
  const dir = join(root, 'docs/adr');
  await writeText(
    join(dir, '0001-use-the-sync-protocol.md'),
    withAffects(acceptedRecordMarkdown('0001', 'Use the sync protocol'), 'src/sync/**'),
  );
  await writeText(join(dir, '0002-broken-yaml.md'), '---\nid: "0002"\ntitle: [unterminated\n---\n\n# Broken\n');
  await writeText(
    join(dir, '0003-replace-a-ghost.md'),
    recordMarkdown('0003', 'Replace a ghost', 'supersedes: ["0099"]\n'),
  );
  await writeText(join(root, 'src/sync/retry.ts'), '// @adr 0001\nexport const retry = true;\n');
}

/**
 * A corpus where two records share id 0001 — invalid (`unique-id`), but a consumer browsing it
 * must still see both, in the order `adr graph --format json` prints them, rather than one
 * record twice. 0002 relates to 0001 by id.
 */
export async function writeDuplicateIdCorpus(root: string): Promise<void> {
  const dir = join(root, 'docs/adr');
  await writeText(join(dir, '0001-first-title.md'), acceptedRecordMarkdown('0001', 'First title'));
  await writeText(join(dir, '0001-second-title.md'), acceptedRecordMarkdown('0001', 'Second title'));
  await writeText(join(dir, '0002-follow-up.md'), recordMarkdown('0002', 'Follow up').replace('relatesTo: []', 'relatesTo: ["0001"]'));
}
