import { describe, expect, test } from 'bun:test';
import type { QueueReport } from '@adrkit/core';
import {
  MARKER,
  managedQueueIssue,
  publishQueueReport,
  type GitHubQueueClient,
} from '../src/queue-issue.ts';

type Issue = { number: number; state: 'open' | 'closed'; title: string; body: string | null };

interface Recorder {
  created: Array<{ title: string; body: string }>;
  updated: Array<{ issueNumber: number; update: { body: string; state?: 'open' } }>;
}

function fakeClient(issues: Issue[], throwOn?: { on: 'create' | 'update'; status: number }): {
  client: GitHubQueueClient;
  rec: Recorder;
} {
  const rec: Recorder = { created: [], updated: [] };
  const client: GitHubQueueClient = {
    async listAllIssues() {
      return issues.map((i) => ({ ...i }));
    },
    async createIssue(title, body) {
      if (throwOn?.on === 'create') throw Object.assign(new Error('forbidden'), { status: throwOn.status });
      rec.created.push({ title, body });
      return { number: 999 };
    },
    async updateIssue(issueNumber, update) {
      if (throwOn?.on === 'update') throw Object.assign(new Error('forbidden'), { status: throwOn.status });
      rec.updated.push({ issueNumber, update });
    },
  };
  return { client, rec };
}

const REPORT = 'REPORT BODY';

describe('managedQueueIssue — state machine', () => {
  test('(A) 0 managed + no conflict → createIssue once, marker is exactly the first line', async () => {
    const { client, rec } = fakeClient([]);
    const result = await managedQueueIssue(REPORT, client, 'ADR ARB Queue');
    expect(result.issueNumber).toBe(999);
    expect(rec.created).toHaveLength(1);
    expect(rec.updated).toHaveLength(0);
    expect(rec.created[0]!.body.split('\n')[0]).toBe(MARKER);
    expect(rec.created[0]!.body).toBe(`${MARKER}\n${REPORT}`);
  });

  test('(B) 0 managed + 1 open title conflict → fail naming #N, no write', async () => {
    const { client, rec } = fakeClient([{ number: 5, state: 'open', title: 'ADR ARB Queue', body: 'unrelated' }]);
    await expect(managedQueueIssue(REPORT, client, 'ADR ARB Queue')).rejects.toThrow('#5');
    expect(rec.created).toHaveLength(0);
    expect(rec.updated).toHaveLength(0);
  });

  test('(C) 0 managed + 1 closed title conflict → fail, no write', async () => {
    const { client, rec } = fakeClient([{ number: 7, state: 'closed', title: 'ADR ARB Queue', body: 'unrelated' }]);
    await expect(managedQueueIssue(REPORT, client, 'ADR ARB Queue')).rejects.toThrow('#7');
    expect(rec.created).toHaveLength(0);
  });

  test('(D) 0 managed + 2 conflicts (open+closed) → names all ascending, no write', async () => {
    const { client, rec } = fakeClient([
      { number: 9, state: 'closed', title: 'ADR ARB Queue', body: 'x' },
      { number: 3, state: 'open', title: 'ADR ARB Queue', body: 'y' },
    ]);
    await expect(managedQueueIssue(REPORT, client, 'ADR ARB Queue')).rejects.toThrow('#3, #9');
    expect(rec.created).toHaveLength(0);
    expect(rec.updated).toHaveLength(0);
  });

  test('(E) 1 managed open → updateIssue({body}) only (no state field)', async () => {
    const { client, rec } = fakeClient([{ number: 42, state: 'open', title: 'ADR ARB Queue', body: `${MARKER}\nold` }]);
    const result = await managedQueueIssue(REPORT, client, 'ADR ARB Queue');
    expect(result.issueNumber).toBe(42);
    expect(rec.updated).toEqual([{ issueNumber: 42, update: { body: `${MARKER}\n${REPORT}` } }]);
  });

  test('(F) 1 managed closed → single updateIssue({body, state:open})', async () => {
    const { client, rec } = fakeClient([{ number: 8, state: 'closed', title: 'ADR ARB Queue', body: MARKER }]);
    await managedQueueIssue(REPORT, client, 'ADR ARB Queue');
    expect(rec.updated).toEqual([{ issueNumber: 8, update: { body: `${MARKER}\n${REPORT}`, state: 'open' } }]);
  });

  test('(G) 2+ managed → fail naming both, no write', async () => {
    const { client, rec } = fakeClient([
      { number: 11, state: 'open', title: 'ADR ARB Queue', body: MARKER },
      { number: 4, state: 'open', title: 'ADR ARB Queue', body: MARKER },
    ]);
    await expect(managedQueueIssue(REPORT, client, 'ADR ARB Queue')).rejects.toThrow('#4, #11');
    expect(rec.updated).toHaveLength(0);
  });
});

describe('managedQueueIssue — marker detection', () => {
  const cases: Array<[string, string | null, boolean]> = [
    ['(H) body === MARKER', MARKER, true],
    ['(I) MARKER + LF', `${MARKER}\nbody`, true],
    ['(I2) MARKER + CRLF', `${MARKER}\r\nbody`, true],
    ['(I3) MARKER + CR', `${MARKER}\rbody`, true],
    ['(J) marker on line 2', `intro\n${MARKER}`, false],
    ['(K) leading whitespace', ` ${MARKER}`, false],
    ['null body', null, false],
  ];

  for (const [name, body, managed] of cases) {
    test(`${name} → ${managed ? 'managed (update)' : 'not managed (create)'}`, async () => {
      const { client, rec } = fakeClient([{ number: 1, state: 'open', title: 'Other', body }]);
      await managedQueueIssue(REPORT, client, 'ADR ARB Queue');
      if (managed) {
        expect(rec.updated).toHaveLength(1);
        expect(rec.created).toHaveLength(0);
      } else {
        expect(rec.created).toHaveLength(1);
        expect(rec.updated).toHaveLength(0);
      }
    });
  }
});

describe('managedQueueIssue — no partial write on API error', () => {
  test('(L) createIssue throws 403 → error propagates', async () => {
    const { client } = fakeClient([], { on: 'create', status: 403 });
    await expect(managedQueueIssue(REPORT, client, 'ADR ARB Queue')).rejects.toMatchObject({ status: 403 });
  });

  test('(M) updateIssue throws 403 → error propagates, prior state authoritative', async () => {
    const { client } = fakeClient([{ number: 2, state: 'open', title: 't', body: MARKER }], { on: 'update', status: 403 });
    await expect(managedQueueIssue(REPORT, client, 'ADR ARB Queue')).rejects.toMatchObject({ status: 403 });
  });
});

describe('publishQueueReport — orchestration order', () => {
  function report(errorFindings: number): QueueReport {
    return {
      version: '1',
      asOf: '2026-01-08',
      corpusFingerprint: 'x'.repeat(64),
      totalItems: 0,
      totalCorpusFindings: errorFindings,
      itemsWithFindings: 0,
      items: [],
      corpusFindings: Array.from({ length: errorFindings }, (_, i) => ({
        sourcePath: `docs/adr/${i}.md`,
        code: 'corpus.schema-invalid',
        severity: 'error' as const,
        message: 'bad',
      })),
    };
  }

  test('(N) error report records events update → setOutput → setFailed in order', async () => {
    const { client } = fakeClient([{ number: 12, state: 'open', title: 'ADR ARB Queue', body: MARKER }]);
    const events: string[] = [];
    await publishQueueReport(report(2), REPORT, client, 'ADR ARB Queue', {
      setOutput: (name, value) => events.push(`output:${name}=${value}`),
      setFailed: (message) => events.push(`failed:${message}`),
    });
    expect(events).toEqual([
      'output:issue-number=12',
      'failed:Queue report contains 2 corpus error(s). See issue #12 for details.',
    ]);
  });

  test('a clean report omits setFailed', async () => {
    const { client } = fakeClient([{ number: 15, state: 'open', title: 'ADR ARB Queue', body: MARKER }]);
    const events: string[] = [];
    await publishQueueReport(report(0), REPORT, client, 'ADR ARB Queue', {
      setOutput: (name, value) => events.push(`output:${name}=${value}`),
      setFailed: (message) => events.push(`failed:${message}`),
    });
    expect(events).toEqual(['output:issue-number=15']);
  });
});
