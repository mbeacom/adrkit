/**
 * @adrkit/core — re-bucketing governing decisions against a past date.
 *
 * `bucketDecisions` answers "what governs now". This answers "what governed then", and the
 * two cannot share an implementation: `decisionBucketFor` sends `superseded` to `history`
 * unconditionally, which is right in the present tense and is exactly wrong for a record
 * that was in force on the date being asked about. Routing an as-of query through the
 * present-tense bucketer produces a command that runs, passes its tests, and answers the
 * question it was given with the answer to a different one.
 *
 * Which decisions *reach* the path is not re-evaluated here. `affects` patterns are read
 * from today's records and `@adr` markers from today's working tree; only the temporal
 * standing of the decisions that reach it changes. Reading the file's contents at a past
 * ref is a strictly larger contract and is deliberately out of scope (ADR-0039).
 */

import type { GoverningDecision } from '../check/decisions.ts';
import { compareCodeUnits } from '../ordering/index.ts';
import type { Adr } from '../schema/adr.schema.ts';
import { sortFindings, type Finding } from '../validate/findings.ts';
import {
  decisionWindowFor,
  isInvertedWindow,
  standingAsOf,
  type DecisionWindow,
  type TemporalStanding,
} from './window.ts';

/** A decision carrying the window it was placed by, and where that placement put it. */
export interface DecisionAsOf extends GoverningDecision {
  window: DecisionWindow;
  standing: TemporalStanding;
}

export interface ResolveDecisionsAsOfInput {
  /** The corpus, for dates and supersession links. */
  records: readonly Adr[];
  /** The decisions that reach the path, from `affects` patterns and inbound markers. */
  decisions: readonly GoverningDecision[];
  /** The UTC calendar date to place them on. Always supplied; never read from a clock. */
  asOf: string;
}

/**
 * The as-of view. The first three keys carry the `BucketedDecisions` names because they
 * carry the same meaning in a different tense; the last two exist only here.
 */
export interface DecisionsAsOf {
  date: string;
  /** In force on `date`. */
  governing: DecisionAsOf[];
  /** Recorded by `date`, never ratified. */
  activeProposals: DecisionAsOf[];
  /** Closed on or before `date`, or `rejected` and so never binding. */
  history: DecisionAsOf[];
  /** Dated after `date` — the decision had not been made yet. */
  notYetRecorded: DecisionAsOf[];
  /** Recorded by `date`, but the date it stopped governing is not derivable. */
  undetermined: DecisionAsOf[];
  findings: Finding[];
}

const EMPTY_WINDOW: DecisionWindow = { opensOn: '', closesOn: null };

/**
 * A `deprecated` record that existed on the asked-for date.
 *
 * The honest answer is "I do not know", and saying so is the point. `deprecated` carries no
 * close date — `adr.schema.ts` allows `supersededBy` only on `superseded` — so there is
 * nothing in the corpus that says when it stopped governing. `warn`, matching
 * `corpus.file-skipped`: a claim that could not be honored, reported without failing the run.
 */
function undeterminedFinding(decision: GoverningDecision, asOf: string): Finding {
  return {
    rule: 'temporal-window-undetermined',
    severity: 'warn',
    id: decision.recordId,
    field: 'status',
    message:
      `ADR ${decision.recordId} is deprecated and records no date it stopped governing, ` +
      `so whether it governed on ${asOf} cannot be determined from the corpus`,
  };
}

/** A superseded record whose successor the corpus does not have: no close date to use. */
function openWindowFinding(decision: GoverningDecision): Finding {
  return {
    rule: 'temporal-window-open',
    severity: 'info',
    id: decision.recordId,
    field: 'supersededBy',
    ...(decision.supersededBy ? { pattern: decision.supersededBy } : {}),
    message:
      `ADR ${decision.recordId} is superseded by ${decision.supersededBy ?? 'an unnamed record'}, ` +
      'which this corpus does not have, so its window has no close date and is treated as open',
  };
}

/** A successor dated before the record it replaced. The corpus disagrees with itself. */
function invertedWindowFinding(decision: GoverningDecision, window: DecisionWindow): Finding {
  return {
    rule: 'temporal-window-inverted',
    severity: 'warn',
    id: decision.recordId,
    field: 'date',
    message:
      `ADR ${decision.recordId} opens on ${window.opensOn} but its successor ` +
      `${window.closedBy ?? 'record'} is dated ${window.closesOn}, so it has no date on which ` +
      'it governed; fix one of the two dates',
  };
}

/** Place every decision that reaches a path on one UTC calendar date. */
export function resolveDecisionsAsOf(input: ResolveDecisionsAsOfInput): DecisionsAsOf {
  const byId = new Map(input.records.map((record) => [record.frontmatter.id, record]));
  const findings: Finding[] = [];
  const view: DecisionsAsOf = {
    date: input.asOf,
    governing: [],
    activeProposals: [],
    history: [],
    notYetRecorded: [],
    undetermined: [],
    findings: [],
  };

  for (const decision of input.decisions) {
    const record = byId.get(decision.recordId);
    // A decision with no record behind it cannot be dated. This does not happen through
    // `explain` — every decision it produces came from a loaded record — but the input is
    // public, and placing an undatable decision on a timeline would be an invention.
    if (!record) {
      view.undetermined.push({ ...decision, window: EMPTY_WINDOW, standing: 'undetermined' });
      findings.push({
        rule: 'temporal-window-undetermined',
        severity: 'warn',
        id: decision.recordId,
        message: `ADR ${decision.recordId} is not in the corpus, so it cannot be placed on ${input.asOf}`,
      });
      continue;
    }

    const window = decisionWindowFor(record, byId);
    const standing = standingAsOf(record.frontmatter.status, window, input.asOf);
    view[standing].push({ ...decision, window, standing });

    if (standing === 'undetermined') findings.push(undeterminedFinding(decision, input.asOf));
    if (record.frontmatter.status === 'superseded') {
      if (window.closesOn === null) findings.push(openWindowFinding(decision));
      else if (isInvertedWindow(window)) findings.push(invertedWindowFinding(decision, window));
    }
  }

  for (const key of ['governing', 'activeProposals', 'history', 'notYetRecorded', 'undetermined'] as const) {
    view[key].sort((a, b) => compareCodeUnits(a.recordId, b.recordId));
  }
  view.findings = sortFindings(findings);
  return view;
}
