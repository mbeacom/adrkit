import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { QueueItem, QueueReport } from '@adrkit/core';
import { createPresentation, stripAnsi } from '../src/presentation.ts';
import { acceptBlockers, renderTerminalQueue, resolveQueueFormat } from '../src/queue-terminal.ts';
import { terminalDisplayWidth } from '../src/terminal-text.ts';

const plain = createPresentation({ colorMode: 'never' }).stdout;
const color = createPresentation({ colorMode: 'always' }).stdout;

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: '0042',
    title: 'Adopt a thing',
    sourcePath: 'docs/adr/0042-adopt-a-thing.md',
    tier: 'async',
    tierLabel: 'asynchronous human review',
    queuedAt: '2026-01-01T00:00:00Z',
    slaDays: 14,
    reviewBy: null,
    slaState: 'within-sla',
    deadlineDate: '2026-01-15',
    routingTargets: ['@alice'],
    quorum: null,
    approvalCount: 0,
    unresolvedObjectionCount: 0,
    resolvedObjectionCount: 0,
    escalatedAt: null,
    decidedAt: null,
    itemFindings: [],
    ...overrides,
  };
}

function report(items: QueueItem[], extra: Partial<QueueReport> = {}): QueueReport {
  return {
    version: '1',
    asOf: '2026-01-08',
    corpusFingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    totalItems: items.length,
    totalCorpusFindings: 0,
    itemsWithFindings: items.filter((entry) => entry.itemFindings.length > 0).length,
    items,
    corpusFindings: [],
    ...extra,
  };
}

describe('queue terminal presentation', () => {
  test('auto resolves to terminal only on a TTY; explicit formats always win', () => {
    expect(resolveQueueFormat('auto', true)).toBe('terminal');
    expect(resolveQueueFormat('auto', false)).toBe('markdown');
    expect(resolveQueueFormat('markdown', true)).toBe('markdown');
    expect(resolveQueueFormat('terminal', false)).toBe('terminal');
  });

  test('prints the accept command when nothing blocks it, and the reason when something does', () => {
    const open = renderTerminalQueue(report([item()]), { columns: 100, style: plain });
    expect(open).toContain('next: adr accept 0042 --by <identity>');
    expect(open).toContain('within-sla · due 2026-01-15 (in 7 days)');

    const blocked = item({ unresolvedObjectionCount: 1, quorum: 2, approvalCount: 1, slaState: 'overdue', deadlineDate: '2026-01-01' });
    const output = renderTerminalQueue(report([blocked]), { columns: 100, style: plain });
    expect(output).not.toContain('adr accept');
    expect(output).toContain('blocked: 1 unresolved objection; 1 of 2 required approvals');
    expect(output).toContain('(7 days overdue)');
    expect(acceptBlockers(item({ quorum: 1, approvalCount: 1 }))).toEqual([]);
  });

  test('every line fits the budget at narrow widths, including wide and emoji titles', () => {
    const wide = item({
      title: '決定を記録する 🚀🚀 '.repeat(12),
      sourcePath: `docs/adr/0042-${'very-long-slug-'.repeat(10)}.md`,
      routingTargets: ['@alice', '@bob', '@carol', 'team:platform-architecture-review'],
      itemFindings: [{ code: 'queue.review-by-before-queued', severity: 'warn', message: 'reviewBy precedes queuedAt '.repeat(5) }],
    });
    for (const columns of [40, 60, 100]) {
      for (const style of [plain, color]) {
        const output = renderTerminalQueue(report([wide, item({ id: '0043' })]), { columns, style });
        for (const line of output.split('\n')) expect(terminalDisplayWidth(stripAnsi(line))).toBeLessThanOrEqual(columns);
      }
    }
  });

  test('corpus text cannot inject terminal escapes', () => {
    const hostile = item({ title: 'Evil \u001b[2J\u001b]0;pwned\u0007 title', routingTargets: ['@a\u001b[31m'] });
    const output = renderTerminalQueue(report([hostile]), { columns: 100, style: plain });
    expect(output).not.toContain('\u001b');
    expect(output).not.toContain('\u0007');
  });

  test('an empty queue says so', () => {
    expect(renderTerminalQueue(report([]), { columns: 80, style: plain })).toContain('No proposed records.');
  });

  test('--format terminal renders through the CLI, and a pipe still receives markdown by default', async () => {
    const cli = resolve(process.cwd(), 'packages/cli/src/index.ts');
    const dir = 'packages/core/test/fixtures/queue/comprehensive-corpus';
    const run = async (args: string[]) => {
      const proc = Bun.spawn([process.execPath, cli, 'queue', '--dir', dir, '--as-of', '2026-01-08', ...args], { stdout: 'pipe', stderr: 'pipe' });
      return { stdout: await new Response(proc.stdout).text(), exitCode: await proc.exited };
    };
    const terminal = await run(['--format', 'terminal']);
    expect(terminal.stdout.startsWith('ARB queue — as of 2026-01-08')).toBe(true);
    expect(terminal.stdout).toContain('Corpus findings');
    expect(terminal.exitCode).toBe(1);
    // 0010 is proposed with no deciders. Review state alone would allow it, but the
    // accepted record would be invalid, so the view must not advertise the command.
    const block0010 = terminal.stdout.slice(terminal.stdout.indexOf(' 0010 '));
    const item0010 = block0010.slice(0, block0010.indexOf('\n\n'));
    expect(item0010).not.toContain('adr accept 0010');
    expect(item0010).toContain('blocked:');
    expect(item0010).toContain('decider');
    const piped = await run([]);
    const markdown = await run(['--format', 'markdown']);
    expect(piped.stdout).toBe(markdown.stdout);
    expect(piped.stdout.startsWith('# ARB Queue — 2026-01-08')).toBe(true);
  });
});
