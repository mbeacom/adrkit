# Envelope fixtures

Hand-authored, **entirely synthetic** snapshot envelopes. No external adopter is
involved and no third-party content appears in any of them —
[`snapshot-envelope.md`](../../../../specs/009-catalog-binding-viability/contracts/snapshot-envelope.md)
§7 requires that, and it is why what these fixtures prove is mechanical and
offline, not external, third-party, or community validation (ADR-0014 rung 3).

[`author.ts`](./author.ts) is the record of how each was constructed. Re-running
it rewrites the same bytes.

## Two synthetic repositories

| | Repository id | Revision |
|---|---|---|
| **A** | `github.com/mbeacom/adrkit-envelope-consumer-fixture` | `1e0f3c9a8b7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f` |
| **A, stale** | same | `f0e9d8c7b6a594837261504938271605948372a1` |
| **B** | `github.com/mbeacom/adrkit-envelope-consumer-fixture-second` | `2b7c4d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c` |

`sources/` is the `sourceBaseDir` for step 4. Its two YAML files are the bytes
each envelope's `sources[].digest` is checked against.

## The files

| File | Construction | Expected outcome |
|---|---|---|
| `valid.json` | Repository A, three entities covering all three ownership states, correct source digest, correct self-digest | Admitted |
| `all-annotation-absent.json` | As `valid.json` but **every** entity is `annotation-absent`, with `completeness.identityOnly: false` | **Accepted.** The contrast case: step 5 reads the boolean, never the ownership-state distribution (`snapshot-envelope.md` §7 row 1b) |
| `malformed-invalid-json.json` | `valid.json` truncated mid-token | Rejected at **step 1**, `invalid-json` |
| `malformed-missing-or-wrong-field.json` | `entities[1].identity.allRefs` replaced with a string | Rejected at **step 2**, `missing-or-wrong-required-field`. Deliberately nested two levels deep — a top-level-only shape check would let it through |
| `malformed-unrecognized.json` | `globDialect.engine` set to `"minimatch"` | Rejected at **step 3**, `unrecognized-schema-or-dialect-or-capability` |
| `malformed-missing-source-digest.json` | The one `sources` entry omits `digest`; otherwise well-formed | Rejected at **step 4**, `missing-source-digest`. It must **pass** steps 2 and 3 — that is the whole point of the fixture |
| `malformed-identity-only.json` | `completeness.identityOnly: true`, everything else correct **including the source digest**, so steps 1–4 all pass | Rejected at **step 5**, `identity-only-true` |
| `tampered.json` | `entities[0].derivedPaths` gained an element **after** the digest was computed | Passes all five steps; refused on **digest mismatch** |
| `stale.json` | Repository A at a different revision, self-digest **recomputed over its own actual content** | Passes all five steps **and the digest**; refused as **stale** |
| `wrong-repository.json` | Repository B, valid in its own right, self-digest recomputed over its own content | Refused as **misidentified** by a consumer expecting A; **accepted** by an isolation query alongside `valid.json` |

The last two are the constructions that are easy to get wrong. Their digests are
recomputed over their mutated content on purpose, so that the rejection is
attributable specifically to staleness or identity and **never** to a
coincidental digest failure (`snapshot-envelope.md` §4, §5).

`wrong-repository.json` does double duty, and the two roles must not be
conflated: §5's mismatch-and-reject (a consumer that expected exactly one
repository) and §6's filter-and-isolate (a consumer deliberately holding
several). It is the same file because it is the same envelope — what differs is
what the consumer was configured to expect.
