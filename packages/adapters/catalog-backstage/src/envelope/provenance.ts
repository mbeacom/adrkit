/**
 * T082 — the provenance boundary: upstream-authored descriptor content and
 * maintainer-authored annotation overlay are recorded as **distinct** provenances and
 * never merged into an undifferentiated whole.
 *
 * # The domain is closed, and it describes the ANNOTATION
 *
 * `data-model.md` §10 (lines 427–476, read in this worktree):
 *
 * ```text
 * AnnotationProvenance = "upstream-authored" | "maintainer-overlay"
 * ```
 *
 * | Value | Meaning, verbatim from §10's table |
 * |---|---|
 * | `upstream-authored` | The `adrkit.io/owned-paths` annotation was already present in the real upstream descriptor as found. |
 * | `maintainer-overlay` | The annotation was authored by us and overlaid onto an otherwise-unmodified upstream descriptor. |
 *
 * §10 is emphatic that this "describes the ANNOTATION, not the descriptor... under
 * **ADR-0020 clause 5** the descriptors are upstream-authored in *both* cases — the
 * clause requires them 'authored upstream and otherwise unmodified' — so a value
 * meaning 'the descriptor came from upstream' would be true always and would
 * distinguish nothing."
 *
 * That is what makes FR-043 satisfiable: clause 5's "only the corpus data is
 * third-party, never the validation" boundary becomes legible from the artifact.
 *
 * # Why the declaration is an input, and why it is required
 *
 * The generator reads descriptor files off disk. A file that carries the annotation
 * because an upstream author wrote it and a file that carries the annotation because a
 * maintainer overlaid it are **byte-identical on disk**. No amount of reading can tell
 * them apart, so the distinction has to be declared.
 *
 * It is not declared in the manifest: `data-model.md` §1's manifest schema is closed at
 * five top-level fields and `manifest/schema.ts` rejects an unrecognized one. So it
 * arrives as part of the generation request, alongside the manifest path — which is
 * consistent with ADR-0013's "the generator is invoked directly by name", where the
 * function signature *is* the interface.
 *
 * **It is exhaustive and has no default, and that is the safety property.** A default
 * of `upstream-authored` would mean that forgetting to declare an overlay silently
 * emits a claim that a **third party** adopted our annotation — the exact overclaim
 * ADR-0020 clause 5's boundary exists to prevent, produced by an omission rather than
 * by a decision. A default of `maintainer-overlay` would instead erase genuine upstream
 * adoption. Requiring an entry per listed source removes the choice: an undeclared
 * source is invalid input, not a guess. See `failure/triggers.ts` for why that lands on
 * the `other-invalid-input` backstop rather than on one of the fourteen named classes.
 *
 * # One gap, reported rather than papered over
 *
 * The domain has **no** value for "this descriptor carries no annotation at all", and
 * `ownershipState: 'annotation-absent'` is the overwhelmingly common real-corpus case
 * (`structural-fixtures-and-corpora.md` §6, carried forward by `contracts/README.md`
 * §2 delta D3). Neither table row is literally true of such an entity: no annotation
 * was found upstream, and none was overlaid.
 *
 * This implementation records the **source file's** declared provenance for those
 * entities too, and does not invent a third value — `data-model.md` §10 fixes the
 * domain at two and inventing a third would put the generator outside the closed
 * domain the consumer validates against (`snapshot-envelope.md` §2 step 2 requires "a
 * recognized `provenance`").
 *
 * What makes that safe is that `provenance` **alone** is not an adoption claim: the
 * pair `(ownershipState, provenance)` is. An entity recorded as
 * `annotation-absent` + `upstream-authored` says "nothing was overlaid onto this file",
 * which is true, and cannot be read as adoption because `ownershipState` says there is
 * no annotation. Only `explicit-paths`/`explicit-empty` **with** `upstream-authored`
 * asserts that a third party adopted the annotation. {@link isAdoptionClaim} names that
 * pair so a check can assert on it directly.
 *
 * The gap itself belongs to `data-model.md` §10 and is reported, not fixed here.
 *
 * @see `specs/010-catalog-backstage/data-model.md` §10
 * @see `specs/010-catalog-backstage/spec.md` FR-043
 */

import { compareCodeUnits } from '@adrkit/core';
import { type Rejection, otherInvalidInput } from '../failure/triggers.ts';
import type { OwnershipState } from '../ownership/states.ts';

/** `data-model.md` §10's closed two-value domain. */
export type AnnotationProvenance = 'upstream-authored' | 'maintainer-overlay';

/** Both members, as data, so a check can assert the domain is exactly two values. */
export const ANNOTATION_PROVENANCES = [
  'upstream-authored',
  'maintainer-overlay',
] as const satisfies readonly AnnotationProvenance[];

/** The reasons a provenance declaration can be rejected. All map to the backstop. */
export type ProvenanceDeclarationReason =
  | 'provenance-declaration-missing'
  | 'provenance-declaration-unknown-source'
  | 'provenance-declaration-unrecognized-value';

/**
 * The caller's declaration: one {@link AnnotationProvenance} per manifest source path.
 *
 * Exhaustive over the manifest's `sources[].path` values — no more, no fewer. It is
 * keyed by **source path** rather than by canonical id because the maintainer overlays
 * a *file*, and because an entity's identity is not known until after the file has been
 * read, admitted, and canonicalized.
 */
export interface ProvenanceDeclaration {
  readonly bySourcePath: Readonly<Record<string, AnnotationProvenance>>;
}

/** A validated declaration, or exactly one rejection. */
export type ProvenanceCheck =
  | { readonly ok: true; readonly declaration: ProvenanceDeclaration }
  | { readonly ok: false; readonly rejection: Rejection<ProvenanceDeclarationReason> };

function isProvenance(value: unknown): value is AnnotationProvenance {
  return (ANNOTATION_PROVENANCES as readonly string[]).includes(value as string);
}

/**
 * Check a declaration against the manifest's source list.
 *
 * Three rejections, in a fixed order so a declaration violating two always reports the
 * same one — the same first-match-wins discipline `input-manifest.md` §2 imposes on the
 * version checks, for the same reason: a reported reason that depends on evaluation
 * order is not reproducible evidence.
 *
 * Source paths are examined in `compareCodeUnits` order rather than declaration order,
 * so the reported path for a declaration missing two entries is a function of the
 * content and not of object key insertion order.
 */
export function checkProvenanceDeclaration(
  declaration: ProvenanceDeclaration,
  sourcePaths: readonly string[],
): ProvenanceCheck {
  const declared = declaration.bySourcePath;
  const listed = [...new Set(sourcePaths)].sort(compareCodeUnits);

  for (const path of listed) {
    if (!Object.hasOwn(declared, path)) {
      return {
        ok: false,
        rejection: otherInvalidInput(
          'provenance-declaration-missing',
          `no annotation provenance was declared for manifest source ${JSON.stringify(path)}. ` +
            'FR-043 requires that upstream-authored annotation content stay distinguishable ' +
            'against maintainer-authored overlay, and neither value may be assumed: ' +
            'defaulting to upstream-authored would claim third-party adoption that was ' +
            'never attested.',
        ),
      };
    }
  }

  for (const path of Object.keys(declared).sort(compareCodeUnits)) {
    if (!listed.includes(path)) {
      return {
        ok: false,
        rejection: otherInvalidInput(
          'provenance-declaration-unknown-source',
          `annotation provenance was declared for ${JSON.stringify(path)}, which the manifest does ` +
            'not list as a source. A declaration about a file this run never reads is a claim ' +
            'with nothing behind it.',
        ),
      };
    }

    const value: unknown = declared[path];
    if (!isProvenance(value)) {
      return {
        ok: false,
        rejection: otherInvalidInput(
          'provenance-declaration-unrecognized-value',
          `annotation provenance for ${JSON.stringify(path)} is ${JSON.stringify(value)}; the closed ` +
            `domain is ${ANNOTATION_PROVENANCES.map((one) => JSON.stringify(one)).join(' | ')} ` +
            '(data-model.md \u00a710).',
        ),
      };
    }
  }

  return { ok: true, declaration };
}

/**
 * The provenance recorded for an entity read out of `sourcePath`.
 *
 * Throws for an undeclared path rather than substituting a value. Reaching this
 * function with an undeclared path means {@link checkProvenanceDeclaration} did not run
 * first, and inventing a provenance at that point would fabricate exactly the
 * attestation this field exists to carry.
 */
export function provenanceFor(
  declaration: ProvenanceDeclaration,
  sourcePath: string,
): AnnotationProvenance {
  const value = declaration.bySourcePath[sourcePath];
  if (value === undefined) {
    throw new Error(
      `no annotation provenance declared for ${JSON.stringify(sourcePath)}. ` +
        'checkProvenanceDeclaration must run before any entity record is built.',
    );
  }
  return value;
}

/**
 * Whether an `(ownershipState, provenance)` pair asserts that a third party adopted
 * the `adrkit.io/owned-paths` annotation.
 *
 * True **only** when an annotation actually exists and is declared upstream-authored.
 * `annotation-absent` is never an adoption claim whatever its provenance, because
 * there is no annotation to have been adopted.
 *
 * This is the predicate that makes the module note's gap safe, and it is exported so a
 * check can assert on the pair rather than on `provenance` in isolation — which is
 * where the misreading would otherwise happen.
 */
export function isAdoptionClaim(
  ownershipState: OwnershipState,
  provenance: AnnotationProvenance,
): boolean {
  return ownershipState !== 'annotation-absent' && provenance === 'upstream-authored';
}

/**
 * A declaration marking every listed source as maintainer overlay.
 *
 * A convenience for callers overlaying annotations onto an otherwise-unmodified
 * upstream corpus — which is the construction ADR-0020 clause 5 names and the one the
 * frozen accept corpus uses (`accept-corpus-freeze/overlay.json`: "No descriptor in the
 * pinned corpus carries `adrkit.io/owned-paths`... Every annotation value below was
 * written by the maintainer").
 *
 * Deliberately **not** a default. A caller must reach for it by name, which is a
 * decision recorded at the call site; a default would be an omission recorded nowhere.
 */
export function allMaintainerOverlay(sourcePaths: readonly string[]): ProvenanceDeclaration {
  const bySourcePath: Record<string, AnnotationProvenance> = {};
  for (const path of sourcePaths) bySourcePath[path] = 'maintainer-overlay';
  return { bySourcePath };
}

/**
 * A declaration marking every listed source as upstream-authored.
 *
 * Also not a default, and for a stronger reason than {@link allMaintainerOverlay}: used
 * together with a present annotation this asserts third-party adoption, which
 * ADR-0020 clause 5 permits only as an attested fact. A caller naming this function is
 * making that attestation explicitly.
 */
export function allUpstreamAuthored(sourcePaths: readonly string[]): ProvenanceDeclaration {
  const bySourcePath: Record<string, AnnotationProvenance> = {};
  for (const path of sourcePaths) bySourcePath[path] = 'upstream-authored';
  return { bySourcePath };
}
