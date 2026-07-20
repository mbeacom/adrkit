/**
 * @adrkit/evaluator — rule 2: id-unique (error).
 *
 * Identity is scoped by `[record.log ?? "", id]` over the candidate-inclusive corpus
 * plus optional federated-log snapshots (T018). A duplicate of the candidate's key
 * fails (`id-unique.collision`); equal ids in different named logs pass. Exactly one
 * aggregate result is emitted (C11).
 */

import type { Adr } from '@adrkit/core';
import { aggregate, passResult, type SubResult } from './kernel.ts';
import type { RuleContext } from './context.ts';
import type { FederatedLogSnapshot, RuleFinding, RuleResult } from '../types.ts';

function key(log: string | undefined, id: string): string {
  return JSON.stringify([log ?? '', id]);
}

function corpusKey(record: Adr): string {
  return key(record.log, record.frontmatter.id);
}

function federatedKeys(snapshots: readonly FederatedLogSnapshot[] | undefined): string[] {
  const keys: string[] = [];
  for (const snapshot of snapshots ?? []) {
    for (const id of snapshot.adrIds) keys.push(key(snapshot.log, id));
  }
  return keys;
}

export function evaluateIdUnique(ctx: RuleContext): RuleResult {
  const candidate = key(ctx.proposed.log, ctx.proposed.frontmatter.id);

  let occurrences = 0;
  for (const record of ctx.corpusRecords) {
    if (corpusKey(record) === candidate) occurrences += 1;
  }
  for (const federated of federatedKeys(ctx.input.federatedLogs)) {
    if (federated === candidate) occurrences += 1;
  }

  if (occurrences <= 1) {
    return passResult('id-unique');
  }

  const finding: RuleFinding = {
    reason: 'id-unique.collision',
    message: `ADR id "${ctx.proposed.frontmatter.id}" is not unique within log "${ctx.proposed.log ?? ''}"`,
    adr: ctx.proposed.frontmatter.id,
    candidateAdr: ctx.proposed.frontmatter.id,
    recordPath: ctx.proposed.path,
    field: 'id',
    lowerLevel: { rule: 'unique-id', path: ctx.proposed.path, id: ctx.proposed.frontmatter.id, field: 'id' },
  };
  const subs: SubResult[] = [{ status: 'fail', reason: 'id-unique.collision', finding }];
  return aggregate('id-unique', subs);
}
