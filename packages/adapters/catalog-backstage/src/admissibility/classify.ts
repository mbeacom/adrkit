/**
 * T051 · T052 — `inadmissible-descriptor` classification, and the record that must
 * carry all three attributions.
 *
 * # Failure semantics (`admissibility.md` §5)
 *
 * `inadmissible-descriptor` is a **fatal, whole-operation** trigger class — the
 * **fifteenth** member of this feature's enumeration. On any inadmissible
 * descriptor the entire run aborts, no envelope is written including a partial one,
 * no entity from the same run is emitted including entities already determined
 * admissible, and the process exits non-zero.
 *
 * An inadmissible descriptor is **never skipped**, never downgraded to a warning,
 * and never excluded-and-continued. *"Continue past the bad one"* is the precise
 * behaviour §5 forbids. This module therefore produces a rejection and never a
 * filtered collection: there is no function here that takes descriptors and returns
 * the good ones.
 *
 * # All three attributions, and why one merged one will not do (§3, §5.1, FR-020)
 *
 * A record that says only "descriptor invalid", without naming which of the four
 * fields and which validator produced the false, "does not satisfy FR-020 and MUST
 * be treated as a reporting defect rather than as a determination" (§3). So every
 * {@link InadmissibilityAttribution} carries the descriptor path, the failing field,
 * and the rejecting validator, and the composition evaluates **all four** predicates
 * rather than stopping at the first — §3: "Two fields failing produce two
 * attributions, not one merged one."
 *
 * # The count
 *
 * Fifteen. `atomic-fail-closed.md` §4 fixes spike 009's enumeration at fourteen and
 * that remains correct *as a statement about spike 009*; `inadmissible-descriptor`
 * appears nowhere under `specs/009-catalog-binding-viability/`. Writing fourteen as
 * *this feature's* count is an error against FR-035 (`admissibility.md` §5.1).
 *
 * @see `specs/010-catalog-backstage/contracts/admissibility.md` §3, §5, §5.1
 */

import type { Rejection } from '../diagnostics.ts';
import type { DescriptorDocument } from '../descriptor/read.ts';
import {
  type AdmissibilityField,
  type AdmissibilityValidatorName,
  PINNED_BACKSTAGE_COMMIT,
  PINNED_VALIDATOR_BINDINGS,
  VALIDATORS,
  VALIDATOR_FIELDS,
} from './validators.ts';

/** One field's rejection, attributed as FR-020 requires. */
export interface InadmissibilityAttribution {
  /** FR-020 attribution 1 — the offending source path. */
  readonly sourcePath: string;
  /** Which document in that file, since a file may hold several. */
  readonly documentIndexInFile: number;
  /** FR-020 attribution 2 — the failing field. */
  readonly field: AdmissibilityField;
  /** FR-020 attribution 3 — the rejecting validator. */
  readonly validator: AdmissibilityValidatorName;
  /** The pinned Backstage binding that validator reproduces (ADR-0015's table). */
  readonly pinnedBinding: string;
  /** The commit the predicate is pinned to. A different commit is a different contract. */
  readonly pinnedCommit: string;
  /** What was actually authored, rendered for a reader. Never load-bearing. */
  readonly observed: string;
}

/**
 * `data-model.md` §4, plus the attributions FR-020 requires.
 *
 * `failedFields` is empty **iff** `admissible`, which is the invariant §2's "there
 * is no partial admissibility, no warning tier, and no 'admissible except for'
 * state" reduces to in code.
 */
export interface AdmissibilityResult {
  readonly admissible: boolean;
  readonly failedFields: readonly AdmissibilityField[];
  readonly attributions: readonly InadmissibilityAttribution[];
}

/** The one fine-grained reason. 1:1 with its trigger class. */
export type InadmissibilityReason = 'inadmissible-descriptor';

function render(value: unknown): string {
  if (value === undefined) return '<absent>';
  if (typeof value === 'string') return JSON.stringify(value);
  return `<${value === null ? 'null' : typeof value}>`;
}

/** The four field values a descriptor presents to the validators, as authored. */
export interface AuthoredFields {
  readonly apiVersion: unknown;
  readonly kind: unknown;
  readonly name: unknown;
  /**
   * `undefined` when `metadata.namespace` is wholly omitted.
   *
   * ADR-0015: the namespace is "validated as authored, never after defaulting", so
   * the `default` substitution must not have happened yet when this value is read.
   */
  readonly namespace: unknown;
  readonly namespacePresent: boolean;
}

/** Read the four authored fields off a parsed descriptor document. */
export function authoredFields(document: DescriptorDocument): AuthoredFields {
  const metadata = document.rawMetadata;
  const isRecord =
    typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata);
  const record = isRecord ? (metadata as Record<string, unknown>) : undefined;

  return {
    apiVersion: document.rawApiVersion,
    kind: document.rawKind,
    name: record?.['name'],
    namespace: record?.['namespace'],
    namespacePresent: record !== undefined && Object.hasOwn(record, 'namespace'),
  };
}

/**
 * Apply all four predicates and collect every failure.
 *
 * Deliberately **not** short-circuiting. §3 requires two failing fields to produce
 * two attributions, and a short-circuit would silently make the reported field a
 * function of evaluation order.
 *
 * The namespace validator is invoked **only when the field is present**. An omitted
 * `metadata.namespace` is admissible (ADR-0015, "Decision"), and the `default`
 * substitution applies afterwards — in `identity/canonicalize.ts`, never here.
 */
export function classifyAdmissibility(document: DescriptorDocument): AdmissibilityResult {
  const fields = authoredFields(document);

  const invocations: readonly { name: AdmissibilityValidatorName; value: unknown }[] = [
    { name: 'validateApiVersion', value: fields.apiVersion },
    { name: 'validateKind', value: fields.kind },
    { name: 'validateEntityName', value: fields.name },
    ...(fields.namespacePresent
      ? [{ name: 'validateNamespace' as const, value: fields.namespace }]
      : []),
  ];

  const attributions: InadmissibilityAttribution[] = [];

  for (const { name, value } of invocations) {
    if (VALIDATORS[name](value)) continue;
    attributions.push({
      sourcePath: document.sourcePath,
      documentIndexInFile: document.documentIndexInFile,
      field: VALIDATOR_FIELDS[name],
      validator: name,
      pinnedBinding: PINNED_VALIDATOR_BINDINGS[name],
      pinnedCommit: PINNED_BACKSTAGE_COMMIT,
      observed: render(value),
    });
  }

  return {
    admissible: attributions.length === 0,
    failedFields: attributions.map((attribution) => attribution.field),
    attributions,
  };
}

/**
 * Build the fatal rejection an inadmissible descriptor raises.
 *
 * `detail` names every attribution, so a run aborting on a descriptor that failed
 * two fields reports both. It is distinguishable from a `duplicate-canonical-id`
 * record by `triggerClass` alone — a caller never has to parse `detail` to tell
 * them apart, which is what FR-020's "MUST be distinguishable" requires in
 * practice.
 */
export function inadmissibleRejection(
  result: AdmissibilityResult,
): Rejection<InadmissibilityReason> {
  if (result.admissible) {
    throw new Error(
      'inadmissibleRejection was called for an admissible result. Building a rejection ' +
        'for a descriptor that passed would fabricate a determination that never happened.',
    );
  }

  const detail = result.attributions
    .map(
      (attribution) =>
        `${attribution.sourcePath}[${attribution.documentIndexInFile}]: ` +
        `${attribution.field} rejected by ${attribution.validator} ` +
        `(${attribution.pinnedBinding}, pinned at ${attribution.pinnedCommit}); ` +
        `observed ${attribution.observed}`,
    )
    .join(' | ');

  return { reason: 'inadmissible-descriptor', triggerClass: 'inadmissible-descriptor', detail };
}
