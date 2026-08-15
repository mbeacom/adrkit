// T094 — the network probe used by `test/offline-run.test.ts`'s two-sided denial control.
//
// This is a standalone program, executed by a separate `bun` process on both sides of the
// control: once unsandboxed (where it MUST connect) and once under the denial mechanism
// (where it MUST be denied). It is not part of the generator and is never imported by it.
//
// It lives in its own `.mjs` file rather than in a template literal inside
// `offline-run.test.ts` because that is what it actually is. Embedding it put a literal
// `fetch(` into the adapter's TypeScript sources, where `test/input-boundary.test.ts`'s
// T045 scan correctly flagged it: that scan enforces "a generation run makes no network
// call of any kind", and it cannot distinguish a generator calling out from a control
// probe proving that generators cannot. Keeping the probe as a separate program keeps the
// call verbatim, keeps `offline-run.test.ts` fully scannable by the guards that should
// see it, and needs no entry in `EXCLUDED_FROM_SCAN`.
//
// Prints exactly one line: `CONNECTED:<status>` or `DENIED:<reason>`.

const port = process.argv[2];

try {
  const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(4000) });
  console.log(`CONNECTED:${response.status}`);
} catch (error) {
  console.log(`DENIED:${error?.message ?? error?.name ?? 'unknown'}`);
}
