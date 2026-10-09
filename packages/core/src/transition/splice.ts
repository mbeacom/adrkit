/**
 * @adrkit/core — shared line-splicing machinery for the record transitions
 * (ADR-0044, ADR-0051).
 *
 * Internal: nothing here is exported from the package entry point. Every transition
 * edits frontmatter by splicing source lines rather than re-serializing YAML, then
 * parses the result again and refuses unless the data equals exactly what the
 * transition meant to write. `finishSplice` is that shared tail, so no transition can
 * skip the re-check.
 */

import { isScalar, Scalar, type Pair, type YAMLMap } from 'yaml';
import { FrontmatterError, parseFrontmatter } from '../parse/frontmatter.ts';
import { validateAdrFrontmatter } from '../validate/contract.ts';
import type { Finding } from '../validate/findings.ts';

export interface Edit {
  start: number;
  end: number;
  text: string;
  /** A new top-level block; at a shared offset it must follow child lines of the block above. */
  newBlock?: boolean;
}

export interface Located {
  yaml: string;
  /** Offset of `yaml` within the full source. */
  offset: number;
  eol: string;
}

export function locateFrontmatter(source: string): Located {
  const firstLineEnd = source.indexOf('\n');
  const eol = firstLineEnd > 0 && source[firstLineEnd - 1] === '\r' ? '\r\n' : '\n';
  const offset = firstLineEnd + 1;
  let lineStart = offset;
  while (lineStart <= source.length) {
    const next = source.indexOf('\n', lineStart);
    const lineEnd = next === -1 ? source.length : next;
    const raw = source.slice(lineStart, lineEnd);
    if ((raw.endsWith('\r') ? raw.slice(0, -1) : raw) === '---') {
      return { yaml: source.slice(offset, lineStart), offset, eol };
    }
    if (next === -1) break;
    lineStart = next + 1;
  }
  // parseFrontmatter already accepted this source, so this is unreachable.
  throw new FrontmatterError('unterminated-frontmatter', 'ADR frontmatter is missing its closing --- fence');
}

export function keyOf(pair: Pair): unknown {
  return isScalar(pair.key) ? pair.key.value : pair.key;
}

export function lineStartOf(text: string, index: number): number {
  return text.lastIndexOf('\n', index - 1) + 1;
}

/**
 * Back `point` (a line start) up over blank lines and comment lines, which belong to
 * whatever follows rather than to the block above. With `indentedComments` false only
 * column-0 comments are skipped, which is the rule for top-level blocks.
 */
export function backUpOverTrivia(yaml: string, point: number, indentedComments: boolean, floor = 0): number {
  // `floor` is the line after the block's last value: never back up into it. Without
  // it, a keep-chomped scalar's trailing blank lines or a literal block's `# …` line
  // would be read as trivia and the insertion would land inside the scalar.
  while (point > floor) {
    const previousLineStart = lineStartOf(yaml, point - 1);
    const line = yaml.slice(previousLineStart, point).replace(/\r?\n$/, '');
    const comment = indentedComments ? line.trimStart().startsWith('#') : line.startsWith('#');
    if (line.trim() === '' || comment) {
      point = previousLineStart;
      continue;
    }
    break;
  }
  return point;
}

/**
 * The offset at which a new last child line of `root.items[index]` belongs: the start
 * of the next top-level key's line, backed up over blank lines and column-0 comments
 * (which belong to that next key, not to this block). End of the YAML when last.
 */
export function blockInsertionPoint(yaml: string, root: YAMLMap, index: number, keepValue = false): number {
  const next = root.items[index + 1];
  const point = next && isScalar(next.key) && next.key.range ? lineStartOf(yaml, next.key.range[0]) : yaml.length;
  const value = root.items[index]?.value as { range?: [number, number, number] } | null | undefined;
  const floor = keepValue && value?.range ? lineAfter(yaml, value.range[1]) : 0;
  return backUpOverTrivia(yaml, point, false, floor);
}

/** `offset` if it starts a line, else the start of the next line (or the end). */
export function lineAfter(yaml: string, offset: number): number {
  if (offset <= 0 || yaml[offset - 1] === '\n') return offset;
  const next = yaml.indexOf('\n', offset);
  return next === -1 ? yaml.length : next + 1;
}

/** A newline is owed before `point` when the text before it does not end in one. */
export function leadAt(yaml: string, point: number, eol: string): string {
  return point > 0 && !yaml.slice(0, point).endsWith('\n') ? eol : '';
}

export function quoted(value: string): string {
  return JSON.stringify(value);
}

export function renderScalarLike(original: Scalar, value: string): string {
  if (original.type === Scalar.QUOTE_DOUBLE) return JSON.stringify(value);
  if (original.type === Scalar.QUOTE_SINGLE) return `'${value.replace(/'/g, "''")}'`;
  return value;
}

/**
 * Insertions can share an offset: an absent block is appended at the end, which is
 * also where a child of an existing last block goes. Child lines come first so they
 * stay inside their block; new blocks then follow in the order listed.
 */
export function mergeEdits(edits: readonly Edit[]): Edit[] {
  const concrete = [...edits].sort((a, b) => Number(Boolean(a.newBlock)) - Number(Boolean(b.newBlock)));
  const merged: Edit[] = [];
  for (const edit of concrete) {
    const same = merged.find((other) => other.start === edit.start && other.end === edit.end && other.start === other.end);
    if (same && edit.start === edit.end) same.text += edit.text;
    else merged.push({ ...edit });
  }
  return merged;
}

export function applyEdits(yaml: string, edits: readonly Edit[]): string {
  let output = yaml;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    return (
      sameValue(aKeys, bKeys) &&
      aKeys.every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
    );
  }
  return false;
}

export function errorFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) => finding.severity === 'error');
}

export interface FinishSpliceInput {
  source: string;
  located: Located;
  edits: readonly Edit[];
  /** The complete frontmatter data the edit is meant to produce. */
  expected: unknown;
  path: string;
  /** Names the fields the transition owns, for the refusal message. */
  owned: string;
  /** Completes "ADR-0007 would not be ...", e.g. "a valid accepted record". */
  resultNoun: string;
  id: string;
}

export type FinishSpliceResult =
  | { ok: true; content: string }
  | { ok: false; code: 'unsupported-layout' | 'invalid-result'; message: string; findings?: Finding[] };

/**
 * Apply `edits`, parse the result again, and refuse unless it equals `expected` and
 * still validates. This is the guard that turns a splice bug into a refusal instead
 * of a corrupted record.
 */
export function finishSplice(input: FinishSpliceInput): FinishSpliceResult {
  const { source, located } = input;
  const yaml = applyEdits(located.yaml, mergeEdits(input.edits));
  const content = source.slice(0, located.offset) + yaml + source.slice(located.offset + located.yaml.length);

  let afterData: unknown;
  try {
    afterData = parseFrontmatter(content).data;
  } catch (error) {
    return {
      ok: false,
      code: 'unsupported-layout',
      message: `The edited frontmatter no longer parses (${error instanceof Error ? error.message : String(error)}); edit this record by hand.`,
    };
  }
  if (!sameValue(afterData, input.expected)) {
    return {
      ok: false,
      code: 'unsupported-layout',
      message: `The edit would change a field other than ${input.owned}; edit this record by hand.`,
    };
  }

  const after = validateAdrFrontmatter(afterData, input.path);
  const afterErrors = errorFindings(after.findings);
  if (afterErrors.length > 0) {
    return {
      ok: false,
      code: 'invalid-result',
      message: `ADR-${input.id} would not be ${input.resultNoun}: ${afterErrors.map((finding) => finding.message).join('; ')}`,
      findings: afterErrors,
    };
  }
  return { ok: true, content };
}
