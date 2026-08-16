/**
 * `resolveAsOf` — the rule turning a `--as-of` input into the UTC calendar date
 * `buildQueueReport` computes SLA state against.
 *
 * These cases live here, beside the exported rule, rather than only behind the CLI. That
 * placement is the point of ADR-0031 action item 7: while the rule was private to
 * `packages/cli/src/queue.ts`, a library consumer of `buildQueueReport` had to reimplement
 * it, and a reimplementation that guessed differently produced a queue disagreeing with CI
 * about which decisions are overdue — same corpus, same day, and no error raised anywhere.
 *
 * The timezone-less rejection is the case worth protecting: it is the one a reimplementation
 * is most likely to get wrong by being permissive, and being permissive is exactly what
 * makes two consumers disagree.
 */

import { describe, expect, test } from 'bun:test';
import { resolveAsOf } from '../src/queue/as-of.ts';

describe('resolveAsOf — accepted inputs', () => {
  test('a bare YYYY-MM-DD resolves to itself', () => {
    expect(resolveAsOf('2026-01-08')).toEqual({ ok: true, date: '2026-01-08' });
  });

  test('an ISO datetime with Z resolves to its UTC calendar date', () => {
    expect(resolveAsOf('2026-01-08T00:00:00Z')).toEqual({ ok: true, date: '2026-01-08' });
  });

  test('an explicit offset is honoured, not ignored', () => {
    // 2026-01-08T23:30-05:00 is 2026-01-09T04:30Z, so the UTC calendar date is the 9th.
    // A reimplementation that sliced the first ten characters would answer the 8th and
    // silently disagree with CI for every record whose SLA boundary falls between them.
    expect(resolveAsOf('2026-01-08T23:30:00-05:00')).toEqual({ ok: true, date: '2026-01-09' });
  });
});

describe('resolveAsOf — rejected inputs', () => {
  test('a timezone-less datetime is rejected rather than guessed', () => {
    // The calendar date this lands on depends on the reader's zone, and an SLA boundary
    // that moves with the reader is not a boundary.
    expect(resolveAsOf('2026-01-08T00:00:00')).toEqual({ ok: false, kind: 'tzless' });
  });

  test('a well-shaped but non-existent date is invalid, not silently rolled over', () => {
    // `new Date('2026-02-30T00:00:00Z')` rolls to March 2; the round-trip check is what
    // catches it. Without that check this would resolve to 2026-03-02 and no one would know.
    expect(resolveAsOf('2026-02-30')).toEqual({ ok: false, kind: 'invalid' });
  });

  test('a non-date string is invalid', () => {
    expect(resolveAsOf('yesterday')).toEqual({ ok: false, kind: 'invalid' });
  });

  test('the two rejection reasons stay distinguishable', () => {
    // The CLI prints different guidance for each, so collapsing them into one `false`
    // would degrade the error a user sees without failing any assertion about validity.
    const tzless = resolveAsOf('2026-01-08T00:00:00');
    const invalid = resolveAsOf('not-a-date');
    expect(tzless.ok).toBe(false);
    expect(invalid.ok).toBe(false);
    expect(tzless).not.toEqual(invalid);
  });
});

describe('resolveAsOf — reachable as a published contract', () => {
  test('it is exported from the package entry point, not only from its module', async () => {
    // The defect this closes was not a wrong answer; it was an unreachable rule. If this
    // import breaks, the gap has reopened even though every case above still passes.
    const core = await import('../src/index.ts');
    expect(typeof core.resolveAsOf).toBe('function');
    expect(core.resolveAsOf('2026-01-08')).toEqual({ ok: true, date: '2026-01-08' });
  });
});
