/**
 * @adrkit/evaluator — Pass 0 orchestrator.
 *
 * Pure, total function of `input` (FR-006): same input ⇒ same typed input error or
 * byte-identical report + patch. It performs NO clock/network/db/filesystem access,
 * mutates nothing, imports no adapter/model, and routes without approving or
 * persisting anything. Missing backing degrades to inert, never a thrown error or a
 * fabricated pass/fail.
 *
 * Behaviour is built up across the user stories: the schema-invalid short-circuit and
 * the input-contract branch (T021), the structural rules (US1), the externally-backed
 * rules (US3), routing (US4), and patch projection (US5).
 */

import type { Adr, Finding } from '@adrkit/core';
import { RULE_IDS, type RuleId } from './catalog.ts';
import { notEvaluated } from './rules/kernel.ts';
import { acceptedRecordsExcludingCandidate, type RuleContext } from './rules/context.ts';
import { evaluateSchemaValid } from './rules/schema-valid.ts';
import { evaluateIdUnique } from './rules/id-unique.ts';
import { evaluateSupersessionConsistent } from './rules/supersession-consistent.ts';
import { evaluateNoOrphanRefs } from './rules/no-orphan-refs.ts';
import { evaluateAffectsResolvable } from './rules/affects-resolvable.ts';
import { evaluateAffectsOverlap } from './rules/affects-overlap.ts';
import { evaluateScopeHierarchy } from './rules/scope-hierarchy.ts';
import { evaluateAssertionsCompile } from './rules/assertions-compile.ts';
import { evaluateAssertionsPass } from './rules/assertions-pass.ts';
import { computeAssertionOutcomes } from './assertions/evaluate.ts';
import { evaluateDeciderResolvable } from './rules/decider-resolvable.ts';
import { evaluateExpirySane } from './rules/expiry-sane.ts';
import { assembleReport } from './report/assemble.ts';
import { computeRouting, notRequiredRouting } from './routing/route.ts';
import { contradictsAcceptedAdr } from './routing/accepted-assertion.ts';
import { resolveRecordTargets } from './targets/canonical.ts';
import { projectPatch } from './patch/project.ts';
import type {
  Pass0Evaluation,
  Pass0Input,
  Pass0InputContractError,
  ProposalResolution,
  RuleResult,
} from './types.ts';

const PROPOSAL_STATUSES: ReadonlySet<string> = new Set(['draft', 'proposed']);
const NON_PROPOSAL_STATUSES: ReadonlySet<string> = new Set([
  'accepted',
  'rejected',
  'superseded',
  'deprecated',
]);

/** Locate + type the proposal within the corpus (data-model §3). */
function resolveProposal(input: Pass0Input): ProposalResolution {
  const proposed = input.corpus.records.find((record) => record.path === input.proposalPath);
  if (proposed) {
    return { proposalPath: input.proposalPath, schemaFindings: [], proposed };
  }
  const onPath = input.corpus.findings.filter((finding) => finding.path === input.proposalPath);
  const schemaFindings: readonly Finding[] =
    onPath.length > 0
      ? onPath
      : [
          {
            rule: 'file-read',
            severity: 'error',
            message: `Proposal not found in corpus: ${input.proposalPath}`,
            path: input.proposalPath,
          },
        ];
  return { proposalPath: input.proposalPath, schemaFindings };
}

/** The ten non-schema rules, in fixed order, evaluated over a valid proposal. */
function evaluateStructuralAndBacked(context: RuleContext): Map<RuleId, RuleResult> {
  const results = new Map<RuleId, RuleResult>();
  results.set('id-unique', evaluateIdUnique(context));
  results.set('supersession-consistent', evaluateSupersessionConsistent(context));
  results.set('no-orphan-refs', evaluateNoOrphanRefs(context));
  results.set('affects-resolvable', evaluateAffectsResolvable(context));
  results.set('affects-overlap', evaluateAffectsOverlap(context));
  results.set('scope-hierarchy', evaluateScopeHierarchy(context));

  const assertionOutcomes = computeAssertionOutcomes(context);
  const compile = evaluateAssertionsCompile(assertionOutcomes);
  results.set('assertions-compile', compile);
  // Only assertions-pass depends on assertions-compile; a compile failure makes it
  // not-evaluated.prereq-failed (C11). All other rules continue after a non-schema error.
  // The shared `assertionOutcomes` guarantees each assertion is compiled exactly once.
  results.set(
    'assertions-pass',
    compile.status === 'fail'
      ? notEvaluated('assertions-pass', 'not-evaluated.prereq-failed')
      : evaluateAssertionsPass(assertionOutcomes),
  );

  results.set('decider-resolvable', evaluateDeciderResolvable(context));
  results.set('expiry-sane', evaluateExpirySane(context));
  return results;
}

/**
 * Evaluate a proposal under Pass 0. Total: returns either a typed input-contract error
 * (no report/patch) or an evaluated `{ report, patch }`.
 */
export function evaluatePass0(input: Pass0Input): Pass0Evaluation {
  const resolution = resolveProposal(input);

  // Input-contract precondition: a schema-valid non-draft/proposed record is not a
  // proposal (candidate-status-not-proposal). No report/patch; CLI maps this to exit 2.
  if (resolution.proposed) {
    const status = resolution.proposed.frontmatter.status;
    if (!PROPOSAL_STATUSES.has(status) && NON_PROPOSAL_STATUSES.has(status)) {
      const error: Pass0InputContractError = {
        code: 'candidate-status-not-proposal',
        proposalPath: input.proposalPath,
        actualStatus: status as Pass0InputContractError['actualStatus'],
      };
      return { kind: 'input-error', error };
    }
  }

  const schemaValid = evaluateSchemaValid(resolution);
  const resultsByRule = new Map<RuleId, RuleResult>();
  resultsByRule.set('schema-valid', schemaValid);

  if (schemaValid.status === 'fail' || !resolution.proposed) {
    // Schema-invalid short-circuit: schema-valid fail + ten not-evaluated (C11).
    for (const rule of RULE_IDS) {
      if (rule === 'schema-valid') continue;
      resultsByRule.set(rule, notEvaluated(rule, 'not-evaluated.schema-invalid'));
    }
    const report = assembleReport(input.proposalPath, resultsByRule, notRequiredRouting());
    return { kind: 'evaluated', result: { report, patch: projectPatch(report) } };
  }

  const proposed: Adr = resolution.proposed;
  const context: RuleContext = {
    input,
    proposed,
    resolution,
    corpusRecords: input.corpus.records,
    acceptedRecords: acceptedRecordsExcludingCandidate(input.corpus.records, input.proposalPath),
    evaluationDate: input.evaluationDate,
  };

  for (const [rule, result] of evaluateStructuralAndBacked(context)) {
    resultsByRule.set(rule, result);
  }

  // Routing is computed after the eleven rules (R10). The proposal's canonical target
  // set is resolved once and shared by the trigger checks and named-human resolution.
  const proposalTargets = resolveRecordTargets(
    proposed,
    input.targetRegistry,
    input.targets,
    input.resolutionLog,
  );
  const contradicts = contradictsAcceptedAdr(context, proposalTargets.targetKeys);
  const routing = computeRouting(context, proposalTargets, contradicts);

  const report = assembleReport(input.proposalPath, resultsByRule, routing);
  return { kind: 'evaluated', result: { report, patch: projectPatch(report) } };
}
