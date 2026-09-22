import { describe, expect, test } from 'bun:test';
import { toGoverningDecisions } from '../src/check/index.ts';
import type { Adr, Status } from '../src/schema/adr.schema.ts';
import { resolveDecisionsAsOf } from '../src/temporal/decisions.ts';

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

function decisionsFor(records: readonly Adr[]) {
  return toGoverningDecisions(
    records,
    records.map((r) => ({ recordId: r.frontmatter.id, firedMatchers: [] })),
  );
}

function ids(decisions: readonly { recordId: string }[]): string[] {
  return decisions.map((d) => d.recordId);
}

describe('resolveDecisionsAsOf', () => {
  test('a record superseded today was governing on a date inside its window', () => {
    const records = [
      record('0007', 'superseded', '2026-01-15', '0019'),
      record('0019', 'accepted', '2026-06-01'),
    ];
    const view = resolveDecisionsAsOf({ records, decisions: decisionsFor(records), asOf: '2026-03-01' });

    expect(ids(view.governing)).toEqual(['0007']);
    expect(ids(view.notYetRecorded)).toEqual(['0019']);
    expect(view.history).toEqual([]);
    expect(view.findings).toEqual([]);
  });

  test('the present-tense bucket is preserved beside the as-of standing, not overwritten', () => {
    const records = [
      record('0007', 'superseded', '2026-01-15', '0019'),
      record('0019', 'accepted', '2026-06-01'),
    ];
    const view = resolveDecisionsAsOf({ records, decisions: decisionsFor(records), asOf: '2026-03-01' });

    // Both facts are true at once, and a reader needs both: it is history now, and it
    // governed then.
    expect(view.governing[0]?.bucket).toBe('history');
    expect(view.governing[0]?.status).toBe('superseded');
    expect(view.governing[0]?.standing).toBe('governing');
    expect(view.governing[0]?.window).toEqual({
      opensOn: '2026-01-15',
      closesOn: '2026-06-01',
      closedBy: '0019',
    });
  });

  test('the handover date belongs to the successor alone', () => {
    const records = [
      record('0007', 'superseded', '2026-01-15', '0019'),
      record('0019', 'accepted', '2026-06-01'),
    ];
    const view = resolveDecisionsAsOf({ records, decisions: decisionsFor(records), asOf: '2026-06-01' });

    expect(ids(view.governing)).toEqual(['0019']);
    expect(ids(view.history)).toEqual(['0007']);
  });

  test('along a three-link chain exactly one record governs on any date', () => {
    const records = [
      record('0007', 'superseded', '2026-01-15', '0019'),
      record('0019', 'superseded', '2026-06-01', '0031'),
      record('0031', 'accepted', '2026-09-01'),
    ];
    const decisions = decisionsFor(records);

    // Closing at the terminal successor instead of the immediate one would report 0007 as
    // in force through 0019's entire tenure, and two records as governing at once.
    expect(ids(resolveDecisionsAsOf({ records, decisions, asOf: '2026-03-01' }).governing)).toEqual(['0007']);
    expect(ids(resolveDecisionsAsOf({ records, decisions, asOf: '2026-07-01' }).governing)).toEqual(['0019']);
    expect(ids(resolveDecisionsAsOf({ records, decisions, asOf: '2026-10-01' }).governing)).toEqual(['0031']);
  });

  test('a deprecated record is undetermined and says so, rather than being guessed at', () => {
    const records = [record('0031', 'deprecated', '2026-01-15')];
    const view = resolveDecisionsAsOf({ records, decisions: decisionsFor(records), asOf: '2026-06-01' });

    expect(ids(view.undetermined)).toEqual(['0031']);
    expect(view.governing).toEqual([]);
    expect(view.history).toEqual([]);
    expect(view.findings).toEqual([
      {
        rule: 'temporal-window-undetermined',
        severity: 'warn',
        id: '0031',
        field: 'status',
        message:
          'ADR 0031 is deprecated and records no date it stopped governing, so whether it governed on 2026-06-01 cannot be determined from the corpus',
      },
    ]);
  });

  test('a deprecated record dated after the query is not yet recorded, and needs no warning', () => {
    const records = [record('0031', 'deprecated', '2026-08-01')];
    const view = resolveDecisionsAsOf({ records, decisions: decisionsFor(records), asOf: '2026-06-01' });

    expect(ids(view.notYetRecorded)).toEqual(['0031']);
    expect(view.findings).toEqual([]);
  });

  test('a rejected record is history on every date it existed', () => {
    const records = [record('0005', 'rejected', '2026-01-15')];
    const view = resolveDecisionsAsOf({ records, decisions: decisionsFor(records), asOf: '2026-06-01' });

    expect(ids(view.history)).toEqual(['0005']);
    expect(view.findings).toEqual([]);
  });

  test.each(['draft', 'proposed'] as const)('a %s record is an active proposal, never governing', (status) => {
    const records = [record('0040', status, '2026-01-15')];
    const view = resolveDecisionsAsOf({ records, decisions: decisionsFor(records), asOf: '2026-06-01' });

    expect(ids(view.activeProposals)).toEqual(['0040']);
    expect(view.governing).toEqual([]);
  });

  test('a superseded record whose successor is missing stays visible with an open window', () => {
    const records = [record('0007', 'superseded', '2026-01-15', '0019')];
    const view = resolveDecisionsAsOf({ records, decisions: decisionsFor(records), asOf: '2030-01-01' });

    expect(ids(view.governing)).toEqual(['0007']);
    expect(view.governing[0]?.window.closesOn).toBeNull();
    expect(view.findings).toEqual([
      {
        rule: 'temporal-window-open',
        severity: 'info',
        id: '0007',
        field: 'supersededBy',
        pattern: '0019',
        message:
          'ADR 0007 is superseded by 0019, which this corpus does not have, so its window has no close date and is treated as open',
      },
    ]);
  });

  test('a successor dated before the record it replaced is reported, not clamped', () => {
    const records = [
      record('0007', 'superseded', '2026-06-01', '0019'),
      record('0019', 'accepted', '2026-01-15'),
    ];
    const view = resolveDecisionsAsOf({ records, decisions: decisionsFor(records), asOf: '2026-09-01' });

    expect(ids(view.governing)).toEqual(['0019']);
    expect(ids(view.history)).toEqual(['0007']);
    expect(view.findings).toEqual([
      {
        rule: 'temporal-window-inverted',
        severity: 'warn',
        id: '0007',
        field: 'date',
        message:
          'ADR 0007 opens on 2026-06-01 but its successor 0019 is dated 2026-01-15, so it has no date on which it governed; fix one of the two dates',
      },
    ]);
  });

  test('a decision with no record behind it is undetermined rather than placed', () => {
    const view = resolveDecisionsAsOf({
      records: [],
      decisions: [
        { recordId: '0099', title: '', status: 'accepted', bucket: 'governing', firedMatchers: [] },
      ],
      asOf: '2026-06-01',
    });

    expect(ids(view.undetermined)).toEqual(['0099']);
    expect(view.findings[0]?.rule).toBe('temporal-window-undetermined');
  });

  test('output is deterministic and id-sorted regardless of input order', () => {
    const records = [
      record('0019', 'accepted', '2026-01-01'),
      record('0007', 'accepted', '2026-01-01'),
      record('0031', 'accepted', '2026-01-01'),
    ];
    const forward = resolveDecisionsAsOf({ records, decisions: decisionsFor(records), asOf: '2026-06-01' });
    const reversed = resolveDecisionsAsOf({
      records: [...records].reverse(),
      decisions: decisionsFor([...records].reverse()),
      asOf: '2026-06-01',
    });

    expect(ids(forward.governing)).toEqual(['0007', '0019', '0031']);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });
});
