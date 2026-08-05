/**
 * T047 — descriptor reading, with `duplicate-yaml-key` and `invalid-yaml-syntax`
 * kept as **two distinct outcomes**.
 *
 * `research.md` R8 fixes the mechanism: the `yaml` package's `uniqueKeys` option
 * defaults to `true`, so a duplicate mapping key at any level is already reported
 * without configuration. This module therefore never passes `uniqueKeys: false` and
 * never writes a bespoke duplicate-key walker — a second notion of "duplicate"
 * could disagree with the library's own.
 *
 * **Why the two outcomes must not collapse.** `data-model.md` §3 types
 * `parseOutcome` as three values, and §8 maps two of them to *different* trigger
 * classes. A reader told only "this file did not parse" cannot tell a descriptor
 * that declared `kind` twice from one with an unterminated quote — different
 * defects with different fixes. `atomic-fail-closed.md` §4 added
 * `invalid-yaml-syntax` specifically to close that gap.
 *
 * **A duplicate key still produces a value, and that is the trap.** `yaml` reports
 * `DUPLICATE_KEY` *and* resolves the mapping last-wins. An implementation that read
 * `doc.toJSON()` and ignored `doc.errors` would get a plausible-looking descriptor
 * and never notice. That is why {@link readDescriptorDocuments} checks errors
 * before it reads any value.
 *
 * @see `specs/009-catalog-binding-viability/research.md` R8
 * @see `specs/010-catalog-backstage/data-model.md` §3
 */

import { parseAllDocuments } from 'yaml';
import { type Rejection, type TriggerClass } from '../diagnostics.ts';

/** `yaml`'s own error code for a repeated mapping key. */
export const DUPLICATE_KEY_CODE = 'DUPLICATE_KEY';

/** `data-model.md` §3. */
export type DescriptorParseOutcome = 'parsed' | 'duplicate-yaml-key' | 'yaml-parse-error';

/**
 * One YAML document, addressed by `(sourcePath, documentIndexInFile)`.
 *
 * A single file may hold several documents, so a path alone does not identify one —
 * `data-model.md` §3 states this and it is the reason `documentIndexInFile` is not
 * optional.
 *
 * **Two fields beyond `data-model.md` §3's five, and why.** §3 lists `rawKind` and
 * `rawMetadata` but not `rawApiVersion`, while ADR-0015's validator table — which
 * §4 is downstream of — requires `apiVersion`. A descriptor record that omitted it
 * could not be checked for admissibility at all. `raw` carries the whole decoded
 * document so the ownership annotation can be read as the plain value the
 * `owned-paths-annotation.md` §1 step-2 check expects. Both additions are reported
 * as a `data-model.md` §3 gap rather than treated as settled.
 */
export interface DescriptorDocument {
  readonly sourcePath: string;
  readonly documentIndexInFile: number;
  readonly parseOutcome: DescriptorParseOutcome;
  /** Pre-validation. Type deliberately not assumed — see `data-model.md` §3. */
  readonly rawApiVersion: unknown;
  readonly rawKind: unknown;
  readonly rawMetadata: unknown;
  /** The whole decoded document, or `undefined` when parsing failed. */
  readonly raw: unknown;
  /** Present exactly when `parseOutcome !== 'parsed'`. */
  readonly rejection: Rejection<DescriptorReadReason> | undefined;
}

/** Fine-grained reasons, 1:1 with their trigger classes. */
export type DescriptorReadReason = 'duplicate-yaml-key' | 'invalid-yaml-syntax';

const REASON_TO_TRIGGER: Record<DescriptorReadReason, TriggerClass> = {
  'duplicate-yaml-key': 'duplicate-yaml-key',
  'invalid-yaml-syntax': 'invalid-yaml-syntax',
};

function readField(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[field];
}

/**
 * Read every YAML document in one descriptor file's text.
 *
 * Returns one {@link DescriptorDocument} per document, in file order, each carrying
 * its own outcome. A file whose second document is malformed still yields a record
 * for its first — that is a *reporting* property, not a licence to continue: the
 * whole-operation abort is `atomic-fail-closed.md`'s concern and Phase E's code.
 * Reporting per document is what lets the abort name which document was at fault.
 *
 * An empty file yields no documents, which is not an error here. Whether a manifest
 * may list an empty source is a manifest question, not a YAML one.
 */
export function readDescriptorDocuments(
  sourcePath: string,
  text: string,
): readonly DescriptorDocument[] {
  // `uniqueKeys` is deliberately not passed: R8 relies on the library default of
  // `true`, and naming it here would invite someone to "make it configurable".
  const documents = parseAllDocuments(text);

  return documents.map((document, documentIndexInFile) => {
    const [firstError] = document.errors;

    if (firstError !== undefined) {
      const reason: DescriptorReadReason =
        firstError.code === DUPLICATE_KEY_CODE ? 'duplicate-yaml-key' : 'invalid-yaml-syntax';

      return {
        sourcePath,
        documentIndexInFile,
        parseOutcome: reason === 'duplicate-yaml-key' ? 'duplicate-yaml-key' : 'yaml-parse-error',
        rawApiVersion: undefined,
        rawKind: undefined,
        rawMetadata: undefined,
        raw: undefined,
        rejection: {
          reason,
          triggerClass: REASON_TO_TRIGGER[reason],
          detail: `${sourcePath}[${documentIndexInFile}]: ${firstError.code}: ${firstError.message}`,
        },
      } satisfies DescriptorDocument;
    }

    const raw: unknown = document.toJSON();

    return {
      sourcePath,
      documentIndexInFile,
      parseOutcome: 'parsed',
      rawApiVersion: readField(raw, 'apiVersion'),
      rawKind: readField(raw, 'kind'),
      rawMetadata: readField(raw, 'metadata'),
      raw,
      rejection: undefined,
    } satisfies DescriptorDocument;
  });
}

/**
 * The value at `metadata.annotations[key]`, as a plain decoded value.
 *
 * Returned as `unknown` on purpose. `owned-paths-annotation.md` §1 step 2 is
 * written as a literal `typeof rawNode === "string"` check, and it is only a
 * meaningful check if the caller can actually receive a non-string. A YAML sequence
 * arrives here as an array, a mapping as an object, a number as a number — so the
 * step-2 check has something to reject.
 *
 * The `present` discriminant is explicit rather than inferred from `undefined`,
 * because §1 step 1 requires exactly that: presence is decided by an annotation
 * presence discriminant, "never inferred from whether a raw value happens to be
 * `undefined`". A YAML `key:` with no value is present and null, not absent.
 */
export function readAnnotationNode(
  document: DescriptorDocument,
  key: string,
): { readonly present: boolean; readonly value: unknown } {
  const metadata = document.rawMetadata;
  const annotations = readField(metadata, 'annotations');
  if (typeof annotations !== 'object' || annotations === null || Array.isArray(annotations)) {
    return { present: false, value: undefined };
  }
  const record = annotations as Record<string, unknown>;
  return { present: Object.hasOwn(record, key), value: record[key] };
}
