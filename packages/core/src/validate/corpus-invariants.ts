import type { Adr } from '../schema/adr.schema.ts';
import type { Finding, FindingSeverity } from './findings.ts';

function addReferenceFinding(
  findings: Finding[],
  record: Adr,
  field: string,
  ref: string,
  severity: FindingSeverity,
): void {
  findings.push({
    rule: `dangling-${field}`,
    severity,
    message: `Reference "${ref}" in ${field} does not resolve to a record in the corpus`,
    path: record.path,
    id: record.frontmatter.id,
    field,
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
      if (!ids.has(ref)) addReferenceFinding(findings, record, 'relatesTo', ref, 'error');
    }

    for (const ref of record.frontmatter.conflictsWith) {
      if (!ids.has(ref)) {
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
