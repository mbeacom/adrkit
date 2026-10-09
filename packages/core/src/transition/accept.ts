/**
 * @adrkit/core — the `proposed` → `accepted` transition (ADR-0044).
 *
 * Pure: no clock, no filesystem. The caller supplies the record's source text, the
 * ratifier, and the decision instant, and receives the new source text or a refusal.
 *
 * The transition splices lines rather than re-serializing YAML. A `yaml` round trip
 * rewrites quoting, flow collections, and folded scalars in most real records, and a
 * ratification diff should show exactly the three fields it owns. After splicing, the
 * new frontmatter is parsed again and every field other than those three must be
 * semantically unchanged; anything else is refused with nothing written.
 */

import { isMap, isScalar, parseDocument, Scalar, type YAMLMap } from 'yaml';
import { parseFrontmatter } from '../parse/frontmatter.ts';
import { distinctIdentityCount, isWritableIdentity } from '../schema/identity.ts';
import { validateAdrFrontmatter } from '../validate/contract.ts';
import type { Finding } from '../validate/findings.ts';
import {
  blockInsertionPoint,
  errorFindings,
  finishSplice,
  keyOf,
  leadAt,
  lineStartOf,
  locateFrontmatter,
  quoted,
  renderScalarLike,
  type Edit,
  type Located,
} from './splice.ts';

export interface AcceptAdrInput {
  /** Full record source, frontmatter fences included. */
  source: string;
  /** The human ratifier: `@handle`, `team:slug`, or an email address. */
  by: string;
  /** RFC 3339 date-time with seconds, e.g. `2026-09-30T12:00:00Z`. */
  decidedAt: string;
  /** Display path, used only in findings. */
  path: string;
}

export type AcceptRefusalCode =
  | 'invalid-identity'
  | 'invalid-decided-at'
  | 'invalid-record'
  | 'not-proposed'
  | 'unresolved-objections'
  | 'quorum-not-met'
  | 'unsupported-layout'
  | 'invalid-result';

export type AcceptAdrResult =
  | { ok: true; content: string }
  | { ok: false; code: AcceptRefusalCode; message: string; findings?: Finding[] };

const RFC3339_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function refuse(code: AcceptRefusalCode, message: string, findings?: Finding[]): AcceptAdrResult {
  return findings ? { ok: false, code, message, findings } : { ok: false, code, message };
}

/**
 * Set `root[parentKey][childKey] = rendered` by splicing. Returns an edit, or a reason
 * the layout cannot be spliced safely.
 */
function childEdit(
  located: Located,
  root: YAMLMap,
  parentKey: string,
  childKey: string,
  value: string,
  render: (value: string) => string,
): Edit | string {
  const rendered = render(value);
  const { yaml, eol } = located;
  const index = root.items.findIndex((pair) => keyOf(pair) === parentKey);
  if (index === -1) {
    const point = blockInsertionPoint(yaml, root, root.items.length - 1);
    const lead = leadAt(yaml, point, eol);
    return { start: point, end: point, text: `${lead}${parentKey}:${eol}  ${childKey}: ${rendered}${eol}`, newBlock: true };
  }

  const parent = root.items[index]!;
  const map = parent.value;
  if (!isMap(map) || map.flow || map.items.length === 0) {
    return `"${parentKey}" is not a block mapping; edit this record by hand`;
  }

  const existing = map.items.find((pair) => keyOf(pair) === childKey);
  if (existing) {
    const current = existing.value;
    if (!isScalar(current) || !current.range || current.type === Scalar.BLOCK_FOLDED || current.type === Scalar.BLOCK_LITERAL) {
      return `"${parentKey}.${childKey}" is not a single-line scalar; edit this record by hand`;
    }
    // Keep an existing quote style; a plain scalar takes the fresh rendering, because
    // `@handle` cannot be written plain.
    const text = current.type === Scalar.PLAIN ? rendered : renderScalarLike(current, value);
    return { start: current.range[0], end: current.range[1], text };
  }

  const firstKey = map.items[0]!.key;
  if (!isScalar(firstKey) || !firstKey.range) {
    return `"${parentKey}" has a key this command cannot locate; edit this record by hand`;
  }
  const indent = yaml.slice(lineStartOf(yaml, firstKey.range[0]), firstKey.range[0]);
  if (!/^ +$/.test(indent)) {
    return `"${parentKey}" is not an indented block mapping; edit this record by hand`;
  }
  const point = blockInsertionPoint(yaml, root, index);
  const lead = !yaml.slice(0, point).endsWith('\n') ? eol : '';
  return { start: point, end: point, text: `${lead}${indent}${childKey}: ${rendered}${eol}` };
}

function statusEdit(root: YAMLMap): Edit | string {
  const pair = root.items.find((item) => keyOf(item) === 'status');
  const value = pair?.value;
  if (!isScalar(value) || !value.range) return '"status" is not a scalar; edit this record by hand';
  return { start: value.range[0], end: value.range[1], text: renderScalarLike(value, 'accepted') };
}

function expectedAfter(data: Record<string, unknown>, by: string, decidedAt: string): Record<string, unknown> {
  const provenance = { ...((data.provenance as Record<string, unknown> | undefined) ?? {}), ratifiedBy: by };
  const review = { ...((data.review as Record<string, unknown> | undefined) ?? {}), decidedAt };
  return { ...data, status: 'accepted', provenance, review };
}

export function acceptAdrSource(input: AcceptAdrInput): AcceptAdrResult {
  if (!isWritableIdentity(input.by)) {
    return refuse(
      'invalid-identity',
      `${JSON.stringify(input.by)} is not an identity this command writes. Expected @handle, team:slug, or an email address. It may contain no control or invisible characters.`,
    );
  }
  if (!RFC3339_SECONDS.test(input.decidedAt) || Number.isNaN(Date.parse(input.decidedAt))) {
    return refuse('invalid-decided-at', `"${input.decidedAt}" is not an RFC 3339 date-time with seconds.`);
  }

  let data: unknown;
  try {
    data = parseFrontmatter(input.source).data;
  } catch (error) {
    return refuse('invalid-record', error instanceof Error ? error.message : String(error));
  }

  const before = validateAdrFrontmatter(data, input.path);
  const beforeErrors = errorFindings(before.findings);
  if (!before.record || beforeErrors.length > 0) {
    return refuse('invalid-record', `${input.path} is not a valid record; fix it before accepting.`, beforeErrors);
  }

  const frontmatter = before.record.frontmatter;
  if (frontmatter.status !== 'proposed') {
    const hint =
      frontmatter.status === 'draft'
        ? ' A draft has not been proposed yet; set status: proposed and let it go through review first.'
        : '';
    return refuse('not-proposed', `ADR-${frontmatter.id} is "${frontmatter.status}", not "proposed".${hint}`);
  }

  const review = frontmatter.review;
  const unresolved = (review?.objections ?? []).filter((objection) => !objection.resolved);
  if (unresolved.length > 0) {
    const names = unresolved.map((objection) => objection.by).join(', ');
    return refuse(
      'unresolved-objections',
      `ADR-${frontmatter.id} has ${unresolved.length} unresolved objection(s) (${names}); resolve them before accepting.`,
    );
  }
  // Distinct people, so one reviewer under two spellings cannot meet quorum (ADR-0051).
  const approvals = distinctIdentityCount(review?.approvals ?? []);
  if (review?.quorum !== undefined && approvals < review.quorum) {
    return refuse(
      'quorum-not-met',
      `ADR-${frontmatter.id} has ${approvals} of ${review.quorum} required approval(s); record the approvals before accepting.`,
    );
  }

  const located = locateFrontmatter(input.source);
  const document = parseDocument(located.yaml, { strict: true, prettyErrors: false });
  const root = document.contents;
  if (!isMap(root) || root.flow) {
    return refuse('unsupported-layout', 'The frontmatter is not a block mapping; edit this record by hand.');
  }

  const edits: Array<Edit | string> = [
    statusEdit(root),
    childEdit(located, root, 'provenance', 'ratifiedBy', input.by, quoted),
    childEdit(located, root, 'review', 'decidedAt', input.decidedAt, (value) => value),
  ];
  const problem = edits.find((edit): edit is string => typeof edit === 'string');
  if (problem) return refuse('unsupported-layout', problem);

  const finished = finishSplice({
    source: input.source,
    located,
    edits: edits as Edit[],
    expected: expectedAfter(data as Record<string, unknown>, input.by, input.decidedAt),
    path: input.path,
    owned: 'status, ratifiedBy, and decidedAt',
    resultNoun: 'a valid accepted record',
    id: frontmatter.id,
  });
  if (!finished.ok) return refuse(finished.code, finished.message, finished.findings);
  return { ok: true, content: finished.content };
}
