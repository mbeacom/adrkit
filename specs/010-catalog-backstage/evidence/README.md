# Barrier B evidence — feature 010 (`010-catalog-backstage`)

**Status of this tree: `IS THE BARRIER`.** Everything under this directory is the
anti-backfilling control that ADR-0020 clause 5(a) and clause 6 require to exist
*before any generator-derived output exists*.

Created by task **T013** (`../tasks.md`, Phase B). Populated by **T014–T018**.
Audited independently by **T019–T021**. Hash-drift-checked in CI by **T022–T023**.
Gated by the **T024** checkpoint, which no task in phases E, F, or G may precede.

---

## 1. Why this tree is tracked in git

`research.md` R5 names three enforcement mechanisms, all required, none sufficient
alone. Mechanism 2 is **hash match**: CI re-derives the content hash of every
frozen artifact and fails the build on drift. CI can only re-derive a hash of a
file it can see, so these artifacts must be **git-tracked**.

ADR-0015's Condition of Acceptance 1 records the hazard being corrected: spike
009's evidence bundle was untracked and scratch-only, so "nothing in the
repository will stop someone reusing a stale copy." An untracked freeze is not a
freeze. `plan.md` fixes this path (no prior document did), on the authority of R5
mechanism 2 together with that Condition of Acceptance.

## 2. Layout

| Path | Holds | Written by |
| --- | --- | --- |
| `frozen-expectations/` | The re-frozen oracle — `FrozenExpectationSet` (`../data-model.md` §16) | T017 |
| `frozen-expectations/audit-record.json` | The independent audit of the oracle | T019 (**not** T014–T018) |
| `accept-corpus-freeze/` | The clause-5 gate artifact — `AcceptCorpusFreeze` (`../data-model.md` §17) | T014–T016, T018 |
| `accept-corpus-freeze/adequacy-audit.json` | The independent adequacy finding | T019 (**not** T014–T018) |
| `negative-cases/` | Retained failing inputs, per ADR-0016 | T020, T021, T023, T089 |
| `barrier-b-checkpoint.json` | The `BARRIER_B_CLEARED` record | T024 |
| `comparison/` | ADR-0020 clause 5 **step (b)** — the post-output comparison | T087–T092 (**Phase F**, after the barrier cleared) |

## 3. The content-hash rule

Every frozen artifact records its own `contentHash`. T019 **recomputes** it from
the artifact rather than copying the recorded value, and T022's CI check
re-derives it on every build.

`contentHash` is the lowercase-hex **SHA-256** of the artifact's **canonical
form**, defined as:

1. Take the artifact's top-level JSON object.
2. Remove the `contentHash` key itself. Remove nothing else.
3. Serialize with a deterministic serializer that
   - orders every object's keys ascending by `compareCodeUnits`
     (`packages/core/src/ordering/index.ts` — `a < b ? -1 : a > b ? 1 : 0` over
     UTF-16 code units, never `localeCompare`),
   - preserves array element order exactly as stored,
   - emits no insignificant whitespace (no spaces, no newlines between tokens),
   - escapes strings per `JSON.stringify`,
   - emits UTF-8 with **no** trailing newline.
4. SHA-256 that byte sequence; render lowercase hex.

**Why `contentHash` is the only removal, and why the audit records live in
sibling files.** `../data-model.md` §16 and §17 give both frozen types an
`auditRecord` member. If the audit were written *into* the artifact it audits,
recording the audit would change the artifact's bytes and therefore its hash, and
the recorded hash could never match a re-derivation. The audit records are
therefore separate sibling files (`audit-record.json`, `adequacy-audit.json`),
which is also what T019's own task line specifies. The composed
`FrozenExpectationSet` / `AcceptCorpusFreeze` of the data model is the pair taken
together; the hash covers the frozen half, which is the half that must not move.

## 4. What is deliberately absent from this tree

Per R5 **mechanism 1 (input absence)** and R5 **mechanism 3 (ordering)**, and
confirmed by T024, this tree contains and must continue to contain:

- **No `InputManifest`.** No file here carries `manifestSchemaVersion`,
  `requestedSnapshotSchemaVersion`, `requiredCapabilities`, or a `sources` array
  of `{path, digestAlgorithm, digest}` records (`../data-model.md` §1). The freeze
  artifacts name a corpus by `corpusRef` (repository + commit) and name individual
  documents by `sourcePath` + `documentIndexInFile`; that is a record of *what was
  frozen*, not an input the generator may read. Absent a manifest, the generator
  has no corpus — `input-manifest.md` §5 forbids recursive walking and glob-based
  descriptor discovery, so there is no second route to one.
- **No comparison harness.** Nothing here reads generator output, because none
  exists. The harness that reads both generator output and these expectations is
  authored in Phase F (T087), strictly after this freeze and its audit.
- **No generator output.** No `SnapshotEnvelope`, and no derived-ownership result
  for any descriptor-sourced entity — not persisted, not in memory, not asserted
  in a test (`research.md` R4).

### 4.1 What §4 binds, now that Phase F has deposited (added by T087–T092)

**The three absences above are statements about the freeze**, and they still hold
of `frozen-expectations/` and `accept-corpus-freeze/` exactly as written. Nothing
in Phase F wrote to either; `comparison/expectations-unchanged.json` compares each
frozen hash, recomputed after all of Phase E and Phase F, against the value T024
recorded before any generator existed, and `scripts/check-freeze-hashes.ts` fails
the build on drift.

They were also, at the time they were written, true of this whole directory,
because Barrier B had not yet cleared. That is no longer the case, and saying so
is better than leaving a claim that quietly stopped being true:

- `comparison/` **does** hold generator output — `diff-report.json` records derived
  ownership for all 24 frozen entities, and `step-b-record.json` records the
  envelope's digest. That is the point of step (b). It could not exist before
  T024, and it is written only by tasks that list T024 in `Depends`.
- `comparison/` **is** where the harness's provenance record lives, and the
  harness itself lives in `scripts/`, not here. The third bullet above anticipated
  this: "the harness … is authored in Phase F (T087), strictly after this freeze
  and its audit."
- **No `InputManifest` is committed anywhere**, in this tree or outside it, and
  mechanism 1 is unchanged. The comparison harness builds one in a temporary
  directory at run time and deletes it; the vendored corpus it reads lives at
  `../corpus/`, outside this tree, and is pristine upstream bytes with no
  annotation of its own.

The ordering that matters is preserved and remains checkable: everything under
`frozen-expectations/` and `accept-corpus-freeze/` predates every byte under
`comparison/`, and their hashes are the ones Phase B recorded.

## 5. Standing honesty constraints on everything in this tree

1. **ADR-0014 rung 1 only.** Nothing here is reference-verified (rung 2) or
   externally validated (rung 3), and nothing here schedules or prepares a
   release. ADR-0020 authorizes the work, not the release.
2. **Only the corpus *data* is third-party.** The descriptors are real and
   authored upstream. The overlay, the expected paths, the selection basis, and
   the audit are all the maintainer's own. Per ADR-0014's honesty rules, none of
   this may be described as external, third-party, or community *validation*.
3. **Integrity is not correctness.** These artifacts fix what the output is
   *expected* to be. They do not show that any output is right. That is FR-056 /
   SC-011's job, in Phase F, on its own evidence and its own PASS/FAIL.
4. **No claim about Backstage as a running system.** The admissibility warrant
   available here is exactly what the four pinned validator predicates return at
   Backstage commit `1121a4facd9e321179d0402c3f355e4a649e84d9`.
5. **Every number names where it was read.** Corpus figures come from
   `research.md` R14 and are re-derived here; the derivation is recorded in
   `accept-corpus-freeze/selection-basis.md` §5.
