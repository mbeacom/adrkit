/**
 * @adrkit/core — deriving a record's valid-time window from the corpus it already has.
 *
 * "Which decisions governed this file when this code was written?" is the question every
 * archaeology session asks, and the corpus can already answer it: every record carries a
 * `date`, and a superseded record names the successor that replaced it. A window therefore
 * opens at a record's own `date` and closes at its immediate successor's `date`. No schema
 * change, no new field, no second source of truth (ADR-0039).
 *
 * Pure in the same sense as `resolveAffects` and `resolveSourceMarkers`: no filesystem, no
 * subprocess, and — the one that matters here — **no clock**. The date this is evaluated
 * against is always supplied by the caller, because a temporal answer that quietly depended
 * on when it was computed would not be reproducible, and reproducibility is the whole point
 * of asking about a past date.
 *
 * ## What is derivable, and what is not
 *
 * The window is derivable **only** along the `accepted → superseded` lineage. That is not a
 * simplification, it is what the schema permits: `adr.schema.ts` refuses `supersededBy`
 * unless `status` is `superseded`, so a `deprecated` record carries no close date anywhere
 * in frontmatter. Inventing one — "open from `date`", say — would assert that a decision
 * deprecated last month still governed last year, which is exactly the confidently-wrong
 * answer this feature exists to replace. A `deprecated` record that existed on the asked-for
 * date is therefore reported as `undetermined`, not guessed at.
 *
 * `rejected` is the other narrow case: it was recorded, but it never bound anything at any
 * time, so it is history on every date rather than a window that closed on one.
 */

import type { Adr, Status } from '../schema/adr.schema.ts';

/**
 * A record's valid-time window.
 *
 * `closesOn` is `null` when no close date is derivable — an open window. That covers the
 * live record (nothing has replaced it) and the legacy record whose successor the corpus
 * cannot see. Both stay visible to a time-travel query rather than silently vanishing from
 * it, which is the same choice `corpus.file-skipped` makes for records discovery cannot see.
 */
export interface DecisionWindow {
  /** The record's own `date`. */
  opensOn: string;
  /** The immediate successor's `date`, or `null` when no close date is derivable. */
  closesOn: string | null;
  /** The immediate successor whose `date` closed the window, when there is one. */
  closedBy?: string;
}

/**
 * Where a record stood on one UTC calendar date.
 *
 * The first three names are deliberately the `DecisionBucket` names, because they mean the
 * same thing — only the tense differs. The last two have no present-tense counterpart:
 * a record cannot be "not yet recorded" today, and `decisionBucketFor` never has to say
 * "I cannot tell" because it is only ever asked about now.
 */
export type TemporalStanding =
  | 'governing'
  | 'activeProposals'
  | 'history'
  | 'notYetRecorded'
  | 'undetermined';

/**
 * Derive one record's window.
 *
 * Only the immediate successor is followed, never the terminal one: ADR-0007's window closes
 * when ADR-0019 opens, even if 0019 was itself later superseded by 0031. Walking to the end
 * of the chain would report 0007 as in force for 0019's entire tenure.
 */
export function decisionWindowFor(record: Adr, byId: ReadonlyMap<string, Adr>): DecisionWindow {
  const opensOn = record.frontmatter.date;
  if (record.frontmatter.status !== 'superseded') return { opensOn, closesOn: null };

  const successorId = record.frontmatter.supersededBy;
  const successor = successorId ? byId.get(successorId) : undefined;
  // A dangling `supersededBy` is already an `error` from `validateCorpusInvariants`; the
  // window does not report it a second time, it just has no close date to offer.
  if (!successor) return { opensOn, closesOn: null };

  return { opensOn, closesOn: successor.frontmatter.date, closedBy: successor.frontmatter.id };
}

/** Derive a window for every record, keyed by id. */
export function buildDecisionWindows(
  records: readonly Adr[],
): Map<string, DecisionWindow> {
  const byId = new Map(records.map((record) => [record.frontmatter.id, record]));
  const windows = new Map<string, DecisionWindow>();
  for (const record of records) {
    windows.set(record.frontmatter.id, decisionWindowFor(record, byId));
  }
  return windows;
}

/**
 * A window whose successor is dated before the record it replaced.
 *
 * The corpus disagrees with itself, and `standingAsOf` consequently never returns
 * `governing` for such a record on any date. Exported because the renderer has to agree
 * with that: printing `in force <opens> → <closes>` for an interval the kernel rejected
 * would report a governing period that never existed. One definition, two callers.
 */
export function isInvertedWindow(window: DecisionWindow): boolean {
  return window.closesOn !== null && window.closesOn < window.opensOn;
}

/**
 * Place a record on one UTC calendar date.
 *
 * The window is **half-open**: `[opensOn, closesOn)`. The successor owns its own start day,
 * so exactly one record along a supersession chain is governing on any given date — closed
 * intervals would report both the old and the new decision as in force on the handover day.
 *
 * `YYYY-MM-DD` compares lexicographically in calendar order, and `lintCorpus` drops any
 * record whose `date` did not parse, so plain string comparison is the whole implementation.
 */
export function standingAsOf(
  status: Status,
  window: DecisionWindow,
  asOf: string,
): TemporalStanding {
  if (asOf < window.opensOn) return 'notYetRecorded';

  switch (status) {
    case 'accepted':
      return 'governing';
    case 'superseded':
      // An inverted window (successor dated before the record it supersedes) lands here as
      // `history` for every date the record existed, and never as `governing`. That is a
      // degenerate corpus rather than a degenerate rule, and it is reported as a finding by
      // `resolveDecisionsAsOf` instead of being clamped into a window nobody wrote down.
      return window.closesOn === null || asOf < window.closesOn ? 'governing' : 'history';
    case 'deprecated':
      return 'undetermined';
    case 'rejected':
      return 'history';
    default:
      return 'activeProposals';
  }
}

/**
 * Whether a record was in force on `asOf`.
 *
 * Exported because marker staleness has to agree with this and must not re-derive it:
 * `resolveSourceMarkers` uses it to decide that `@adr 0007` was an accurate declaration on
 * the date being asked about, even though 0007 is superseded today.
 */
export function wasGoverningAsOf(record: Adr, byId: ReadonlyMap<string, Adr>, asOf: string): boolean {
  return standingAsOf(record.frontmatter.status, decisionWindowFor(record, byId), asOf) === 'governing';
}
