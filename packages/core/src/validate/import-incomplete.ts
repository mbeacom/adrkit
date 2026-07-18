import type { Adr } from '../schema/adr.schema.ts';
import type { Finding } from './findings.ts';

export function validateImportIncomplete(records: readonly Adr[]): Finding[] {
  const findings: Finding[] = [];

  for (const record of records) {
    if (!record.frontmatter.provenance?.importedFrom) continue;

    if (record.frontmatter.status === 'accepted' && record.frontmatter.deciders.length === 0) {
      findings.push({
        rule: 'import-incomplete',
        severity: 'info',
        message: 'Imported accepted decision has no deciders; provenance explains the gap, but it should be backfilled when known',
        path: record.path,
        id: record.frontmatter.id,
        field: 'deciders',
      });
    }
  }

  return findings;
}
