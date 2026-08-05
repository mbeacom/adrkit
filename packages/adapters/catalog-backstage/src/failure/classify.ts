/**
 * T076 — **exactly one** trigger class per abort, and the **correct** one.
 *
 * # Why a registry, and not just "each validator gets it right"
 *
 * FR-037 requires that each abort record exactly one trigger class "and that class
 * MUST be the correct one — not a neighbouring class that happens to also be
 * reachable." A test that reads the class off the validator and asserts it equals the
 * class the validator emitted is a tautology: it passes for a validator that has
 * collapsed two classes into one, because both sides of the comparison moved together.
 *
 * {@link REASON_TRIGGER_REGISTRY} is transcribed from the **contracts**, not from the
 * validators. It is a second, independent statement of the mapping, so comparing a
 * validator's emitted pair against it is an actual check. When the two disagree, one
 * of them is wrong and the disagreement is the signal.
 *
 * That is the same argument `package-boundary.md` §5 makes for declaring the envelope
 * shape twice: "two independent declarations are what make the consumer's structural
 * validation an actual check rather than a tautology."
 *
 * # The pairs §4.3 says are easiest to collapse
 *
 * `atomic-fail-closed.md` §4.3 names two, and `admissibility.md` supplies a third that
 * is an *ordering* property rather than a naming one:
 *
 * | Pair | The wrong merge | What keeps them apart |
 * |---|---|---|
 * | `duplicate-yaml-key` / `invalid-yaml-syntax` | reporting a repeated mapping key as generic bad YAML | `descriptor/read.ts` branches on the `yaml` library's own `DUPLICATE_KEY` code before reading any value |
 * | `invalid-manifest-shape` / `unsupported-manifest-version` | reporting an unrecognized top-level field as a version problem | the registry below; `contracts/README.md` §4.2 fixes which side governs |
 * | `inadmissible-descriptor` / `duplicate-canonical-id` | canonicalizing first, so an inadmissible descriptor collides before it is found inadmissible | `admissibility/index.ts`'s brand: canonicalization consumes an `AdmittedDescriptor` and nothing else |
 *
 * The third is not fixed by a mapping at all — a mapping cannot express an ordering —
 * which is why it is enforced by a type and checked by `test/sc-004.test.ts`.
 *
 * @see `specs/010-catalog-backstage/contracts/atomic-fail-closed.md` §4.3
 * @see `specs/010-catalog-backstage/contracts/README.md` §4.2, §4.3
 * @see `specs/010-catalog-backstage/spec.md` FR-037
 */

import {
  type AtomicFailureRecord,
  type FailureLocation,
  abortRecord,
} from './abort.ts';
import { type Rejection, type TriggerClass } from './triggers.ts';

/**
 * Every fine-grained reason this package can emit, mapped to the trigger class the
 * contracts assign it.
 *
 * **Transcribed from the contracts, with each group's authority named.** Where a
 * contract was silent, `contracts/README.md` §4 resolves it and is cited on the group.
 * Nothing here was read off an implementation.
 */
export const REASON_TRIGGER_REGISTRY: Readonly<Record<string, TriggerClass>> = {
  // ── Manifest shape. `input-manifest.md` §1's closed schema. The unrecognized-field
  //    case is the one `contracts/README.md` §4.2 resolves: §1 calls it an
  //    "unsupported manifest version"-class rejection, `atomic-fail-closed.md` §4
  //    assigns it to `invalid-manifest-shape`, and §4 governs as the later and more
  //    specific statement.
  'manifest-not-json': 'invalid-manifest-shape',
  'manifest-not-an-object': 'invalid-manifest-shape',
  // A manifest that is not there cannot parse as JSON, which is §4.3's own first
  // clause for this class. It gets its own **reason** rather than reusing
  // `manifest-not-json`, because ADR-0016 records the exact emitted string and "there
  // is no file here" and "this file is not JSON" are different findings with different
  // fixes. `manifest/schema.ts` cannot own it: that module starts from text.
  'manifest-unreadable': 'invalid-manifest-shape',
  'unrecognized-top-level-field': 'invalid-manifest-shape',
  'missing-required-field': 'invalid-manifest-shape',
  'field-wrong-type': 'invalid-manifest-shape',
  'multiple-repositories': 'invalid-manifest-shape',
  'unrecognized-nested-field': 'invalid-manifest-shape',

  // ── Manifest version and capability. `input-manifest.md` §2's table — three
  //    rejections, each 1:1 with its own class. `unsupported-manifest-version`
  //    presumes a manifest that parsed and shape-checked and declares an unsupported
  //    *value* (`atomic-fail-closed.md` §4.3).
  'unsupported-manifest-version': 'unsupported-manifest-version',
  'unsupported-snapshot-version': 'unsupported-snapshot-version',
  'unsupported-capability': 'unsupported-capability',

  // ── Source path, stage 1 — lexical, before any filesystem access.
  //    `input-manifest.md` §4.1 names no class for stage 1; `contracts/README.md` §4.3
  //    resolves the silence: a lexically invalid path is a defect in the manifest's
  //    own content, discovered before the file is ever opened, so
  //    `invalid-manifest-shape`.
  'path-empty': 'invalid-manifest-shape',
  'path-dot-or-dotdot': 'invalid-manifest-shape',
  'path-absolute': 'invalid-manifest-shape',
  'path-drive-prefix': 'invalid-manifest-shape',
  'path-backslash': 'invalid-manifest-shape',
  'path-traversal-segment': 'invalid-manifest-shape',
  'path-control-character': 'invalid-manifest-shape',

  // ── Source path, stage 2, and source digests. `input-manifest.md` §4.1 names
  //    stage 2's class explicitly — `incomplete-required-source`, "and the file is
  //    never opened".
  'path-escapes-checkout-root': 'incomplete-required-source',
  'digest-malformed': 'incomplete-required-source',
  'source-missing': 'incomplete-required-source',
  'source-unreadable': 'incomplete-required-source',
  'digest-mismatch': 'incomplete-required-source',

  // ── Repository identity. `input-manifest.md` §3.
  'repository-mismatch': 'repository-mismatch',

  // ── Descriptor parse. `atomic-fail-closed.md` §4.3's first collapsible pair.
  'duplicate-yaml-key': 'duplicate-yaml-key',
  'invalid-yaml-syntax': 'invalid-yaml-syntax',

  // ── Admissibility. ADR-0015 Condition of Acceptance 2; `admissibility.md` §5.1.
  'inadmissible-descriptor': 'inadmissible-descriptor',

  // ── Annotation decode, steps 2–4. `owned-paths-annotation.md` §1. Steps 2 and 3
  //    share `invalid-annotation-parse` and stay distinct at the reason level, which
  //    is what §1 requires; `data-model.md` §8 carries only two annotation classes, so
  //    a 1:1 mapping onto three reasons is not available.
  'annotation-value-not-a-string': 'invalid-annotation-parse',
  'parse-error': 'invalid-annotation-parse',
  'wrong-shape': 'invalid-annotation-shape',

  // ── Annotation decode, step 5. Delegated to `glob-dialect.md`.
  'invalid-pattern': 'invalid-pattern',

  // ── Identity uniqueness. `entity-identity.md` §3's collision table.
  'duplicate-canonical-id': 'duplicate-canonical-id',
  'duplicate-canonical-ref': 'duplicate-canonical-ref',

  // ── The backstop. `atomic-fail-closed.md` §4.2. See `failure/triggers.ts` for why
  //    this is genuinely reachable rather than a formality.
  'provenance-declaration-missing': 'other-invalid-input',
  'provenance-declaration-unknown-source': 'other-invalid-input',
  'provenance-declaration-unrecognized-value': 'other-invalid-input',
};

/** The class the contracts assign `reason`, or `undefined` if it is not registered. */
export function expectedTriggerFor(reason: string): TriggerClass | undefined {
  return REASON_TRIGGER_REGISTRY[reason];
}

/**
 * Thrown when a rejection's own trigger class disagrees with the registry.
 *
 * A throw rather than a silent correction, and the direction matters: silently
 * rewriting the class to the registry's value would make the two agree by fiat and
 * destroy the evidence that they had disagreed. FR-037's requirement is that the class
 * be *correct*, and a disagreement means the implementation and the contract have
 * diverged — which a reader needs to see, not have repaired underneath them.
 */
export class TriggerClassificationError extends Error {
  constructor(
    readonly reason: string,
    readonly emitted: TriggerClass,
    readonly expected: TriggerClass | undefined,
  ) {
    super(
      expected === undefined
        ? `reason ${JSON.stringify(reason)} is not in REASON_TRIGGER_REGISTRY, so its trigger class ` +
            `${JSON.stringify(emitted)} cannot be checked against the contracts. Register it rather ` +
            'than trusting the emitter.'
        : `reason ${JSON.stringify(reason)} emitted trigger class ${JSON.stringify(emitted)}, but the ` +
            `contracts assign it ${JSON.stringify(expected)}. Exactly one of the two is wrong ` +
            '(FR-037; atomic-fail-closed.md §4.3).',
    );
    this.name = 'TriggerClassificationError';
  }
}

/**
 * Build the run's single {@link AtomicFailureRecord}, checking the class as it goes.
 *
 * Every abort in `pipeline.ts` goes through this function, so the registry check is
 * not something a caller can forget to run. A rejection whose class disagrees with the
 * registry does not produce a record at all.
 *
 * "Exactly one" is a property of the return type as much as of the behaviour: this
 * returns one record, never an array, so there is no shape in which a second could
 * travel.
 */
export function classifyAbort(
  rejection: Rejection,
  stage: string,
  location: FailureLocation = {},
): AtomicFailureRecord {
  const expected = expectedTriggerFor(rejection.reason);
  if (expected !== rejection.triggerClass) {
    throw new TriggerClassificationError(rejection.reason, rejection.triggerClass, expected);
  }
  return abortRecord(rejection, stage, location);
}

/**
 * The pairs `atomic-fail-closed.md` §4.3 identifies as most at risk of being merged,
 * as data.
 *
 * Exported so the check that they stay distinct enumerates the contract's own list
 * rather than whichever pairs a test author happened to think of.
 */
export const COLLAPSIBLE_PAIRS: readonly (readonly [TriggerClass, TriggerClass])[] = [
  ['duplicate-yaml-key', 'invalid-yaml-syntax'],
  ['invalid-manifest-shape', 'unsupported-manifest-version'],
  ['inadmissible-descriptor', 'duplicate-canonical-id'],
];
