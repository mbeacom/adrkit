import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emitJsonSchema } from '../src/schema/emit.ts';

test('fresh schema emit equals the committed schema artifact', async () => {
  const committed = JSON.parse(await readFile(resolve(process.cwd(), 'schema/adr.schema.json'), 'utf8'));
  expect(emitJsonSchema()).toEqual(committed);
});
