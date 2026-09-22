import { describe, expect, test } from 'bun:test';
import type { Adr, Status } from '../src/schema/adr.schema.ts';
import {
  buildDecisionWindows,
  decisionWindowFor,
  standingAsOf,
  wasGoverningAsOf,
} from '../src/temporal/window.ts';

function record(id: string, status: Status, date: string, supersededBy?: string): Adr {
  return {
    frontmatter: {
      schemaVersion: '0.1.0',
      id,
      title: `Use decision ${id}`,
      status,
      date,
      deciders: ['@tester'],
      consulted: [],
      informed: [],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      supersedes: [],
      ...(supersededBy ? { supersededBy } : {}),
      relatesTo: [],
      conflictsWith: [],
      affects: [],
      assertions: [],
      externalRefs: [],
      complianceControls: [],
    } as unknown as Adr['frontmatter'],
    body: '',
    path: `docs/adr/${id}-use-decision.md`,
  };
}

function index(records: readonly Adr[]): Map<string, Adr> {
  return new Map(records.map((r) => [r.frontmatter.id, r]));
}

describe('decisionWindowFor', () => {
  test('a live record has an open window', () => {
    const accepted = record('0019', 'accepted', '2026-06-01');
    expect(decisionWindowFor(accepted, index([accepted]))).toEqual({
      opensOn: '2026-06-01',
      closesOn: null,
    });
  });

  test('a superseded record closes on its successor date', () => {
    const old = record('0007', 'superseded', '2026-01-15', '0019');
    const next = record('0019', 'accepted', '2026-06-01');
    expect(decisionWindowFor(old, index([old, next]))).toEqual({
      opensOn: '2026-01-15',
      closesOn: '2026-06-01',
      closedBy: '0019',
    });
  });

  test('the window closes at the immediate successor, not the terminal one', () => {
    const first = record('0007', 'superseded', '2026-01-15', '0019');
    const second = record('0019', 'superseded', '2026-06-01', '0031');
    const third = record('0031', 'accepted', '2026-09-01');
    const windows = buildDecisionWindows([first, second, third]);

    // Walking to the terminal successor would report 0007 in force for 0019's whole tenure.
    expect(windows.get('0007')).toEqual({ opensOn: '2026-01-15', closesOn: '2026-06-01', closedBy: '0019' });
    expect(windows.get('0019')).toEqual({ opensOn: '2026-06-01', closesOn: '2026-09-01', closedBy: '0031' });
    expect(windows.get('0031')).toEqual({ opensOn: '2026-09-01', closesOn: null });
  });

  test('a superseded record whose successor the corpus lacks keeps an open window', () => {
    const orphan = record('0007', 'superseded', '2026-01-15', '0019');
    expect(decisionWindowFor(orphan, index([orphan]))).toEqual({
      opensOn: '2026-01-15',
      closesOn: null,
    });
  });

  test.each(['deprecated', 'rejected', 'draft', 'proposed'] as const)(
    'a %s record has no derivable close date',
    (status) => {
      const other = record('0007', status, '2026-01-15');
      expect(decisionWindowFor(other, index([other]))).toEqual({
        opensOn: '2026-01-15',
        closesOn: null,
      });
    },
  );
});

describe('standingAsOf', () => {
  const closed = { opensOn: '2026-01-15', closesOn: '2026-06-01', closedBy: '0019' } as const;
  const open = { opensOn: '2026-01-15', closesOn: null } as const;

  test.each([
    ['2026-01-14', 'notYetRecorded'],
    ['2026-01-15', 'governing'],
    ['2026-05-31', 'governing'],
    // Half-open: the successor owns its own start day, so exactly one record along a
    // supersession chain is in force on the handover date.
    ['2026-06-01', 'history'],
    ['2026-09-01', 'history'],
  ] as const)('a superseded record on %s stands as %s', (asOf, expected) => {
    expect(standingAsOf('superseded', closed, asOf)).toBe(expected);
  });

  test('an accepted record governs from its date onward', () => {
    expect(standingAsOf('accepted', open, '2026-01-14')).toBe('notYetRecorded');
    expect(standingAsOf('accepted', open, '2026-01-15')).toBe('governing');
    expect(standingAsOf('accepted', open, '2030-01-01')).toBe('governing');
  });

  test('a superseded record with no close date stays open rather than vanishing', () => {
    expect(standingAsOf('superseded', open, '2030-01-01')).toBe('governing');
  });

  test('a deprecated record that existed is undetermined, never guessed at', () => {
    expect(standingAsOf('deprecated', open, '2026-01-14')).toBe('notYetRecorded');
    expect(standingAsOf('deprecated', open, '2026-06-01')).toBe('undetermined');
  });

  test('a rejected record never governed on any date', () => {
    expect(standingAsOf('rejected', open, '2026-01-15')).toBe('history');
    expect(standingAsOf('rejected', open, '2030-01-01')).toBe('history');
  });

  test.each(['draft', 'proposed'] as const)('a %s record is never binding', (status) => {
    expect(standingAsOf(status, open, '2030-01-01')).toBe('activeProposals');
  });

  test('an inverted window never governs on any date', () => {
    const inverted = { opensOn: '2026-06-01', closesOn: '2026-01-15', closedBy: '0019' } as const;
    expect(standingAsOf('superseded', inverted, '2026-03-01')).toBe('notYetRecorded');
    expect(standingAsOf('superseded', inverted, '2026-06-01')).toBe('history');
    expect(standingAsOf('superseded', inverted, '2030-01-01')).toBe('history');
  });
});

describe('wasGoverningAsOf', () => {
  test('agrees with standingAsOf so marker staleness cannot drift from the window', () => {
    const old = record('0007', 'superseded', '2026-01-15', '0019');
    const next = record('0019', 'accepted', '2026-06-01');
    const byId = index([old, next]);

    expect(wasGoverningAsOf(old, byId, '2026-03-01')).toBe(true);
    expect(wasGoverningAsOf(old, byId, '2026-06-01')).toBe(false);
    expect(wasGoverningAsOf(old, byId, '2026-01-14')).toBe(false);
  });
});

describe('purity', () => {
  test('the same inputs answer the same way regardless of the clock', () => {
    const old = record('0007', 'superseded', '2026-01-15', '0019');
    const next = record('0019', 'accepted', '2026-06-01');
    const byId = index([old, next]);

    const first = standingAsOf('superseded', decisionWindowFor(old, byId), '2026-03-01');
    const second = standingAsOf('superseded', decisionWindowFor(old, byId), '2026-03-01');
    expect(first).toBe(second);
    expect(first).toBe('governing');
  });

  test('the module reads no clock', async () => {
    const source = await Bun.file(
      new URL('../src/temporal/window.ts', import.meta.url).pathname,
    ).text();
    // Comments mention no clock; the code must not contain one either.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('Date.now');
    expect(code).not.toContain('new Date');
  });
});
