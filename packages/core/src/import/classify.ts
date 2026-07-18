import type { Adr } from '../schema/adr.schema.ts';

export type ReimportBucket = 'new' | 'updated' | 'diverged' | 'unchanged';

export interface ReimportSourceEntry {
  sourceRef: string;
  fingerprint: string;
  path?: string;
}

export interface ReimportClassification {
  sourceRef: string;
  bucket: ReimportBucket;
  recordId?: string;
}

function importedMadrSourceRef(record: Adr): string | undefined {
  const importedFrom = record.frontmatter.provenance?.importedFrom;
  if (importedFrom?.sourceKind !== 'madr') return undefined;
  return importedFrom.sourceRef;
}

export function classifyReimport(
  sourceEntries: readonly ReimportSourceEntry[],
  existingRecords: readonly Adr[],
  recordEdited: (id: string) => boolean = () => false,
): ReimportClassification[] {
  const recordsBySourceRef = new Map<string, Adr>();
  for (const record of [...existingRecords].sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id))) {
    const sourceRef = importedMadrSourceRef(record);
    if (sourceRef && !recordsBySourceRef.has(sourceRef)) {
      recordsBySourceRef.set(sourceRef, record);
    }
  }

  return [...sourceEntries]
    .sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
    .map((entry) => {
      const record = recordsBySourceRef.get(entry.sourceRef);
      if (!record) return { sourceRef: entry.sourceRef, bucket: 'new' as const };

      const storedFingerprint = record.frontmatter.provenance?.importedFrom?.fingerprint;
      if (storedFingerprint === entry.fingerprint) {
        return { sourceRef: entry.sourceRef, bucket: 'unchanged' as const, recordId: record.frontmatter.id };
      }

      return {
        sourceRef: entry.sourceRef,
        bucket: recordEdited(record.frontmatter.id) ? ('diverged' as const) : ('updated' as const),
        recordId: record.frontmatter.id,
      };
    });
}
