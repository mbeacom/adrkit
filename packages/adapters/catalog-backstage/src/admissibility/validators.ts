/**
 * T049 — the **four** admissibility field validators, each separately attributed.
 *
 * # The warrant, before anything else
 *
 * Every statement in this module is a statement about **what a pure validator
 * predicate returns when invoked**, at Backstage commit
 * `1121a4facd9e321179d0402c3f355e4a649e84d9`. It is **not** a statement about what
 * Backstage as a running system does with a descriptor. A descriptor this module
 * calls inadmissible may or may not be rejected by a deployed Backstage instance;
 * this feature has never run one and will not. The pin is load-bearing: a different
 * commit is a different predicate and therefore a different contract
 * (`admissibility.md` §1).
 *
 * # The table, transcribed from ADR-0015
 *
 * Reproduced from ADR-0015's four-row table — which `spec.md` FR-016 reproduces in
 * turn — rather than restated:
 *
 * | Field | Validator binding | Predicate | Applied |
 * |---|---|---|---|
 * | `apiVersion` | `isValidApiVersion` → `CommonValidatorFunctions.isValidPrefixAndOrSuffix` | prefix is a DNS **subdomain** (`CommonValidatorFunctions.isValidDnsSubdomain`, ≤253 total, each dot-separated label ≤63); suffix is `/^[a-z0-9A-Z]+$/`, ≤63 | required |
 * | `kind` | `isValidKind` | `/^[a-zA-Z][a-z0-9A-Z]*$/`, ≤63 | required |
 * | `metadata.name` | `isValidEntityName` → `KubernetesValidatorFunctions.isValidObjectName` | `/^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/`, ≤63 | required |
 * | `metadata.namespace` | `isValidNamespace` → `KubernetesValidatorFunctions.isValidNamespace` → `CommonValidatorFunctions.isValidDnsLabel` | `/^[a-z0-9]+(?:\-+[a-z0-9]+)*$/`, ≤63 | **only when present** |
 *
 * # Two places the source documents disagree, resolved in ADR-0015's favour
 *
 * 1. **The namespace character class.** `contracts/admissibility.md` §2's summary
 *    table gives `metadata.namespace` the character class "`[A-Za-z0-9]` plus `-`,
 *    `_`, `.`" — the same class it gives `metadata.name`. ADR-0015 and FR-016 give
 *    it the DNS-label predicate `/^[a-z0-9]+(?:\-+[a-z0-9]+)*$/`, which admits
 *    **no** uppercase, **no** `_`, and **no** `.`. FR-016 requires "exactly the four
 *    field validators in ADR-0015's table", so ADR-0015 governs. Reported as a
 *    contract defect rather than silently reconciled.
 * 2. **`AdmissibilityField`.** `data-model.md` §4 types it as
 *    `"kind" | "metadata.name" | "metadata.namespace" | "spec.type"` — omitting
 *    `apiVersion`, which ADR-0015 requires, and adding `spec.type`, which no
 *    validator in the table covers. ADR-0015's four fields are used here. Also
 *    reported.
 *
 * # The one composition this module performs
 *
 * ADR-0015 states `isValidDnsSubdomain`'s **bounds** (≤253 total, each dot-separated
 * label ≤63) but not the character class of an individual label. It does state
 * `CommonValidatorFunctions.isValidDnsLabel`'s predicate, in the namespace row of
 * the same table. A subdomain is therefore implemented here as *dot-separated
 * labels each satisfying the stated `isValidDnsLabel` predicate*, bounded as stated.
 * That is a composition of two things the table says, not an invention — but it is
 * the only place transcription was insufficient, and it is flagged rather than
 * buried.
 *
 * The four ADR-0015 facts that *were* recorded as directly executed against the pin
 * — a 243-character prefix passes; 254 fails; an over-63 label fails; a
 * two-separator value fails — are pinned as tests in
 * `test/admissibility-validators.test.ts`.
 *
 * @see `docs/adr/0015-validate-descriptors-against-backstage-field-formats-before-canonicalizing.md`
 * @see `specs/010-catalog-backstage/contracts/admissibility.md` §1, §2
 */

import { splitOnSeparator } from './separator.ts';

/**
 * The four fields, in ADR-0015's table order.
 *
 * This is the feature's `AdmissibilityField`. It follows ADR-0015 rather than
 * `data-model.md` §4 — see the module note above.
 */
export type AdmissibilityField = 'apiVersion' | 'kind' | 'metadata.name' | 'metadata.namespace';

/** The four fields as data, so the count is assertable at runtime. */
export const ADMISSIBILITY_FIELDS = [
  'apiVersion',
  'kind',
  'metadata.name',
  'metadata.namespace',
] as const satisfies readonly AdmissibilityField[];

/**
 * The adapter's validator names, as `contracts/admissibility.md` §2's table names
 * them.
 */
export type AdmissibilityValidatorName =
  | 'validateApiVersion'
  | 'validateKind'
  | 'validateEntityName'
  | 'validateNamespace';

/**
 * The pinned Backstage binding each adapter validator reproduces, spelled as
 * ADR-0015's table spells it.
 *
 * Carried alongside the adapter's own validator name because the *warrant* attaches
 * to the pinned binding, and a record naming only `validateNamespace` would not say
 * which upstream predicate it claims to reproduce.
 */
export const PINNED_VALIDATOR_BINDINGS: Record<AdmissibilityValidatorName, string> = {
  validateApiVersion: 'isValidApiVersion → CommonValidatorFunctions.isValidPrefixAndOrSuffix',
  validateKind: 'isValidKind',
  validateEntityName: 'isValidEntityName → KubernetesValidatorFunctions.isValidObjectName',
  validateNamespace:
    'isValidNamespace → KubernetesValidatorFunctions.isValidNamespace → CommonValidatorFunctions.isValidDnsLabel',
};

/** The commit every predicate here is pinned to. ADR-0012 pinned it; ADR-0015 uses it. */
export const PINNED_BACKSTAGE_COMMIT = '1121a4facd9e321179d0402c3f355e4a649e84d9';

/** Which field each validator is invoked on. */
export const VALIDATOR_FIELDS: Record<AdmissibilityValidatorName, AdmissibilityField> = {
  validateApiVersion: 'apiVersion',
  validateKind: 'kind',
  validateEntityName: 'metadata.name',
  validateNamespace: 'metadata.namespace',
};

/** ADR-0015: suffix is `/^[a-z0-9A-Z]+$/`, ≤63. */
const API_VERSION_SUFFIX = /^[a-z0-9A-Z]+$/u;

/** ADR-0015: `isValidKind` is `/^[a-zA-Z][a-z0-9A-Z]*$/`, ≤63. */
const KIND = /^[a-zA-Z][a-z0-9A-Z]*$/u;

/** ADR-0015: `isValidObjectName` is `/^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/`, ≤63. */
const OBJECT_NAME = /^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/u;

/** ADR-0015: `isValidDnsLabel` is `/^[a-z0-9]+(?:\-+[a-z0-9]+)*$/`, ≤63. */
const DNS_LABEL = /^[a-z0-9]+(?:-+[a-z0-9]+)*$/u;

/** ADR-0015: each dot-separated label ≤63. */
export const DNS_LABEL_MAX = 63;

/** ADR-0015: a DNS subdomain is ≤253 in total. */
export const DNS_SUBDOMAIN_MAX = 253;

/** ADR-0015: every one of the four predicates carries a ≤63 bound. */
export const FIELD_MAX = 63;

/** `CommonValidatorFunctions.isValidDnsLabel`, as ADR-0015's table gives it. */
export function isValidDnsLabel(value: string): boolean {
  return value.length <= DNS_LABEL_MAX && DNS_LABEL.test(value);
}

/**
 * `CommonValidatorFunctions.isValidDnsSubdomain`.
 *
 * Bounds are transcribed; the per-label character class is composed from
 * {@link isValidDnsLabel} — the one composition this module performs, flagged in
 * the module note.
 */
export function isValidDnsSubdomain(value: string): boolean {
  if (value.length > DNS_SUBDOMAIN_MAX) return false;
  const labels = value.split('.');
  return labels.every((label) => isValidDnsLabel(label));
}

/**
 * `validateApiVersion` — `isValidApiVersion` →
 * `CommonValidatorFunctions.isValidPrefixAndOrSuffix`.
 *
 * The separator rule (`admissibility/separator.ts`, T050) decides which predicates
 * are consulted at all: a bare `v1` reaches only the suffix rule, and a value with
 * two separators is rejected before either.
 */
export function validateApiVersion(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  const split = splitOnSeparator(value);
  switch (split.kind) {
    case 'too-many-separators':
      return false;
    case 'suffix-only':
      return split.suffix.length <= FIELD_MAX && API_VERSION_SUFFIX.test(split.suffix);
    case 'prefix-and-suffix':
      return (
        isValidDnsSubdomain(split.prefix) &&
        split.suffix.length <= FIELD_MAX &&
        API_VERSION_SUFFIX.test(split.suffix)
      );
  }
}

/** `validateKind` — `isValidKind`. */
export function validateKind(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.length <= FIELD_MAX && KIND.test(value);
}

/** `validateEntityName` — `isValidEntityName` → `KubernetesValidatorFunctions.isValidObjectName`. */
export function validateEntityName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.length <= FIELD_MAX && OBJECT_NAME.test(value);
}

/**
 * `validateNamespace` — `isValidNamespace` →
 * `KubernetesValidatorFunctions.isValidNamespace` →
 * `CommonValidatorFunctions.isValidDnsLabel`.
 *
 * Applied **only when present**. Absence is handled by the caller
 * (`admissibility/index.ts`), because "omitted is admissible" is a statement about
 * the composition, not about this predicate: ADR-0015's Decision says the namespace
 * "is validated as authored, never after defaulting", so this function must never
 * be handed the substituted `default`.
 */
export function validateNamespace(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.length <= FIELD_MAX && DNS_LABEL.test(value);
}

/** The four validators, keyed by name, so the composition can iterate them. */
export const VALIDATORS: Record<AdmissibilityValidatorName, (value: unknown) => boolean> = {
  validateApiVersion,
  validateKind,
  validateEntityName,
  validateNamespace,
};
