/**
 * @adrkit/evaluator — rule 4: no-orphan-refs (error).
 *
 * Local `supersedes` / `relatesTo` targets must resolve. A federated ref (`<log>:<id>`)
 * resolves against a supplied federated-log snapshot; a federated ref whose log has NO
 * snapshot is inert (`federated-log-absent`), never an orphan failure (C2). `supersededBy`
 * is owned by supersession-consistent and is not re-reported here. Exactly one aggregate
 * result (C11); status precedence keeps a dangling failure above a federated inert.
 */

import type { Adr } from '@adrkit/core';
import { parseAdrRef } from '@adrkit/core';
import { aggregate, passResult, type SubResult } from './kernel.ts';
import type { RuleContext } from './context.ts';
import type { ReasonCode, RuleFinding, RuleResult } from '../types.ts';

type RefField = 'supersedes' | 'relatesTo';

export function evaluateNoOrphanRefs(ctx: RuleContext): RuleResult {
  const resolutionLog = ctx.input.resolutionLog;

  const localIds = new Set<string>();
  const knownLogs = new Map<string, Set<string>>();
  for (const record of ctx.corpusRecords) {
    if (record.log === undefined || record.log === resolutionLog) {
      localIds.add(record.frontmatter.id);
    }
    if (record.log !== undefined) {
      const set = knownLogs.get(record.log) ?? new Set<string>();
      set.add(record.frontmatter.id);
      knownLogs.set(record.log, set);
    }
  }
  for (const snapshot of ctx.input.federatedLogs ?? []) {
    const set = knownLogs.get(snapshot.log) ?? new Set<string>();
    for (const id of snapshot.adrIds) set.add(id);
    knownLogs.set(snapshot.log, set);
  }

  const subs: SubResult[] = [];

  function classify(ref: string): 'resolved' | 'dangling' | 'federated-absent' {
    const parsed = parseAdrRef(ref);
    if (parsed.log === undefined || parsed.log === resolutionLog) {
      return localIds.has(parsed.id) ? 'resolved' : 'dangling';
    }
    const known = knownLogs.get(parsed.log);
    if (!known) return 'federated-absent';
    return known.has(parsed.id) ? 'resolved' : 'dangling';
  }

  function check(record: Adr, field: RefField, refs: readonly string[]): void {
    const danglingReason: ReasonCode =
      field === 'supersedes' ? 'no-orphan-refs.dangling-supersedes' : 'no-orphan-refs.dangling-relates-to';
    const lowerRule = field === 'supersedes' ? 'dangling-supersedes' : 'dangling-relatesTo';
    for (const ref of refs) {
      const outcome = classify(ref);
      if (outcome === 'resolved') continue;
      if (outcome === 'federated-absent') {
        const finding: RuleFinding = {
          reason: 'no-orphan-refs.federated-log-absent',
          message: `Federated ref "${ref}" has no external-log snapshot; reference is inert`,
          candidateAdr: record.frontmatter.id,
          relatedAdr: ref,
          recordPath: record.path,
          field,
        };
        subs.push({ status: 'inert', reason: 'no-orphan-refs.federated-log-absent', finding });
        continue;
      }
      const finding: RuleFinding = {
        reason: danglingReason,
        message: `Reference "${ref}" in ${field} does not resolve to a record in the corpus`,
        adr: record.frontmatter.id,
        candidateAdr: record.frontmatter.id,
        relatedAdr: ref,
        recordPath: record.path,
        field,
        lowerLevel: { rule: lowerRule, path: record.path, id: record.frontmatter.id, field },
      };
      subs.push({ status: 'fail', reason: danglingReason, finding });
    }
  }

  for (const record of ctx.corpusRecords) {
    check(record, 'supersedes', record.frontmatter.supersedes);
    check(record, 'relatesTo', record.frontmatter.relatesTo);
  }

  if (subs.length === 0) return passResult('no-orphan-refs');
  return aggregate('no-orphan-refs', subs);
}
