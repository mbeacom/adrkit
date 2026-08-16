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

/** Outcome of resolving a `--as-of` input. `kind` distinguishes the two rejection reasons. */
export type AsOfResolution = { ok: true; date: string } | { ok: false; kind: 'tzless' | 'invalid' };

/** Resolve an `--as-of` value to a UTC calendar date (`cli-contract.md §As-Of Resolution`). */
export function resolveAsOf(value: string): AsOfResolution {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) {
      return { ok: true, date: value };
    }
    return { ok: false, kind: 'invalid' };
  }

  const tIndex = value.indexOf('T');
  if (tIndex !== -1) {
    const timePart = value.slice(tIndex + 1);
    const hasTimezone = /Z$/.test(timePart) || /[+-]\d{2}:?\d{2}$/.test(timePart);
    if (!hasTimezone) return { ok: false, kind: 'tzless' };
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return { ok: true, date: parsed.toISOString().slice(0, 10) };
    return { ok: false, kind: 'invalid' };
  }

  return { ok: false, kind: 'invalid' };
}
