/**
 * T094 — the generation driver executed **inside** the network-denial sandbox.
 *
 * This is not a test file. It is the process `test/offline-run.test.ts` spawns under
 * one of `scale-and-security-measurement.md` §5's two qualifying denial mechanisms, so
 * that the derivation run itself — not merely the test harness around it — happens with
 * network access actively denied.
 *
 * It is deliberately tiny and does exactly one thing: read a `GenerationRequest` from a
 * JSON file, run the assembled pipeline, write the envelope, and print a one-line JSON
 * verdict on stdout. Anything richer would put logic inside the sandbox that the
 * unsandboxed comparison run does not also execute, and the two runs must be the same
 * work for the byte-identity comparison to mean anything.
 *
 * Usage: `bun test/offline-run-driver.ts <request.json> <envelope-destination>`
 */

import { readFile } from 'node:fs/promises';
import { generateAndWriteEnvelope } from '../src/pipeline.ts';
import type { GenerationRequest } from '../src/pipeline.ts';

const [requestPath, destination] = process.argv.slice(2);

if (requestPath === undefined || destination === undefined) {
  console.log(JSON.stringify({ ok: false, error: 'usage: <request.json> <destination>' }));
  process.exit(2);
}

const request = JSON.parse(await readFile(requestPath, 'utf8')) as GenerationRequest;
const result = await generateAndWriteEnvelope(request, destination);

console.log(
  JSON.stringify(
    result.ok
      ? { ok: true, entities: result.envelope.entities.length, digest: result.envelope.digest }
      : { ok: false, triggerClass: result.failure.triggerClass, reason: result.failure.reason },
  ),
);
