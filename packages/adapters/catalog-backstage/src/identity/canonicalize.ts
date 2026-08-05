/**
 * T055 — **two-step** canonicalization.
 *
 * `entity-identity.md` §1, transcribed:
 *
 * 1. If `metadata.namespace` is omitted, `NS := "default"` — Backstage's own
 *    `stringifyEntityRef` default-namespace substitution.
 * 2. ``canonicalId := `${K}:${NS}/${N}`.toLowerCase()`` — the **entire** string is
 *    lowercased, not merely a prefix, matching `stringifyEntityRef`'s own
 *    lowercasing behaviour exactly.
 *
 * **Lowercasing the whole string is the step that is easy to get wrong.** An
 * implementation that lowercased only the name — or only the kind prefix — would
 * make `Component:Default/Payments` and `component:default/payments` two entities
 * where §1 requires one, and the duplicate rule would then silently miss the
 * collision it exists to catch.
 *
 * **This function is reachable only from an admitted descriptor**, by type. That is
 * ADR-0015's ordering rule expressed structurally: see
 * `admissibility/index.ts`'s module note. There is deliberately no overload taking
 * a raw `DescriptorDocument`.
 *
 * **The namespace is defaulted here and validated elsewhere.** ADR-0015: the
 * namespace "is validated as authored, never after defaulting". So step 1 happens
 * in this module, strictly after `validateNamespace` has already run in
 * `admissibility/validators.ts` — never before.
 *
 * @see `specs/009-catalog-binding-viability/contracts/entity-identity.md` §1
 * @see `specs/010-catalog-backstage/data-model.md` §5
 */

import type { AdmittedDescriptor } from '../admissibility/index.ts';

/** `entity-identity.md` §1's default-namespace substitution value. */
export const DEFAULT_NAMESPACE = 'default';

/** `data-model.md` §5. */
export interface CanonicalEntityIdentity {
  readonly rawKind: string;
  /** `undefined` when `metadata.namespace` was omitted — the authored value. */
  readonly rawNamespace: string | undefined;
  readonly rawName: string;
  /** `${kind}:${namespace}/${name}`, lowercased in full. */
  readonly canonicalId: string;
  /** Non-empty; `canonicalId` is always a member. */
  readonly allRefs: readonly string[];
}

/**
 * Canonicalize an admitted descriptor's identity.
 *
 * The cast on the three fields is safe by construction rather than by assumption:
 * an {@link AdmittedDescriptor} exists only if all four validators returned true,
 * and each of those predicates begins with `typeof value !== 'string'` → false.
 *
 * `allRefs` is `[canonicalId]`. `data-model.md` §5 requires it be present and
 * non-empty and records, as an open `[NEEDS CLARIFICATION]`, that how it is
 * populated beyond the primary id in production is undecided — no ADR decides it,
 * Backstage defines no standard alias field, and spike 009 sourced aliases from
 * synthetic fixtures only. This module emits the documented minimum and invents
 * nothing beyond it.
 */
export function canonicalize(admitted: AdmittedDescriptor): CanonicalEntityIdentity {
  const rawKind = admitted.fields.kind as string;
  const rawName = admitted.fields.name as string;
  const rawNamespace = admitted.fields.namespacePresent
    ? (admitted.fields.namespace as string)
    : undefined;

  // Step 1 — default-namespace substitution.
  const namespace = rawNamespace ?? DEFAULT_NAMESPACE;

  // Step 2 — lowercase the ENTIRE identity string, not merely a component.
  const canonicalId = `${rawKind}:${namespace}/${rawName}`.toLowerCase();

  return { rawKind, rawNamespace, rawName, canonicalId, allRefs: [canonicalId] };
}
