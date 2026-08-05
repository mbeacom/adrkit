# Negative case: the envelope's invariants

**Tasks**: T070, T072, T079, T080, T081, T082 · **Discharges**: FR-014, FR-024, FR-038,
FR-039, FR-040, FR-043 · **Supports**: SC-013
**Observed against**: `19f316413d5550b30296e7987c74d267c96655f9` plus Phase E's own
uncommitted work; in each case the named mutation was the only additional change in the
tree, and it was reverted before the next case was run.
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for every case below**: `bun test <named test files>`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated cases**: `test/completeness-always-false.test.ts`,
`test/envelope-shape.test.ts`, `test/envelope-digest.test.ts`,
`test/envelope-provenance.test.ts`, `test/envelope-only.test.ts`, `test/overlap.test.ts`,
`test/sc-013.test.ts`

---

## Case 1 — whole-catalog completeness claimed

Input: [`case-1-whole-catalog-completeness-claimed.patch`](./case-1-whole-catalog-completeness-claimed.patch) ·
Output: [`case-1-whole-catalog-completeness-claimed.observed.txt`](./case-1-whole-catalog-completeness-claimed.observed.txt)

FR-014 and `input-manifest.md` §5's fourth bullet: `completeness.wholeCatalog` "is always
`false` for every envelope". It is not a default; it is the only value, because FR-013
forbids tree traversal so no run can ever have seen the whole catalog.

Six tests fail — both of the by-construction checks and all four of the real-run ones:

```
(fail) T070 — no parameter can set it > identityOnly false leaves wholeCatalog false
(fail) T070 — no parameter can set it > identityOnly true still leaves wholeCatalog false
(fail) T070 — every envelope a real run produces carries false > a single-entity run
(fail) T070 — every envelope a real run produces carries false > a run over all three ownership states and several sources
(fail) T070 — every envelope a real run produces carries false > a run over a multi-document source file
(fail) T070 — every envelope a real run produces carries false > a run with identityOnly requested still reports wholeCatalog false
```

## Case 2 — the entity record spreads instead of projecting

Input: [`case-2-entity-record-spreads-instead-of-projecting.patch`](./case-2-entity-record-spreads-instead-of-projecting.patch) ·
Output: [`case-2-entity-record-spreads-instead-of-projecting.observed.txt`](./case-2-entity-record-spreads-instead-of-projecting.observed.txt)

`data-model.md` §10 requires **exactly five** fields per record and forbids "a flatter
`canonicalId` / `refs` / `paths` triple". A spread of the pipeline's internal entity
carries the extra fields through and keeps doing so silently as that type grows:

```
(fail) T080 / data-model.md §10 — exactly five fields per entity record > every emitted record carries exactly those five
(fail) T080 — the flatter shape is forbidden > no entity record carries a flat canonicalId, refs or paths field
(fail) T080 — entityRecord projects rather than spreads > an input carrying extra fields does not leak them into the record
(fail) T085 / SC-013 — each entity record carries exactly five fields > every record has exactly the five defined fields
```

The forbidden-fields check fires as well as the count check, which is why both exist: a
spread that added exactly zero net fields would still be wrong, and a record with three
flat fields would fail a count check for the wrong reason.

## Case 3 — the digest computed over a non-canonical serialization

Input: [`case-3-digest-over-a-non-canonical-serialization.patch`](./case-3-digest-over-a-non-canonical-serialization.patch) ·
Output: [`case-3-digest-over-a-non-canonical-serialization.observed.txt`](./case-3-digest-over-a-non-canonical-serialization.observed.txt)

`snapshot-envelope.md` §3 fixes the canonical form: recursive key sort by code-unit
order, arrays in declaration order, compact separators, `undefined` omitted. Replacing
`canonicalStringify` with `JSON.stringify` keeps producing a plausible 64-hex digest that
no independent recomputation agrees with:

```
(fail) T081 — the canonical form is canonical > keys are sorted by code units at every nesting level
(fail) T081 — an independent recomputation agrees > recomputing from the canonical form with node:crypto matches the recorded digest
(fail) T081 — the digest is a function of content, not of field order > reordering top-level keys leaves the digest unchanged
(fail) T085 / SC-013 — the digest matches an independent recomputation > the independent recomputation agrees with the recorded digest
(fail) T085 / SC-013 — the digest matches an independent recomputation > the recomputation is order-insensitive at every nesting level
```

This is the case that shows why SC-013 asks for an **independent** recomputation.
`verifyEnvelopeDigest` still reports `match` under this mutation, because it shares the
mutated serializer with the code that produced the digest. Only the recomputation in
`test/sc-013.test.ts`, which implements §3's steps separately, disagrees.

**Scope, restated because this is the digest's record:** for the envelope's closed
scalar domain the canonical bytes are *equivalent to* RFC 8785 / JCS output; no claim is
made that `canonicalStringify` is a general-purpose RFC 8785 implementation. The digest
proves accidental-corruption and naive-mutation detection **only** (FR-041), never
adversarial tamper-resistance. And integrity is not correctness (SC-012).

## Case 4 — provenance defaulted to `upstream-authored`

Input: [`case-4-provenance-defaulted-to-upstream-authored.patch`](./case-4-provenance-defaulted-to-upstream-authored.patch) ·
Output: [`case-4-provenance-defaulted-to-upstream-authored.observed.txt`](./case-4-provenance-defaulted-to-upstream-authored.observed.txt)

`data-model.md` §10 closes the provenance domain at two values and FR-043 makes the
distinction load-bearing. A default of `upstream-authored` would turn a **caller's
omission** into a claim that a **third party** adopted the annotation — the overclaim
ADR-0020 clause 5's boundary exists to prevent.

**One test fails, and the reason it is only one is itself the finding:**

```
(fail) T082 — the declaration is exhaustive and has no default > provenanceFor throws rather than substituting a value
```

`checkProvenanceDeclaration` runs first and still rejects the incomplete declaration, so
no envelope carrying a defaulted value is ever emitted. The two checks are
defence in depth rather than duplicates: the earlier one refuses the request, and this
one refuses to fabricate an attestation if the earlier one is ever bypassed. Recorded
plainly rather than presented as a broad failure, because a single failing test is a
weaker observation and saying so is the honest reading. Case 4 of the `triggers/`
directory covers the earlier check's own failure.

## Case 5 — a side file written alongside the envelope

Input: [`case-5-a-side-file-written-alongside-the-envelope.patch`](./case-5-a-side-file-written-alongside-the-envelope.patch) ·
Output: [`case-5-a-side-file-written-alongside-the-envelope.observed.txt`](./case-5-a-side-file-written-alongside-the-envelope.observed.txt)

ADR-0020 clause 7, quoted by FR-038: "The generator writes the envelope and nothing
else." Writing a plausible-looking stage log next to it fails seven tests:

```
(fail) T079 — exactly one file is written > a successful run leaves one file, and it is the envelope
(fail) T079 — exactly one file is written > a second run into the same directory still leaves one file
(fail) T079 — exactly one file is written > a pre-existing unrelated file is left alone rather than cleaned up
(fail) T079 — diagnostics are returned, never written > the stage trace is a returned value and appears in no file
(fail) T079 — writeEnvelope writes one file and creates its directory > a nested destination directory is created
(fail) T085 / SC-013 — exactly one envelope is produced > the destination directory holds exactly one file
```

The mutation is deliberately the *most defensible-looking* violation available — a
diagnostic log, not a second snapshot — because that is the one a reasonable
implementer would actually add. FR-038 names "logs presented as output" specifically.

## Case 6 — overlap resolved by an exclusive winner

Input: [`case-6-overlap-resolved-by-an-exclusive-winner.patch`](./case-6-overlap-resolved-by-an-exclusive-winner.patch) ·
Output: [`case-6-overlap-resolved-by-an-exclusive-winner.observed.txt`](./case-6-overlap-resolved-by-an-exclusive-winner.observed.txt)

`entity-identity.md` §4: a changed file matching an overlapping pattern "MUST be recorded
as owned by **every** matching entity simultaneously", mirroring ADR-0009's
union-not-winner `affects` semantics. §4 requires this be "**positively demonstrated**...
not merely asserted by the absence of a rejection rule."

Truncating the owner list to its first element is exactly the exclusive winner §4
forbids, and it produces **no rejection at all** — which is why the positive
demonstration is necessary:

```
(fail) T072 / §4 — no exclusive winner: a changed file is owned by every match > both entities own a file matching the shared pattern
(fail) T072 / §4 — no exclusive winner: a changed file is owned by every match > the result is a list, so a caller cannot read "the owner" off it
```

Note that the "a file matching only one pattern is owned by only that entity" contrast
case keeps passing under the mutation. Without the positive check, a suite would be
green.

## Restored

[`restored.observed.txt`](./restored.observed.txt) — all tests pass, 0 fail, across the
seven named test files.

## Standing constraints

ADR-0014 **rung 1 only**. Nothing here is external, third-party, or community
validation. Nothing here claims the derived ownership is correct: a digest establishes
integrity, and correctness is SC-011's question, which is Phase F's.
