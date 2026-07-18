import { describe, expect, test } from 'bun:test';
import { emitJsonSchema, ADR_SCHEMA_ID } from '../src/schema/emit.ts';

describe('emitted schema shape', () => {
  const schema = emitJsonSchema() as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>>;

  test('advertises the stable schema id and schemaVersion default', () => {
    expect(schema.$id).toBe(ADR_SCHEMA_ID);
    expect(properties.schemaVersion?.default).toBe('0.1.0');
  });

  test('requires exactly the top-level fields that have no defaults', () => {
    const required = schema.required as string[];
    expect(required).toEqual(['id', 'title', 'status', 'date']);
    for (const defaultedField of ['schemaVersion', 'deciders', 'affects']) {
      expect(required).not.toContain(defaultedField);
    }
    expect(schema.additionalProperties).toBe(false);
  });

  test('emits JSON Schema uniqueItems for unique arrays', () => {
    expect(properties.tags?.uniqueItems).toBe(true);
    expect(properties.supersedes?.uniqueItems).toBe(true);
  });

  test('does not encode Zod refine-only invariants in JSON Schema', () => {
    const serialized = JSON.stringify(schema);
    expect(serialized).not.toContain('one-way-door decisions may not take the auto-approve fast path');
    expect(serialized).not.toContain('an accepted decision must name at least one decider');
  });
});
