# assertions fixtures

Assertion compile/evaluate scenarios are constructed as in-memory immutable records +
resolved sources/inputs + registered engine ports in `assertions.test.ts` (offline, via
`test/support.ts`). The JSONPath engine is the real `jsonpath-rfc9535` source profile;
Rego is exercised through the strict `application/vnd.adrkit.rego-wasm-policy.v1+json`
envelope validator plus a trusted in-memory compiled-artifact port (adrkit never executes
Wasm). Assertion keys are the compact `JSON.stringify([log ?? "", path, id])` form.
