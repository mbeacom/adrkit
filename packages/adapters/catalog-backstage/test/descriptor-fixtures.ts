/**
 * Shared descriptor fixtures for the D1a (admissibility and identity) tests.
 *
 * Every fixture's *expected* admissibility comes from ADR-0015's table, and every
 * fixture's expected canonical id comes from `entity-identity.md` §1. None comes
 * from running the code under test.
 */

import { type DescriptorDocument, readDescriptorDocuments } from '../src/descriptor/read.ts';

export interface DescriptorSpec {
  readonly apiVersion?: string;
  readonly kind?: string;
  readonly name?: string;
  readonly namespace?: string;
  readonly annotations?: Readonly<Record<string, string>>;
}

/** Build one parsed descriptor document from a small spec. */
export function descriptor(
  spec: DescriptorSpec,
  sourcePath = 'catalog-info.yaml',
): DescriptorDocument {
  const lines: string[] = [];
  if (spec.apiVersion !== undefined) lines.push(`apiVersion: ${JSON.stringify(spec.apiVersion)}`);
  if (spec.kind !== undefined) lines.push(`kind: ${JSON.stringify(spec.kind)}`);

  const hasMetadata =
    spec.name !== undefined || spec.namespace !== undefined || spec.annotations !== undefined;
  if (hasMetadata) {
    lines.push('metadata:');
    if (spec.name !== undefined) lines.push(`  name: ${JSON.stringify(spec.name)}`);
    if (spec.namespace !== undefined) lines.push(`  namespace: ${JSON.stringify(spec.namespace)}`);
    if (spec.annotations !== undefined) {
      lines.push('  annotations:');
      for (const [key, value] of Object.entries(spec.annotations)) {
        lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
      }
    }
  }

  const documents = readDescriptorDocuments(sourcePath, `${lines.join('\n')}\n`);
  const document = documents[0];
  if (document === undefined || document.parseOutcome !== 'parsed') {
    throw new Error(`fixture did not parse: ${document?.rejection?.detail ?? 'no document'}`);
  }
  return document;
}

/** A descriptor that passes all four validators. */
export const ADMISSIBLE: DescriptorSpec = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  name: 'payments',
};

/**
 * ADR-0015's `bulk-import` outlier: `${{ values.name }}`.
 *
 * ADR-0015 records these two as canonically **distinct** from the fourteen that
 * share `${{ values.name | dump }}` — "[b]eing canonically distinct, they collide
 * with nothing. They are exactly as invalid as the other fourteen."
 */
export const INADMISSIBLE_AND_UNIQUE_BULK_IMPORT: DescriptorSpec = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  name: '${{ values.name }}',
};

/** ADR-0015's `orchestrator` outlier: `${{ values.entityName }}`. */
export const INADMISSIBLE_AND_UNIQUE_ORCHESTRATOR: DescriptorSpec = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  name: '${{ values.entityName }}',
};

/** The form the other fourteen placeholder descriptors share. */
export const INADMISSIBLE_AND_COLLIDING: DescriptorSpec = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  name: '${{ values.name | dump }}',
};
