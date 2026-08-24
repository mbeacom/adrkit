/**
 * Resolution of a `--as-of` value to the UTC calendar date `buildQueueReport` computes
 * SLA state against.
 *
 * This lived in `packages/cli/src/queue.ts` and was not exported from this package, which
 * made it a contract that lived outside the contract: `buildQueueReport` is published and
 * takes an `asOf` date, but the rule producing that date from user input was reachable only
 * by running the CLI. A library consumer building the queue therefore had to reimplement
 * this rule, and any difference in the reimplementation produces a queue that disagrees
 * with CI about which decisions are overdue — same corpus, same day, no error anywhere.
 *
 * No additive-only discipline on this package's exports would have caught that, because the
 * missing piece was never exported to be disciplined. It belongs beside the kernel it feeds.
 *
 * Behaviour is unchanged from the CLI original and remains bound to
 * `cli-contract.md §As-Of Resolution`: a bare `YYYY-MM-DD`, or an ISO datetime carrying an
 * explicit timezone. A timezone-less datetime is rejected rather than guessed, because the
 * calendar date it lands on depends on the reader's zone, and an SLA boundary that moves
 * with the reader is not a boundary.
 */

/** Outcome of resolving a `--as-of` input. `code` distinguishes the two rejection reasons. */
export type AsOfResolution = { ok: true; date: string } | { ok: false; code: 'tzless' | 'invalid' };

/** A resolved value must be a real `YYYY-MM-DD`, which `Date` alone does not guarantee. */
function isCalendarDate(candidate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
  const probe = new Date(`${candidate}T00:00:00Z`);
  return Number.isFinite(probe.getTime()) && probe.toISOString().slice(0, 10) === candidate;
}

/** Resolve an `--as-of` value to a UTC calendar date (`cli-contract.md §As-Of Resolution`). */
export function resolveAsOf(value: string): AsOfResolution {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return isCalendarDate(value) ? { ok: true, date: value } : { ok: false, code: 'invalid' };
  }

  const tIndex = value.indexOf('T');
  if (tIndex !== -1) {
    const timePart = value.slice(tIndex + 1);
    const hasTimezone = /Z$/.test(timePart) || /[+-]\d{2}:?\d{2}$/.test(timePart);
    if (!hasTimezone) return { ok: false, code: 'tzless' };

    // The input's own calendar date must be real before any offset is applied. Without this
    // `2026-02-30T00:00:00Z` is normalized by `Date` to 2026-03-02 and returned as a success,
    // while the bare `2026-02-30` is rejected — the same input answered two ways depending on
    // spelling, which is exactly the divergence this export exists to remove.
    if (!isCalendarDate(value.slice(0, tIndex))) return { ok: false, code: 'invalid' };

    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return { ok: false, code: 'invalid' };

    // `toISOString` emits the expanded-year form (`±YYYYYY-MM-DD`) outside 0000-9999, which
    // `slice(0, 10)` would truncate into a non-date. The kernel compares `asOf` to deadlines
    // lexicographically, and `+` sorts below every digit, so such a value would silently
    // report every deadline-bearing item as within SLA rather than failing.
    const resolved = parsed.toISOString().slice(0, 10);
    return isCalendarDate(resolved) ? { ok: true, date: resolved } : { ok: false, code: 'invalid' };
  }

  return { ok: false, code: 'invalid' };
}
