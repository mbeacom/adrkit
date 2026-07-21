/**
 * @adrkit/core — the canonical corpus fingerprint helpers.
 *
 * Promoted verbatim from `@adrkit/mcp` (`packages/mcp/src/corpus/projection.ts`
 * lines ~172–195) so the MCP corpus projection and the queue kernel produce the
 * same SHA-256 for the same projection inputs. `canonicalStringify` is a locale-
 * independent JSON serializer (code-unit key ordering, undefined omission, compact,
 * UTF-8); `fingerprintOf` hashes the canonical projection of the corpus snapshot.
 */

import { createHash } from 'node:crypto';
import type { Adr } from '../schema/adr.schema.ts';
import type { Finding } from '../validate/findings.ts';
import { compareCodeUnits } from '../ordering/index.ts';

export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareCodeUnits);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(',')}}`;
  }
  return 'null';
}

export function fingerprintOf(
  records: readonly Adr[],
  corpusFindings: readonly Finding[],
  recordCount: number,
  excludedCount: number,
): string {
  const projection = {
    records: records.map((record) => ({ sourcePath: record.path, frontmatter: record.frontmatter, body: record.body })),
    corpusFindings,
    corpusHealth: { recordCount, excludedCount },
  };
  return createHash('sha256').update(canonicalStringify(projection), 'utf8').digest('hex');
}
