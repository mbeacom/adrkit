/**
 * @adrkit/evaluator — rule 3: supersession-consistent (error).
 *
 * New deterministic reciprocity + cycle checks over the corpus snapshot (research
 * §R3), reusing `buildAdrGraph` for EDGES ONLY. Reciprocity: `A supersedes B` iff
 * `B.supersededBy === A`. `dangling-supersededBy` is owned exclusively by this rule
 * (C2) and suppresses the redundant non-reciprocal finding for the same ref. Cycles
 * in the supersedes relation fail with `cycle`. Exactly one aggregate result (C11).
 */

import { buildAdrGraph, type Adr } from '@adrkit/core';
import { aggregate, passResult, type SubResult } from './kernel.ts';
import type { RuleContext } from './context.ts';
import type { RuleFinding, RuleResult } from '../types.ts';

function hasSupersedesCycle(records: readonly Adr[]): boolean {
  const graph = buildAdrGraph(records);
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'supersedes') continue;
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const nodes = graph.nodes.map((node) => node.id);

  function visit(node: string): boolean {
    color.set(node, GRAY);
    for (const next of adjacency.get(node) ?? []) {
      const state = color.get(next) ?? WHITE;
      if (state === GRAY) return true;
      if (state === WHITE && visit(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const node of nodes) {
    if ((color.get(node) ?? WHITE) === WHITE && visit(node)) return true;
  }
  return false;
}

export function evaluateSupersessionConsistent(ctx: RuleContext): RuleResult {
  const records = ctx.corpusRecords;
  const ids = new Set(records.map((record) => record.frontmatter.id));
  const supersededByById = new Map<string, string>();
  for (const record of records) {
    if (record.frontmatter.supersededBy) {
      supersededByById.set(record.frontmatter.id, record.frontmatter.supersededBy);
    }
  }

  const subs: SubResult[] = [];
  const seenPairs = new Set<string>();
  const danglingRefs = new Set<string>();

  // Dangling supersededBy — owned here, once per record.
  for (const record of records) {
    const target = record.frontmatter.supersededBy;
    if (target && !ids.has(target)) {
      danglingRefs.add(`${record.frontmatter.id}->${target}`);
      const finding: RuleFinding = {
        reason: 'supersession-consistent.dangling-superseded-by',
        message: `supersededBy "${target}" does not resolve to a record in the corpus`,
        adr: record.frontmatter.id,
        candidateAdr: record.frontmatter.id,
        relatedAdr: target,
        recordPath: record.path,
        field: 'supersededBy',
        lowerLevel: { rule: 'dangling-supersededBy', path: record.path, id: record.frontmatter.id, field: 'supersededBy' },
      };
      subs.push({ status: 'fail', reason: 'supersession-consistent.dangling-superseded-by', finding });
    }
  }

  function nonReciprocal(fromId: string, toId: string, path: string, field: 'supersedes' | 'supersededBy'): void {
    const key = [fromId, toId].sort().join('|');
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    const finding: RuleFinding = {
      reason: 'supersession-consistent.non-reciprocal',
      message: `supersedes/supersededBy between "${fromId}" and "${toId}" is not reciprocal`,
      adr: fromId,
      candidateAdr: fromId,
      relatedAdr: toId,
      recordPath: path,
      field,
      lowerLevel: { rule: 'non-reciprocal', path, id: fromId, field },
    };
    subs.push({ status: 'fail', reason: 'supersession-consistent.non-reciprocal', finding });
  }

  // A supersedes B ⇒ B.supersededBy === A.
  for (const record of records) {
    for (const target of record.frontmatter.supersedes) {
      if (!ids.has(target)) continue; // orphan supersedes — owned by no-orphan-refs
      if (supersededByById.get(target) !== record.frontmatter.id) {
        nonReciprocal(record.frontmatter.id, target, record.path, 'supersedes');
      }
    }
  }

  // B.supersededBy === A ⇒ A.supersedes contains B.
  const supersedesPairs = new Set<string>();
  for (const record of records) {
    for (const target of record.frontmatter.supersedes) {
      supersedesPairs.add(`${record.frontmatter.id}=>${target}`);
    }
  }
  for (const record of records) {
    const target = record.frontmatter.supersededBy;
    if (!target || !ids.has(target)) continue; // dangling handled above
    if (danglingRefs.has(`${record.frontmatter.id}->${target}`)) continue;
    if (!supersedesPairs.has(`${target}=>${record.frontmatter.id}`)) {
      nonReciprocal(record.frontmatter.id, target, record.path, 'supersededBy');
    }
  }

  if (hasSupersedesCycle(records)) {
    subs.push({
      status: 'fail',
      reason: 'supersession-consistent.cycle',
      finding: {
        reason: 'supersession-consistent.cycle',
        message: 'The supersedes relation contains a cycle',
        lowerLevel: { rule: 'supersedes-cycle' },
      },
    });
  }

  if (subs.length === 0) return passResult('supersession-consistent');
  return aggregate('supersession-consistent', subs);
}
