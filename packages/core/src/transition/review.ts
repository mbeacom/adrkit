/**
 * @adrkit/core — review-state transitions on a `proposed` record (ADR-0051).
 *
 * `approveAdrSource` appends to `review.approvals`, `objectAdrSource` appends to
 * `review.objections`, and `resolveObjectionAdrSource` sets one objection's
 * `resolved: true`. Each is pure: no clock, no filesystem. Like `acceptAdrSource`
 * (ADR-0044) they splice lines instead of re-serializing YAML, keep a flow list a flow
 * list and a block list a block list, and then hand the result to the shared re-parse
 * guard, which refuses unless every field other than the one owned is unchanged.
 *
 * These write human review state under a named identity. No agent surface runs them
 * (ADR-0051); the CLI is their only caller.
 */

import { isMap, isScalar, isSeq, parseDocument, type Pair, type YAMLMap, type YAMLSeq } from 'yaml';
import { parseFrontmatter } from '../parse/frontmatter.ts';
import { type AdrFrontmatter } from '../schema/adr.schema.ts';
import { distinctIdentityCount, hasInvisibleOrControl, isWritableIdentity, sameIdentity } from '../schema/identity.ts';
import { validateAdrFrontmatter } from '../validate/contract.ts';
import type { Finding } from '../validate/findings.ts';
import {
  backUpOverTrivia,
  blockInsertionPoint,
  errorFindings,
  finishSplice,
  keyOf,
  leadAt,
  lineAfter,
  lineStartOf,
  locateFrontmatter,
  quoted,
  type Edit,
  type Located,
} from './splice.ts';

/** The longest objection summary accepted, in code points. */
export const MAX_OBJECTION_SUMMARY_LENGTH = 500;

export interface ApproveAdrInput {
  /** Full record source, frontmatter fences included. */
  source: string;
  /** The approver: `@handle`, `team:slug`, or an email address. */
  by: string;
  /** Display path, used only in findings. */
  path: string;
}

export interface ObjectAdrInput extends ApproveAdrInput {
  /** One line, at most {@link MAX_OBJECTION_SUMMARY_LENGTH} code points. */
  summary: string;
}

export interface ResolveObjectionAdrInput extends ApproveAdrInput {
  /** 1-based position of the objection, in file order. */
  objection: number;
}

export type ReviewRefusalCode =
  | 'invalid-identity'
  | 'invalid-summary'
  | 'invalid-objection-index'
  | 'invalid-record'
  | 'not-proposed'
  | 'objection-not-found'
  | 'not-objector'
  | 'unsupported-layout'
  | 'invalid-result';

export type ReviewRefusal = { ok: false; code: ReviewRefusalCode; message: string; findings?: Finding[] };

/** `changed: false` is a no-op: `content` is the source, byte for byte. */
export type ApproveAdrResult = { ok: true; changed: boolean; content: string; approvals: number } | ReviewRefusal;
export type ObjectAdrResult = { ok: true; changed: boolean; content: string; objection: number } | ReviewRefusal;
export type ResolveObjectionAdrResult = { ok: true; changed: boolean; content: string } | ReviewRefusal;

function refuse(code: ReviewRefusalCode, message: string, findings?: Finding[]): ReviewRefusal {
  return findings ? { ok: false, code, message, findings } : { ok: false, code, message };
}

/** Why `summary` cannot be written, or undefined when it can. */
export function objectionSummaryProblem(summary: string): string | undefined {
  const trimmed = summary.trim();
  if (trimmed === '') return 'The objection summary is empty.';
  // Control characters (newlines, tabs, escapes), invisible format characters (bidi
  // overrides, zero-width characters, the BOM), and the Unicode line separators.
  if (hasInvisibleOrControl(summary)) {
    return 'The objection summary must be one line with no control or invisible characters.';
  }
  if ([...trimmed].length > MAX_OBJECTION_SUMMARY_LENGTH) {
    return `The objection summary is longer than ${MAX_OBJECTION_SUMMARY_LENGTH} characters.`;
  }
  return undefined;
}

interface Prepared {
  data: Record<string, unknown>;
  frontmatter: AdrFrontmatter;
  located: Located;
  root: YAMLMap;
}

/** Shared preconditions: a valid identity, a valid record, status `proposed`, a block root. */
function prepare(input: ApproveAdrInput, verb: string): Prepared | ReviewRefusal {
  if (!isWritableIdentity(input.by)) {
    return refuse(
      'invalid-identity',
      `${JSON.stringify(input.by)} is not an identity this command writes. Expected @handle, team:slug, or an email address. It may contain no control or invisible characters.`,
    );
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
    return refuse('invalid-record', `${input.path} is not a valid record; fix it before ${verb}.`, beforeErrors);
  }

  const frontmatter = before.record.frontmatter;
  if (frontmatter.status !== 'proposed') {
    return refuse(
      'not-proposed',
      `ADR-${frontmatter.id} is "${frontmatter.status}", not "proposed"; review state changes only while a record is under review.`,
    );
  }

  const located = locateFrontmatter(input.source);
  const root = parseDocument(located.yaml, { strict: true, prettyErrors: false }).contents;
  if (!isMap(root) || root.flow) {
    return refuse('unsupported-layout', 'The frontmatter is not a block mapping; edit this record by hand.');
  }
  return { data: data as Record<string, unknown>, frontmatter, located, root };
}

const isRefusal = (value: unknown): value is ReviewRefusal =>
  typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;

function pairOf(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((pair) => keyOf(pair) === key);
}

/** The `review:` block, or a reason it cannot be spliced. Undefined when absent. */
function reviewBlock(root: YAMLMap): { index: number; map: YAMLMap } | undefined | string {
  const index = root.items.findIndex((pair) => keyOf(pair) === 'review');
  if (index === -1) return undefined;
  const map = root.items[index]!.value;
  if (!isMap(map) || map.flow || map.items.length === 0) return '"review" is not a block mapping; edit this record by hand';
  return { index, map };
}

/**
 * Where a new last line of the block list `seq` belongs: before the next key of the
 * `review` block, or, when the list is that block's last key, where the block ends.
 * Trailing blank and comment lines stay below the new line.
 */
function seqEnd(yaml: string, root: YAMLMap, review: { index: number; map: YAMLMap }, key: string): number {
  const position = review.map.items.findIndex((pair) => keyOf(pair) === key);
  const next = review.map.items[position + 1];
  const boundary =
    next && isScalar(next.key) && next.key.range
      ? lineStartOf(yaml, next.key.range[0])
      : blockInsertionPoint(yaml, root, review.index, true);
  const seq = review.map.items[position]?.value as { range?: [number, number, number] } | null | undefined;
  return backUpOverTrivia(yaml, boundary, true, seq?.range ? lineAfter(yaml, seq.range[1]) : 0);
}

/**
 * Append one item to `review[key]`, written as `blockItem(indent)` in a block list or
 * `flowItem` in a flow list. Covers an absent `review`, an absent key, a block list,
 * and a flow list, empty or not.
 */
function appendEdit(
  located: Located,
  root: YAMLMap,
  key: string,
  blockItem: (dashIndent: string) => string,
  flowItem: string,
): Edit | string {
  const { yaml, eol } = located;
  const review = reviewBlock(root);
  if (typeof review === 'string') return review;

  if (review === undefined) {
    const point = blockInsertionPoint(yaml, root, root.items.length - 1, true);
    return { start: point, end: point, text: `${leadAt(yaml, point, eol)}review:${eol}  ${key}:${eol}${blockItem('    ')}` };
  }

  const pair = pairOf(review.map, key);
  if (!pair) {
    const firstKey = review.map.items[0]!.key;
    if (!isScalar(firstKey) || !firstKey.range) return '"review" has a key this command cannot locate; edit this record by hand';
    const indent = yaml.slice(lineStartOf(yaml, firstKey.range[0]), firstKey.range[0]);
    if (!/^ +$/.test(indent)) return '"review" is not an indented block mapping; edit this record by hand';
    const point = blockInsertionPoint(yaml, root, review.index, true);
    return { start: point, end: point, text: `${leadAt(yaml, point, eol)}${indent}${key}:${eol}${blockItem(`${indent}  `)}` };
  }

  const seq = pair.value;
  if (!isSeq(seq) || !seq.range) return `"review.${key}" is not a list; edit this record by hand`;
  if (seq.flow) {
    if (yaml[seq.range[0]] !== '[' || yaml[seq.range[1] - 1] !== ']') {
      return `"review.${key}" is not a bracketed flow list; edit this record by hand`;
    }
    const last = seq.items.at(-1) as { range?: [number, number, number] } | undefined;
    if (seq.items.length === 0) return { start: seq.range[0] + 1, end: seq.range[0] + 1, text: flowItem };
    if (!last?.range) return `"review.${key}" has an item this command cannot locate; edit this record by hand`;
    return { start: last.range[1], end: last.range[1], text: `, ${flowItem}` };
  }

  const dashIndent = yaml.slice(lineStartOf(yaml, seq.range[0]), seq.range[0]);
  if (!/^ *$/.test(dashIndent)) return `"review.${key}" is not an indented block list; edit this record by hand`;
  const point = seqEnd(yaml, root, review, key);
  return { start: point, end: point, text: `${leadAt(yaml, point, eol)}${blockItem(dashIndent)}` };
}

function cloneData(data: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(data);
}

function reviewOf(data: Record<string, unknown>): Record<string, unknown> {
  const review = (data.review as Record<string, unknown> | undefined) ?? {};
  data.review = review;
  return review;
}

export function approveAdrSource(input: ApproveAdrInput): ApproveAdrResult {
  const prepared = prepare(input, 'approving');
  if (isRefusal(prepared)) return prepared;
  const { data, frontmatter, located, root } = prepared;

  const approvals = frontmatter.review?.approvals ?? [];
  if (approvals.some((approval) => sameIdentity(approval, input.by))) {
    return { ok: true, changed: false, content: input.source, approvals: distinctIdentityCount(approvals) };
  }

  const value = quoted(input.by);
  const edit = appendEdit(located, root, 'approvals', (dash) => `${dash}- ${value}${located.eol}`, value);
  if (typeof edit === 'string') return refuse('unsupported-layout', edit);

  const expected = cloneData(data);
  const review = reviewOf(expected);
  review.approvals = [...((review.approvals as unknown[] | undefined) ?? []), input.by];

  const finished = finishSplice({
    source: input.source,
    located,
    edits: [edit],
    expected,
    path: input.path,
    owned: 'review.approvals',
    resultNoun: 'a valid record',
    id: frontmatter.id,
  });
  if (!finished.ok) return refuse(finished.code, finished.message, finished.findings);
  return { ok: true, changed: true, content: finished.content, approvals: distinctIdentityCount([...approvals, input.by]) };
}

export function objectAdrSource(input: ObjectAdrInput): ObjectAdrResult {
  const summaryProblem = objectionSummaryProblem(input.summary);
  const prepared = prepare(input, 'objecting');
  if (isRefusal(prepared)) return prepared;
  if (summaryProblem) return refuse('invalid-summary', summaryProblem);
  const { data, frontmatter, located, root } = prepared;
  const summary = input.summary.trim();

  const objections = frontmatter.review?.objections ?? [];
  const existing = objections.findIndex(
    (objection) => sameIdentity(objection.by, input.by) && objection.summary === summary && !objection.resolved,
  );
  if (existing !== -1) return { ok: true, changed: false, content: input.source, objection: existing + 1 };

  const by = quoted(input.by);
  const text = quoted(summary);
  const { eol } = located;
  const edit = appendEdit(
    located,
    root,
    'objections',
    (dash) => `${dash}- by: ${by}${eol}${dash}  summary: ${text}${eol}${dash}  resolved: false${eol}`,
    `{ by: ${by}, summary: ${text}, resolved: false }`,
  );
  if (typeof edit === 'string') return refuse('unsupported-layout', edit);

  const expected = cloneData(data);
  const review = reviewOf(expected);
  review.objections = [
    ...((review.objections as unknown[] | undefined) ?? []),
    { by: input.by, summary, resolved: false },
  ];

  const finished = finishSplice({
    source: input.source,
    located,
    edits: [edit],
    expected,
    path: input.path,
    owned: 'review.objections',
    resultNoun: 'a valid record',
    id: frontmatter.id,
  });
  if (!finished.ok) return refuse(finished.code, finished.message, finished.findings);
  return { ok: true, changed: true, content: finished.content, objection: objections.length + 1 };
}

/** Set `resolved: true` on one item of `review.objections`, block or flow. */
function resolvedEdit(located: Located, root: YAMLMap, position: number): Edit | string {
  const { yaml, eol } = located;
  const review = reviewBlock(root);
  if (typeof review !== 'object') return review ?? '"review" is missing';
  const seq = pairOf(review.map, 'objections')?.value as YAMLSeq | undefined;
  if (!isSeq(seq)) return '"review.objections" is not a list; edit this record by hand';
  const item = seq.items[position];
  if (!isMap(item) || !item.range) return `objection ${position + 1} is not a mapping; edit this record by hand`;

  const resolved = pairOf(item, 'resolved');
  if (resolved) {
    const value = resolved.value;
    if (!isScalar(value) || !value.range) return `objection ${position + 1} has a "resolved" this command cannot locate`;
    return { start: value.range[0], end: value.range[1], text: 'true' };
  }

  const last = item.items.at(-1);
  const lastValue = last?.value as { range?: [number, number, number] } | null | undefined;
  const lastKey = last?.key as { range?: [number, number, number] } | undefined;
  if (item.flow) {
    const end = lastValue?.range?.[1] ?? lastKey?.range?.[1];
    if (end === undefined) return `objection ${position + 1} has a field this command cannot locate; edit this record by hand`;
    return { start: end, end, text: ', resolved: true' };
  }

  const firstKey = item.items[0]?.key as { range?: [number, number, number] } | undefined;
  if (!firstKey?.range) return `objection ${position + 1} has a key this command cannot locate; edit this record by hand`;
  const column = firstKey.range[0] - lineStartOf(yaml, firstKey.range[0]);
  const next = seq.items[position + 1] as { range?: [number, number, number] } | undefined;
  let point: number;
  if (next?.range) {
    // The next item begins at its `-` indicator, which is usually on the same line as
    // its first key but may stand alone on the line above (`-` then `  by: …`).
    let dash = next.range[0] - 1;
    while (dash >= 0 && /[ \t\r\n]/.test(yaml[dash]!)) dash -= 1;
    const start = yaml[dash] === '-' ? dash : next.range[0];
    point = backUpOverTrivia(yaml, lineStartOf(yaml, start), true, lineAfter(yaml, item.range[1]));
  } else {
    point = seqEnd(yaml, root, review, 'objections');
  }
  return { start: point, end: point, text: `${leadAt(yaml, point, eol)}${' '.repeat(column)}resolved: true${eol}` };
}

export function resolveObjectionAdrSource(input: ResolveObjectionAdrInput): ResolveObjectionAdrResult {
  const prepared = prepare(input, 'resolving an objection');
  if (isRefusal(prepared)) return prepared;
  const { data, frontmatter, located, root } = prepared;

  if (!Number.isInteger(input.objection) || input.objection < 1) {
    return refuse('invalid-objection-index', `Objection numbers start at 1; "${input.objection}" is not one.`);
  }
  const objections = frontmatter.review?.objections ?? [];
  const objection = objections[input.objection - 1];
  if (!objection) {
    return refuse(
      'objection-not-found',
      `ADR-${frontmatter.id} has ${objections.length} objection(s); there is no objection ${input.objection}.`,
    );
  }
  if (!sameIdentity(objection.by, input.by)) {
    return refuse(
      'not-objector',
      `Objection ${input.objection} on ADR-${frontmatter.id} was raised by ${objection.by}; only the objector may resolve it.`,
    );
  }
  if (objection.resolved) return { ok: true, changed: false, content: input.source };

  const edit = resolvedEdit(located, root, input.objection - 1);
  if (typeof edit === 'string') return refuse('unsupported-layout', edit);

  const expected = cloneData(data);
  const review = reviewOf(expected);
  const list = [...(review.objections as Array<Record<string, unknown>>)];
  list[input.objection - 1] = { ...list[input.objection - 1], resolved: true };
  review.objections = list;

  const finished = finishSplice({
    source: input.source,
    located,
    edits: [edit],
    expected,
    path: input.path,
    owned: `review.objections[${input.objection - 1}].resolved`,
    resultNoun: 'a valid record',
    id: frontmatter.id,
  });
  if (!finished.ok) return refuse(finished.code, finished.message, finished.findings);
  return { ok: true, changed: true, content: finished.content };
}
