import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { emitJsonSchema, stringifyJsonSchema } from './emit.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const outputPath = resolve(repoRoot, 'schema/adr.schema.json');

await writeFile(outputPath, stringifyJsonSchema(emitJsonSchema()), 'utf8');
