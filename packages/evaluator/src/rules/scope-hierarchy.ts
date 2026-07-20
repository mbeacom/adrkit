/**
 * @adrkit/evaluator — rule 7: scope-hierarchy (error).
 *
 * A `component` proposal that overlaps an APPLICABLE accepted `org` ADR whose assertion
 * was GREEN on the supplied base input and FAILS on the supplied proposed input is an
 * attributable contradiction ⇒ error (research §R5). Domain applicability is explicit:
 * an org ADR with no domain is global; otherwise it applies only on exact domain
 * equality. The evaluator itself compiles + evaluates the accepted assertion (it never
 * accepts a precomputed verdict). Missing engine/source/base/proposed evidence is inert;
 * a non-component proposal or one with no applicable org overlap passes.
 */

import type { Adr } from '@adrkit/core';
import { aggregate, passResult, type SubResult } from './kernel.ts';
import type { RuleContext } from './context.ts';
import { compileAssertionForScope } from '../assertions/evaluate.ts';
import { makeAssertionKey } from '../keys.ts';
import { resolveRecordTargets } from '../targets/canonical.ts';
import { byCodeUnit } from '../compare.ts';
import type { RuleResult } from '../types.ts';

function domainApplies(orgRecord: Adr, proposal: Adr): boolean {
  const orgDomain = orgRecord.frontmatter.domain;
  if (orgDomain === undefined) return true; // org-with-no-domain is global
  return orgDomain === proposal.frontmatter.domain;
}

export function evaluateScopeHierarchy(ctx: RuleContext): RuleResult {
  const proposal = ctx.proposed;
  if (proposal.frontmatter.scope !== 'component') {
    return passResult('scope-hierarchy', 'scope-hierarchy.not-applicable-scope');
  }

  const proposalTargets = resolveRecordTargets(proposal, ctx.input.targetRegistry, ctx.input.targets, ctx.input.resolutionLog);
  const applicableOrgAdrs = ctx.acceptedRecords.filter((record) => {
    if (record.frontmatter.scope !== 'org') return false;
    if (!domainApplies(record, proposal)) return false;
    const orgTargets = resolveRecordTargets(record, ctx.input.targetRegistry, ctx.input.targets, ctx.input.resolutionLog);
    return [...proposalTargets.targetKeys].some((key) => orgTargets.targetKeys.has(key));
  });

  if (applicableOrgAdrs.length === 0) {
    return passResult('scope-hierarchy', 'scope-hierarchy.ok');
  }

  const subs: SubResult[] = [];
  const transitions: string[] = [];

  for (const orgRecord of applicableOrgAdrs) {
    for (const assertion of orgRecord.frontmatter.assertions) {
      const key = makeAssertionKey(orgRecord.log, orgRecord.path, assertion.id);
      const compiled = compileAssertionForScope(ctx, orgRecord, assertion);
      if (!compiled.ok) {
        const reason =
          compiled.reason === 'engine-absent'
            ? 'scope-hierarchy.engine-absent'
            : 'scope-hierarchy.source-absent';
        subs.push({ status: 'inert', reason });
        continue;
      }
      const baseInput = ctx.input.scopeEvidence?.baseInputs?.[key]?.document;
      if (baseInput === undefined) {
        subs.push({ status: 'inert', reason: 'scope-hierarchy.base-input-absent' });
        continue;
      }
      const proposedInput = ctx.input.assertionInputs.inputs[key]?.document;
      if (proposedInput === undefined) {
        subs.push({ status: 'inert', reason: 'scope-hierarchy.proposed-input-absent' });
        continue;
      }
      const baseEval = compiled.evaluate(baseInput);
      const proposedEval = compiled.evaluate(proposedInput);
      if (!baseEval.ok || !proposedEval.ok) {
        subs.push({ status: 'inert', reason: 'scope-hierarchy.evidence-absent' });
        continue;
      }
      if (baseEval.pass && !proposedEval.pass) {
        transitions.push(`${orgRecord.frontmatter.id}:${assertion.id}`);
        subs.push({
          status: 'fail',
          reason: 'scope-hierarchy.contradicts-org-assertion',
          finding: {
            reason: 'scope-hierarchy.contradicts-org-assertion',
            candidateAdr: proposal.frontmatter.id,
            relatedAdr: orgRecord.frontmatter.id,
            assertionKey: key,
            message: `Proposal turns accepted org assertion "${orgRecord.frontmatter.id}:${assertion.id}" from green to red`,
          },
        });
      }
    }
  }

  if (subs.length === 0) return passResult('scope-hierarchy', 'scope-hierarchy.ok');
  return aggregate('scope-hierarchy', subs, transitions.length > 0 ? { assertionTransitions: [...transitions].sort(byCodeUnit) } : undefined);
}
