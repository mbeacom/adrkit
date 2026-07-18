import { z } from 'zod';
import { AdrFrontmatter, SCHEMA_VERSION } from './adr.schema.ts';

export const ADR_SCHEMA_ID = `https://adrkit.dev/schema/adr/v${SCHEMA_VERSION}/adr.schema.json`;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function sortJson(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }

  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(input).sort()) {
      output[key] = sortJson(input[key]);
    }
    return output;
  }

  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }

  throw new TypeError(`Cannot serialize JSON schema value of type ${typeof value}`);
}

export function emitJsonSchema(): JsonValue {
  const schema = z.toJSONSchema(AdrFrontmatter);
  const withMetadata = {
    ...schema,
    $id: ADR_SCHEMA_ID,
    title: 'Architecture Decision Record',
    description:
      'Typed frontmatter for a decision record. A superset of MADR: every MADR field is present or derivable, plus governance, routing, provenance, and enforcement metadata. The markdown body below the frontmatter carries the prose.',
  };

  return sortJson(withMetadata);
}

export function stringifyJsonSchema(schema: JsonValue = emitJsonSchema()): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
