import type { Adr } from '../schema/adr.schema.ts';
import { parseAdrRef } from '../schema/ref.ts';
import type { Finding, FindingSeverity } from './findings.ts';

function addReferenceFinding(
  findings: Finding[],
  record: Adr,
  field: string,
  ref: string,
  severity: FindingSeverity,
): void {
  // ADR-0059 clause 4: a log-qualified supersession target stays a dangling error, and the
  // message says why, so nobody reads it as a typo to fix in this corpus.
  const crossLog = parseAdrRef(ref).log !== undefined;
  findings.push({
    rule: `dangling-${field}`,
    severity,
    message: crossLog
      ? `Reference "${ref}" in ${field} names another decision log; cross-repository supersession is not supported`
      : `Reference "${ref}" in ${field} does not resolve to a record in the corpus`,
    path: record.path,
    id: record.frontmatter.id,
    field,
  });
}

/**
 * A log-qualified `relatesTo` or `conflictsWith` (`payments:0012`) names a record in another
 * decision log, which a single corpus cannot judge. ADR-0059 clause 5 (amending ADR-0031
 * clause 5) reports it at `info`, as the marker resolver's `marker-unresolvable`, the
 * evaluator's `no-orphan-refs.federated-log-absent`, and MCP's `federated-log-unavailable`
 * already treat the same input: inert here, not broken. It never resolves against a local
 * record with the same bare id.
 */
function addFederatedReferenceFinding(findings: Finding[], record: Adr, field: string, ref: string, log: string): void {
  findings.push({
    rule: 'federated-ref-unresolved',
    severity: 'info',
    message: `Reference "${ref}" in ${field} names another decision log ("${log}") and is inert against this corpus`,
    path: record.path,
    id: record.frontmatter.id,
    field,
    pattern: ref,
  });
}

export function validateCorpusInvariants(records: readonly Adr[]): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map<string, Adr[]>();

  for (const record of records) {
    const recordsForId = byId.get(record.frontmatter.id) ?? [];
    recordsForId.push(record);
    byId.set(record.frontmatter.id, recordsForId);
  }

  for (const [id, duplicates] of byId) {
    if (duplicates.length <= 1) continue;
    const paths = duplicates.map((record) => record.path).sort();
    for (const record of duplicates) {
      findings.push({
        rule: 'unique-id',
        severity: 'error',
        message: `ADR id "${id}" is used by multiple records: ${paths.join(', ')}`,
        path: record.path,
        id,
        field: 'id',
      });
    }
  }

  const ids = new Set(byId.keys());
  for (const record of records) {
    for (const ref of record.frontmatter.supersedes) {
      if (!ids.has(ref)) addReferenceFinding(findings, record, 'supersedes', ref, 'error');
    }

    if (record.frontmatter.supersededBy && !ids.has(record.frontmatter.supersededBy)) {
      addReferenceFinding(findings, record, 'supersededBy', record.frontmatter.supersededBy, 'error');
    }

    for (const ref of record.frontmatter.relatesTo) {
      const { log } = parseAdrRef(ref);
      if (log !== undefined) addFederatedReferenceFinding(findings, record, 'relatesTo', ref, log);
      else if (!ids.has(ref)) addReferenceFinding(findings, record, 'relatesTo', ref, 'error');
    }

    for (const ref of record.frontmatter.conflictsWith) {
      const { log } = parseAdrRef(ref);
      if (log !== undefined) {
        addFederatedReferenceFinding(findings, record, 'conflictsWith', ref, log);
      } else if (!ids.has(ref)) {
        addReferenceFinding(findings, record, 'conflictsWith', ref, 'warn');
      } else if (record.frontmatter.status === 'accepted') {
        findings.push({
          rule: 'accepted-conflictsWith',
          severity: 'warn',
          message: `Accepted ADR declares a known conflict with "${ref}"`,
          path: record.path,
          id: record.frontmatter.id,
          field: 'conflictsWith',
        });
      }
    }
  }

  return findings;
}
