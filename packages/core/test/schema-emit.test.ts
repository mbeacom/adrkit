import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emitJsonSchema } from '../src/schema/emit.ts';
import { DeterministicFinding, Evaluation } from '../src/schema/adr.schema.ts';

test('fresh schema emit equals the committed schema artifact', async () => {
  const committed = JSON.parse(await readFile(resolve(process.cwd(), 'schema/adr.schema.json'), 'utf8'));
  expect(emitJsonSchema()).toEqual(committed);
});

// The deterministic evaluator (Phase 4) projects its patch onto exactly these committed
// shapes (research §R8). Pinning them here proves the evaluator needs NO Zod / JSON
// Schema edit; the emit assertion above proves `schema/adr.schema.json` stays byte-clean.
test('DeterministicFinding is exactly { rule, severity, message?, adr? }', () => {
  expect(DeterministicFinding.safeParse({ rule: 'schema-valid', severity: 'error' }).success).toBe(true);
  expect(DeterministicFinding.safeParse({ rule: 'id-unique', severity: 'error', message: 'x', adr: '0042' }).success).toBe(true);
  // no extra evidence fields may ride the schema-compatible patch
  expect(DeterministicFinding.safeParse({ rule: 'r', severity: 'error', target: 'path:x' }).success).toBe(false);
  // a filesystem path is not a valid AdrRef
  expect(DeterministicFinding.safeParse({ rule: 'r', severity: 'error', adr: 'docs/adr/0042-x.md' }).success).toBe(false);
});

test('the evaluator patch shape validates against the committed Evaluation type', () => {
  const patch = { deterministicFindings: [{ rule: 'id-unique', severity: 'error' }], escalate: true, escalationReasons: ['one-way-door'] };
  expect(Evaluation.safeParse(patch).success).toBe(true);
});
