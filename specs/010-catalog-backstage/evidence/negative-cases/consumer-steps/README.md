# Negative case: each of the five consumer validation steps, deleted in turn

**Task**: T029 · **Supplies**: the ADR-0016 observations behind FR-045 and SC-014
**Contract**: [`snapshot-envelope.md`](../../../../009-catalog-binding-viability/contracts/snapshot-envelope.md) §2, §7
**Observed against**: worktree at `99ba8d2500eaf37625ea164f66b4a17870e40dad` plus the
Phase C working tree, `packages/catalog-envelope/src/validate/index.ts` otherwise unmodified
**Tools**: Bun 1.3.14
**Permanent automated case**: `packages/catalog-envelope/test/validate-steps.test.ts`

## Why the fixtures alone were not treated as the observation

The five malformed fixtures are permanent negative inputs, and driving them
through the validator shows five distinct rejections. That establishes the
fixtures reject — it does **not** establish that each *step* is load-bearing. A
validator that rejected everything at step 2 would still produce a rejection for
every fixture.

So the observation constructed here is one level up: **each of the five steps was
deleted from the validator in turn**, the suite was run, and the failure was
captured verbatim. What that proves is the thing ADR-0016 asks for — that
removing a check makes a test go red, and therefore that the green test is
reporting something it actually looked at.

## The five reasons, as emitted

Captured from the restored (unmutated) validator:

| Fixture | Step | `reason` | `detail` |
|---|---|---|---|
| `malformed-invalid-json.json` | 1 | `invalid-json` | `envelope does not parse as JSON: SyntaxError: JSON Parse error: Unterminated string` |
| `malformed-missing-or-wrong-field.json` | 2 | `missing-or-wrong-required-field` | `entities[1].identity.allRefs is not a string array` |
| `malformed-unrecognized.json` | 3 | `unrecognized-schema-or-dialect-or-capability` | `globDialect.engine is "minimatch", expected "picomatch"` |
| `malformed-missing-source-digest.json` | 4 | `missing-source-digest` | `sources[0] (catalog-info.yaml) declares no digest` |
| `malformed-identity-only.json` | 5 | `identity-only-true` | `completeness.identityOnly is true, so this envelope is partial/identity-only and unusable for path-ownership matching` |

Each is rejected at **its own** step — none earlier. The `examined.stepsReached`
field records the highest step reached, and it equals the failing step in every
row, so "rejected for the right reason" is asserted rather than assumed.

Two acceptance rows belong here as well, because a rejection table on its own
cannot show that the validator ever accepts anything:

| Fixture | Outcome | Why it matters |
|---|---|---|
| `valid.json` | **valid**, `stepsReached: 5`, `entityRecordsInspected: 3`, `sourcesVerified: ["catalog-info.yaml"]` | The positive control |
| `all-annotation-absent.json` | **valid** | `snapshot-envelope.md` §7 row 1b. Every entity is `annotation-absent` and `identityOnly` is `false`. Step 5 reads the boolean and **never** scans the ownership-state distribution; rejecting here would be the specific bug step 5's wording exists to prevent |

## The five observations

Each row: apply the patch, run `bun test packages/catalog-envelope/test/validate-steps.test.ts`,
capture, revert.

| Deleted step | Patch | Observed | Result |
|---|---|---|---|
| 1 — valid JSON | [`step-1-json-parse-deleted.patch`](./step-1-json-parse-deleted.patch) | [`.observed.txt`](./step-1-json-parse-deleted.observed.txt) | **40 pass, 2 fail**, exit 1 |
| 2 — complete shape at every nesting level | [`step-2-entity-shape-deleted.patch`](./step-2-entity-shape-deleted.patch) | [`.observed.txt`](./step-2-entity-shape-deleted.observed.txt) | **33 pass, 9 fail**, exit 1 |
| 3 — frozen matcher contract by exact value | [`step-3-dialect-exact-value-deleted.patch`](./step-3-dialect-exact-value-deleted.patch) | [`.observed.txt`](./step-3-dialect-exact-value-deleted.observed.txt) | **40 pass, 2 fail**, exit 1 |
| 4 — every source digest present and matching | [`step-4-source-digest-deleted.patch`](./step-4-source-digest-deleted.patch) | [`.observed.txt`](./step-4-source-digest-deleted.observed.txt) | **35 pass, 7 fail**, exit 1 |
| 5 — `completeness.identityOnly === false` | [`step-5-identity-only-deleted.patch`](./step-5-identity-only-deleted.patch) | [`.observed.txt`](./step-5-identity-only-deleted.observed.txt) | **39 pass, 3 fail**, exit 1 |

Restored: [`restored.observed.txt`](./restored.observed.txt) — **42 pass, 0 fail**, exit 0.

### What the failure sets show, beyond "it went red"

The interesting part is *which* tests failed, because it confirms each deletion
was localized rather than breaking everything:

- **Step 1 deleted.** Only the step-1 case and the consolidated five-reason case
  fail. The other four fixtures still reject at their own steps. The failure mode
  is a thrown `SyntaxError` escaping `validateEnvelope`, not a wrong rejection —
  visible in the captured stack.
- **Step 2 deleted** (entity-record shape check short-circuited to `undefined`).
  Nine fail: the step-2 fixture, the consolidated case, and the seven nested
  entity-level malformations. Every one of those seven is a case that a
  top-level-only shape check would have let through, so this is also the
  observation that the "at **every** nesting level" clause is real.
- **Step 3 deleted** (the `globDialect.engine` exact-value comparison). Two fail.
  The seven other step-3 variants — `schemaVersion`, `globDialect.version`, the
  three `options` flags, and the three `capabilities` shapes — still pass,
  because each is a separate comparison. That is the evidence that step 3 is not
  one check wearing three names.
- **Step 4 deleted** (the source-digest loop skipped). Seven fail, including
  `the valid fixture passes all five steps` — because `sourcesVerified` becomes
  empty, and the positive control asserts on the specific list of sources
  actually opened. A validator that silently verified nothing would otherwise
  render identically to one that verified everything.
- **Step 5 deleted.** Three fail, including the ordering assertion that step 5 is
  reached only after every source digest is verified.

## Reproducing

```bash
git apply specs/010-catalog-backstage/evidence/negative-cases/consumer-steps/step-3-dialect-exact-value-deleted.patch
bun test packages/catalog-envelope/test/validate-steps.test.ts   # expect exit 1
git checkout -- packages/catalog-envelope/src/validate/index.ts
bun test packages/catalog-envelope/test/validate-steps.test.ts   # expect exit 0
```

## Standing constraints

Every fixture driven here is **synthetic and hand-authored**; no external adopter
is involved, exactly as `snapshot-envelope.md` §7 requires. These are mechanical,
offline generator/consumer-boundary properties. ADR-0014 **rung 1 only** — nothing
here is reference-verified (rung 2) or externally validated (rung 3), and every
observation is maintainer-owned, which is not external, third-party, or community
validation.
