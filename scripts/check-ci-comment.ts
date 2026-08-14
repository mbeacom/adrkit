/**
 * Fail when a pull request does not carry exactly one governing-decisions comment.
 *
 * This is the end-to-end gate for `packages/ci`'s comment path. Unit and contract
 * coverage, and the `self-dogfood` job, were all green throughout
 * [#107](https://github.com/mbeacom/adrkit/issues/107) — a defect that posted a fresh
 * comment on every push for two releases — because the defect lived in an
 * environmental assumption that only exists in the Action's runtime, and the job log
 * it produced (`adrkit: created the governing-decisions comment.`) is exactly what
 * healthy operation prints. The only thing that distinguishes the two is the state of
 * the pull request afterwards, which is what this reads
 * ([ADR-0026](../docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md) action item 9,
 * [#135](https://github.com/mbeacom/adrkit/issues/135)).
 *
 *   gh api --paginate "repos/$REPO/issues/$PR/comments" | bun run scripts/check-ci-comment.ts
 *   bun run scripts/check-ci-comment.ts comments.json
 *   bun run scripts/check-ci-comment.ts comments.json --expect-total=42 --expect-id=123
 *
 * Input is the JSON array `GET /repos/{owner}/{repo}/issues/{issue_number}/comments`
 * returns, read from a file argument or from stdin. `gh api --paginate` merges pages of
 * a top-level array into one document (verified against gh 2.96.0), so the payload
 * parses as a single array — but a caller who forgets `--paginate` gets a silently
 * short list, which `--expect-total` exists to catch.
 *
 * The same script backs the reference-repository run
 * ([ADR-0014](../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
 * rung 2, see `specs/004-ci-surface/evidence/reference-repo/`), so both rungs answer
 * "is the comment unique?" with one rule rather than two that can drift apart.
 *
 * It imports only Node and Bun builtins — deliberately, like `check-dco.ts`. The
 * marker below is duplicated from `packages/ci/src/comment.ts` rather than imported,
 * and `check-ci-comment.test.ts` asserts the two are equal, so drift fails a unit test
 * instead of silently making this gate look for a string nothing posts.
 *
 * **Known limitation (#137).** Like every gate in this repository, this runs from the
 * pull request's own checkout, so a change that edits this file or the workflow step
 * invoking it can produce a green status over a broken Action.
 */

import { readFile, writeFile } from 'node:fs/promises';

/**
 * Must equal `CI_COMMENT_MARKER` in `packages/ci/src/comment.ts`. Asserted by
 * `check-ci-comment.test.ts` — a copy nothing compares is a copy that drifts.
 */
export const CI_COMMENT_MARKER = '<!-- adrkit:ci -->';

/** A comment as this gate needs it — the subset of GitHub's payload it reads. */
export interface ExaminedComment {
  id?: number;
  body?: string | null;
  user?: { login?: string | null; type?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * How a comment relates to the Action.
 *
 * - `own` — the marker is exactly the body's first line. Every body both renderers in
 *   `comment.ts` emit has this shape, and `github.ts:markerLeadsBody` is the reader
 *   that depends on it ([ADR-0026](../docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md)).
 * - `quoting` — the marker appears, but not as the first line. A human quoting the
 *   comment produces this, and the Action never does. Reported, never failed: R5/FR-005
 *   exists precisely so a quote is not mistaken for the Action's own comment, and a
 *   gate that failed on one would punish the behaviour the Action gets right.
 */
export type Relation = 'own' | 'quoting';

export interface ClassifiedComment {
  id: number;
  relation: Relation;
  author: string;
  authorType: string;
  /** The body's first line, bounded — enough to recognise a comment, not to flood a log. */
  firstLine: string;
  createdAt: string;
  updatedAt: string;
  /** Whether GitHub records an edit after creation. Reported, never asserted — see {@link formatReport}. */
  edited: boolean;
}

export type ViolationRule = 'absent' | 'duplicate' | 'not-a-bot' | 'incomplete' | 'id-changed';

export interface Violation {
  rule: ViolationRule;
  message: string;
}

/**
 * Optional cross-checks the caller can supply from outside the comment list.
 *
 * Both exist because the list alone cannot answer them, and both failures are silent
 * without them (ADR-0016):
 *
 * - `expectTotal` — the comment count GitHub reports for the issue itself. A list that
 *   is short of it was truncated, and a duplicate hiding on an unfetched page reads
 *   exactly like a healthy single comment. This is the same completeness property R5
 *   requires of the Action's own `octokit.paginate` call, applied to the verifier.
 * - `expectId` — the comment id observed after an earlier dispatch. An in-place update
 *   preserves the id; a create issues a new one. This is a **specific observed value**
 *   rather than a count (ADR-0016 clause 3), and it is strictly better evidence than
 *   `edited`: whether GitHub bumps `updated_at` on a PATCH whose body is byte-identical
 *   is not contractual, whereas id stability is.
 */
export interface CrossChecks {
  expectTotal?: number;
  expectId?: number;
}

export interface CommentReport {
  /** Every comment the input contained, matched or not. Always reported. */
  examined: number;
  own: ClassifiedComment[];
  quoting: ClassifiedComment[];
  violations: Violation[];
}

const MAX_FIRST_LINE = 120;
const UNKNOWN = '(unknown)';

/**
 * The body's first physical line, under any of the three line terminators.
 *
 * Identical to `github.ts:markerLeadsBody` and `queue-issue.ts`, on purpose: three
 * places now decide "is this ours?" and they must decide it the same way. A body
 * GitHub returns with CRLF must not read as unmarked here while the Action claims it.
 */
function firstLineOf(body: string): string {
  return body.split(/\r\n|\n|\r/, 1)[0] ?? '';
}

function bound(line: string): string {
  return line.length > MAX_FIRST_LINE ? `${line.slice(0, MAX_FIRST_LINE)}…` : line;
}

/**
 * Pure: classify one comment, or `undefined` when it mentions the marker nowhere.
 *
 * A non-string body is treated as no body rather than skipped silently — GitHub omits
 * `body` from a comment whose content the caller may not read, and a gate that dropped
 * those would report "one comment" over a list it had only partly understood.
 */
export function classify(comment: ExaminedComment): ClassifiedComment | undefined {
  const body = typeof comment.body === 'string' ? comment.body : '';
  if (!body.includes(CI_COMMENT_MARKER)) return undefined;

  const first = firstLineOf(body);
  return {
    id: typeof comment.id === 'number' ? comment.id : -1,
    relation: first === CI_COMMENT_MARKER ? 'own' : 'quoting',
    author: comment.user?.login ?? UNKNOWN,
    authorType: comment.user?.type ?? UNKNOWN,
    firstLine: bound(first),
    createdAt: comment.created_at ?? UNKNOWN,
    updatedAt: comment.updated_at ?? UNKNOWN,
    edited:
      typeof comment.created_at === 'string' &&
      typeof comment.updated_at === 'string' &&
      comment.created_at !== comment.updated_at,
  };
}

/**
 * Pure: the uniqueness verdict over a pull request's complete comment list.
 *
 * Three rules, and the first is the one that makes this gate worth having:
 *
 * - **`absent`** — the caller has just run the Action, so exactly one marked comment
 *   must exist. Asserting "at most one" instead would be satisfied by an empty list,
 *   and an empty list is what a revoked permission, a wrong pull-request number, and a
 *   silently-failed Action all produce. That is the shape
 *   [ADR-0016](../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
 *   names: a check that reports an absence cannot distinguish "nothing is wrong" from
 *   "I could not look".
 * - **`duplicate`** — the #107 shape, and the regression this gate exists to catch.
 * - **`not-a-bot`** — the count is right but the comment cannot be attributed to the
 *   Action. A specific observed value rather than a count (ADR-0016 clause 3): the
 *   default `GITHUB_TOKEN` posts as `github-actions[bot]`, type `Bot`, so a `User`
 *   here means a person's hand-written comment is being counted as the Action's and
 *   the real one may be missing.
 */
export function findCommentViolations(
  comments: readonly ExaminedComment[],
  checks: CrossChecks = {},
): CommentReport {
  const own: ClassifiedComment[] = [];
  const quoting: ClassifiedComment[] = [];

  for (const comment of comments) {
    const classified = classify(comment);
    if (!classified) continue;
    (classified.relation === 'own' ? own : quoting).push(classified);
  }

  const violations: Violation[] = [];

  // Checked first, and reported alongside rather than instead of the rules below: if
  // the list is short, every count derived from it is drawn from a partial view, and
  // saying so is more useful than reporting a verdict that was reached blind.
  //
  // Deliberately `<` and not `!==`. The caller reads the reported total *before* the
  // list, so a comment arriving between the two calls makes the list one LONGER than
  // the total, which is benign. Treating that as a mismatch would fail a healthy run
  // whenever a human commented mid-job.
  if (checks.expectTotal !== undefined && comments.length < checks.expectTotal) {
    violations.push({
      rule: 'incomplete',
      message:
        `GitHub reports ${checks.expectTotal} comment(s) on this pull request but the list ` +
        `held only ${comments.length}. The comment list was truncated, so a duplicate on an ` +
        `unfetched page would read exactly like a healthy single comment. Check that the ` +
        `caller passed --paginate.`,
    });
  }

  if (own.length === 0) {
    violations.push({
      rule: 'absent',
      message:
        `no comment leads with ${CI_COMMENT_MARKER}, across ${comments.length} comment(s) examined. ` +
        `The Action was expected to have posted one. This is "could not look" and "nothing to see" ` +
        `rendering the same — the token may lack pull-requests: write, the pull-request number may ` +
        `be wrong, or the Action may have degraded to a log notice.`,
    });
  } else if (own.length > 1) {
    violations.push({
      rule: 'duplicate',
      message:
        `${own.length} comments lead with ${CI_COMMENT_MARKER}; exactly one is expected. ` +
        `The Action created a comment instead of updating its own — the regression of ` +
        `https://github.com/mbeacom/adrkit/issues/107.`,
    });
  } else {
    const only = own[0] as ClassifiedComment;
    if (only.authorType !== 'Bot') {
      violations.push({
        rule: 'not-a-bot',
        message:
          `the only comment leading with ${CI_COMMENT_MARKER} is authored by ${only.author} ` +
          `(type ${only.authorType}), not a Bot, so it cannot be attributed to the Action. ` +
          `The Action's own comment may be missing behind a human's.`,
      });
    }
    if (checks.expectId !== undefined && only.id !== checks.expectId) {
      violations.push({
        rule: 'id-changed',
        message:
          `the governing-decisions comment is #${only.id}, but #${checks.expectId} was ` +
          `observed after the previous dispatch. An in-place update preserves the id, so a ` +
          `new id means the Action created a replacement — the count is one only because ` +
          `the earlier comment is gone, not because it was updated.`,
      });
    }
  }

  return { examined: comments.length, own, quoting, violations };
}

/**
 * Pure: parse the payload `gh api --paginate .../comments` produces.
 *
 * Anything that is not a JSON array throws rather than being coerced to an empty list.
 * `gh` prints an error object on a failed request, and reading that as "zero comments"
 * would turn a failed API call into a passing gate for the `absent` rule to then
 * misattribute.
 */
export function parseComments(input: string): ExaminedComment[] {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new Error('the comment payload was empty; expected a JSON array from the GitHub API');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `the comment payload is not JSON (${error instanceof Error ? error.message : String(error)}); ` +
        `expected a JSON array from the GitHub API`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `the comment payload is a ${parsed === null ? 'null' : typeof parsed}, not a JSON array; ` +
        `a failed \`gh api\` call prints an error object, which must not be read as zero comments`,
    );
  }
  return parsed as ExaminedComment[];
}

/**
 * State what was examined, not only what was concluded (ADR-0016's complementary half).
 *
 * `edited` is reported and never asserted. It is the signal the #107 reporter used —
 * `updated_at` advancing past `created_at` — but whether GitHub bumps `updated_at` on a
 * PATCH whose body is byte-identical is not contractual, and two dispatches in one run
 * render identical bodies. `--expect-id` is the assertion that carries that weight
 * instead: id stability across dispatches distinguishes an in-place update from a
 * replacement without depending on an undocumented API detail.
 */
export function formatReport(report: CommentReport): string {
  const lines = [
    `check-ci-comment: examined ${report.examined} comment(s); ` +
      `${report.own.length} lead with the marker, ${report.quoting.length} quote it`,
  ];
  for (const comment of [...report.own, ...report.quoting]) {
    lines.push(
      `  ${comment.relation.padEnd(7)} #${comment.id}  ${comment.author} (${comment.authorType})  ` +
        `created ${comment.createdAt}  updated ${comment.updatedAt}` +
        `${comment.edited ? '  [edited]' : ''}`,
    );
    lines.push(`          first line: ${comment.firstLine || '(empty)'}`);
  }
  return lines.join('\n');
}

/**
 * Pure: read the flags this gate accepts, so argument handling is testable rather than
 * improvised in bash. A malformed value throws instead of being silently dropped —
 * `--expect-total=` with an empty value would otherwise disable the completeness check
 * while looking like it was applied.
 */
export function parseArgs(argv: readonly string[]): { path?: string; checks: CrossChecks; idFile?: string } {
  const checks: CrossChecks = {};
  let path: string | undefined;
  let idFile: string | undefined;

  for (const arg of argv) {
    const idOut = /^--id-file=(.*)$/.exec(arg);
    if (idOut) {
      if ((idOut[1] as string).trim() === '') throw new Error('--id-file needs a path');
      idFile = idOut[1] as string;
      continue;
    }
    const flag = /^--(expect-total|expect-id)=(.*)$/.exec(arg);
    if (flag) {
      const raw = flag[2] as string;
      // `Number('')` is 0, which is a perfectly good non-negative integer — so an empty
      // value would disable the check while looking exactly like it was applied. Test
      // `refuses an empty cross-check value` observed this passing before the guard.
      const value = raw.trim() === '' ? Number.NaN : Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`--${flag[1]} needs a non-negative integer, got "${raw}"`);
      }
      if (flag[1] === 'expect-total') checks.expectTotal = value;
      else checks.expectId = value;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`unrecognised option ${arg}`);
    path = arg;
  }

  return { path, checks, idFile };
}

export async function main(argv: readonly string[]): Promise<void> {
  const { path, checks, idFile } = parseArgs(argv);
  const payload = path ? await readFile(path, 'utf8') : await Bun.stdin.text();
  const report = findCommentViolations(parseComments(payload), checks);
  console.log(formatReport(report));

  if (report.violations.length > 0) {
    const detail = report.violations
      .map((violation) => `  [${violation.rule}] ${violation.message}`)
      .join('\n\n');
    throw new Error(
      `the governing-decisions comment is not unique on this pull request:\n\n${detail}\n\n` +
        `The Action must post one comment per pull request and update it in place\n` +
        `(ADR-0026). Reproduce locally with:\n` +
        `  gh api --paginate "repos/<owner>/<repo>/issues/<pr>/comments" | bun run check:ci-comment`,
    );
  }

  const only = report.own[0] as ClassifiedComment;
  console.log(
    `check-ci-comment: ok — exactly one governing-decisions comment (#${only.id}), authored by ${only.author}`,
  );
  // Written to a file rather than a stream so the caller can feed it to the next
  // dispatch's --expect-id without redirecting stdout, which would hide the report
  // above from the job log — the half of ADR-0016 that says state what you examined.
  if (idFile) await writeFile(idFile, `${only.id}\n`, 'utf8');
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-ci-comment: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
