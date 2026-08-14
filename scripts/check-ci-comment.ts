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
 * ([ADR-0026](../docs/adr/0026-identify-the-ci-comment-by-the-strongest-author-evidence-the-token-allows.md)
 * action item 9, [#135](https://github.com/mbeacom/adrkit/issues/135)).
 *
 *   gh api --paginate "repos/$REPO/issues/$PR/comments" | bun run scripts/check-ci-comment.ts
 *   bun run scripts/check-ci-comment.ts comments.json --expect-total=42 --expect-id=123
 *   bun run scripts/check-ci-comment.ts --help
 *
 * Input is the JSON array `GET /repos/{owner}/{repo}/issues/{issue_number}/comments`
 * returns, read from a file argument or from stdin. `gh api --paginate` merges pages of
 * a top-level array into one document (verified against gh 2.96.0), so the payload
 * parses as a single array — but a caller who forgets `--paginate` gets a silently
 * short list, which `--expect-total` exists to catch.
 *
 * **Exit codes.** `0` ok; `1` a definitive violation, or a usage error; `2` only
 * *retryable* violations, meaning the read looks inconsistent rather than the comment
 * set being wrong. A caller that can retry should treat `2` as "read again", and must
 * not treat it as success.
 *
 * The same script backs the reference-repository run
 * ([ADR-0014](../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
 * rung 2, see `specs/004-ci-surface/evidence/reference-repo/`), so both rungs answer
 * "is the comment ours, and is it unique?" with one rule rather than two.
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

/**
 * The author type the Action posts under, and therefore the one half of ownership that
 * is not the marker.
 *
 * Both callers of this gate — `action-dogfood` and the rung-2 reference workflow — run
 * the Action with the default `GITHUB_TOKEN`, which is a GitHub App installation token.
 * ADR-0026 establishes that such a token cannot resolve its own login and therefore
 * claims its comment by exactly two signals: the author is a **bot**, and the marker is
 * the body's **first line**. This file applies the same pair, so the verifier's notion
 * of "ours" cannot be stricter than the Action's — which it was until review of #143,
 * where marker-leads-body alone let any human turn the gate red with one invisible line.
 *
 * A caller that runs the Action under a personal access token would post as a `User`
 * and would need this relaxed; neither caller does, and hardcoding it keeps the rule
 * identical to `github.ts:findOwnComment`'s app-installation branch.
 */
const ACTION_AUTHOR_TYPE = 'Bot';

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
 * - `own` — the marker is exactly the body's first line **and** a bot authored it.
 *   Both halves are required, matching `github.ts:findOwnComment`.
 * - `impostor` — the marker leads the body, but the author is not a bot. The Action
 *   would never claim this comment, so neither does the gate. Reported, and named in
 *   the `absent` diagnosis, but never counted toward `duplicate` — counting it is what
 *   made a required check trivially deniable by anyone who can comment.
 * - `quoting` — the marker appears, but not as the first line. A human quoting the
 *   comment produces this, and the Action never does.
 */
export type Relation = 'own' | 'impostor' | 'quoting';

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

export type ViolationRule = 'absent' | 'duplicate' | 'id-changed' | 'incomplete';

/**
 * Violations a caller may resolve by reading again, rather than by fixing anything.
 *
 * Only `incomplete` qualifies: it fires when the fetched list is shorter than the count
 * GitHub reports for the issue, which a lagging read replica produces as readily as a
 * lost `--paginate`. Every other rule describes the comment set itself, which reading
 * again cannot change — retrying those would be retrying until a gate passes.
 */
const RETRYABLE_RULES: ReadonlySet<ViolationRule> = new Set<ViolationRule>(['incomplete']);

export interface Violation {
  rule: ViolationRule;
  message: string;
}

/**
 * Optional cross-checks the caller supplies from outside the comment list.
 *
 * Each exists because the list alone cannot answer it, and each failure is silent
 * without it (ADR-0016):
 *
 * - `expectTotal` — the comment count GitHub reports for the issue itself, read around
 *   the list. A list shorter than that was truncated, and a duplicate hiding on an
 *   unfetched page reads exactly like a healthy single comment. Treat it as a **lower
 *   bound**: a caller reading the count and the list non-atomically should pass the
 *   *smallest* count it observed, so that a comment created or deleted mid-read cannot
 *   masquerade as truncation.
 * - `expectId` — the comment id observed after an earlier dispatch. An in-place update
 *   preserves the id; a create issues a new one. A **specific observed value** rather
 *   than a count (ADR-0016 clause 3), and better evidence than `edited`: whether GitHub
 *   bumps `updated_at` on a PATCH with a byte-identical body is not contractual,
 *   whereas id stability is.
 * - `priorIds` — the ids of comments already claimed as `own` **before** the run
 *   dispatched anything. Purely diagnostic, and it is what turns an unactionable
 *   verdict into an actionable one: the Action never deletes, so a duplicate persists
 *   after its cause is fixed, and without this the gate can only say "the regression of
 *   #107" on a pull request whose Action is healthy.
 */
export interface CrossChecks {
  expectTotal?: number;
  expectId?: number;
  priorIds?: readonly number[];
}

export interface CommentReport {
  /** Every comment the input contained, matched or not. Always reported. */
  examined: number;
  own: ClassifiedComment[];
  impostors: ClassifiedComment[];
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
  const authorType = comment.user?.type ?? UNKNOWN;
  const leads = first === CI_COMMENT_MARKER;
  const relation: Relation = leads
    ? authorType === ACTION_AUTHOR_TYPE
      ? 'own'
      : 'impostor'
    : 'quoting';

  return {
    id: typeof comment.id === 'number' ? comment.id : -1,
    relation,
    author: comment.user?.login ?? UNKNOWN,
    authorType,
    firstLine: bound(first),
    createdAt: comment.created_at ?? UNKNOWN,
    updatedAt: comment.updated_at ?? UNKNOWN,
    edited:
      typeof comment.created_at === 'string' &&
      typeof comment.updated_at === 'string' &&
      comment.created_at !== comment.updated_at,
  };
}

function describe(comment: ClassifiedComment): string {
  return `#${comment.id} by ${comment.author} (${comment.authorType})`;
}

/**
 * Pure: the verdict over a pull request's complete comment list.
 *
 * - **`incomplete`** — the list is shorter than the count GitHub reports. Retryable;
 *   reported alongside the other rules rather than instead of them, because every count
 *   below is then drawn from a partial view.
 * - **`absent`** — the caller has just run the Action, so exactly one owned comment
 *   must exist. Asserting "at most one" instead would be satisfied by an empty list,
 *   and an empty list is what a revoked permission, a wrong pull-request number, and a
 *   silently-failed Action all produce. That is the shape
 *   [ADR-0016](../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
 *   names: a check reporting an absence cannot distinguish "nothing is wrong" from
 *   "I could not look".
 * - **`duplicate`** — the #107 shape, and the regression this gate exists to catch.
 * - **`id-changed`** — the count is one, but not the same one: the Action created a
 *   replacement rather than updating in place.
 */
export function findCommentViolations(
  comments: readonly ExaminedComment[],
  checks: CrossChecks = {},
): CommentReport {
  const own: ClassifiedComment[] = [];
  const impostors: ClassifiedComment[] = [];
  const quoting: ClassifiedComment[] = [];

  for (const comment of comments) {
    const classified = classify(comment);
    if (!classified) continue;
    if (classified.relation === 'own') own.push(classified);
    else if (classified.relation === 'impostor') impostors.push(classified);
    else quoting.push(classified);
  }

  const violations: Violation[] = [];

  // Deliberately `<` and not `!==`, and `expectTotal` is documented as a lower bound.
  // The caller cannot read the count and the list atomically, so both directions of
  // concurrent edit have to be benign: a comment created mid-read makes the list
  // longer, and one deleted mid-read makes it shorter. This side tolerates the first;
  // the caller resolves the second by passing the *smallest* count it observed around
  // the read. Only a genuinely truncated list is short of every count observed.
  if (checks.expectTotal !== undefined && comments.length < checks.expectTotal) {
    violations.push({
      rule: 'incomplete',
      message:
        `GitHub reports ${checks.expectTotal} comment(s) on this pull request but the list ` +
        `held only ${comments.length}. Every count below is therefore drawn from a partial ` +
        `view. Two causes, in order of likelihood: the comments list was served by a read ` +
        `replica that has not caught up (transient — read again), or the caller omitted ` +
        `--paginate and a later page is unseen (not transient).`,
    });
  }

  if (own.length === 0) {
    const impostorNote =
      impostors.length > 0
        ? ` ${impostors.length} comment(s) lead with the marker but were not authored by a ` +
          `bot, so the Action would not claim them either: ${impostors.map(describe).join(', ')}.`
        : '';
    violations.push({
      rule: 'absent',
      message:
        `no bot-authored comment leads with ${CI_COMMENT_MARKER}, across ${comments.length} ` +
        `comment(s) examined. The Action was expected to have posted one. This is "could not ` +
        `look" and "nothing to see" rendering the same — the token may lack pull-requests: ` +
        `write, the pull-request number may be wrong, or the Action may have degraded to a ` +
        `log notice.${impostorNote}`,
    });
  } else if (own.length > 1) {
    const prior = new Set(checks.priorIds ?? []);
    const preexisting = checks.priorIds ? own.filter((comment) => prior.has(comment.id)) : [];
    // The Action never deletes, so a duplicate outlives whatever created it. Saying
    // "the regression of #107" on a pull request whose Action is healthy sends the
    // reader into packages/ci for a bug that is not there, and leaves them without the
    // one step that clears the gate.
    const provenance =
      checks.priorIds === undefined
        ? `Whether this run created the surplus comment or inherited it cannot be told from ` +
          `here — pass --expect-ids with the ids observed before the first dispatch to find out.`
        : preexisting.length === own.length
          ? `Every one of them already existed before this run dispatched anything, so this run ` +
            `created none of them: the Action is not necessarily at fault.`
          : preexisting.length > 0
            ? `${preexisting.length} of them predate this run (${preexisting.map((c) => `#${c.id}`).join(', ')}); ` +
              `the rest were created during it.`
            : `None of them predate this run, so they were created while it ran. Two causes ` +
              `produce that, and this gate cannot tell them apart: a dispatch in this run ` +
              `created rather than updated (the regression of ` +
              `https://github.com/mbeacom/adrkit/issues/107), or a second writer created one ` +
              `concurrently. Check the Action's own log: it names each write, so more than one ` +
              `\`created\` line is the regression and exactly one means something else also wrote.`;
    violations.push({
      rule: 'duplicate',
      message:
        `${own.length} bot-authored comments lead with ${CI_COMMENT_MARKER}; exactly one is ` +
        `expected: ${own.map(describe).join(', ')}. ${provenance} To clear this, delete all ` +
        `but the newest of those comments — the Action never deletes, so a duplicate persists ` +
        `after its cause is fixed, and hiding a comment as off-topic does not remove it from ` +
        `the API. Deleting needs write access to this repository.`,
    });
  } else {
    const only = own[0] as ClassifiedComment;
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

  return { examined: comments.length, own, impostors, quoting, violations };
}

/** Whether every violation is one a caller could resolve by reading again. */
export function onlyRetryable(violations: readonly Violation[]): boolean {
  return violations.length > 0 && violations.every((v) => RETRYABLE_RULES.has(v.rule));
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
      `${report.own.length} owned, ${report.impostors.length} lead with the marker but are ` +
      `not bot-authored, ${report.quoting.length} quote it`,
  ];
  for (const comment of [...report.own, ...report.impostors, ...report.quoting]) {
    lines.push(
      `  ${comment.relation.padEnd(8)} #${comment.id}  ${comment.author} (${comment.authorType})  ` +
        `created ${comment.createdAt}  updated ${comment.updatedAt}` +
        `${comment.edited ? '  [edited]' : ''}`,
    );
    lines.push(`           first line: ${comment.firstLine || '(empty)'}`);
  }
  return lines.join('\n');
}

export const USAGE = `check-ci-comment — assert a pull request carries exactly one governing-decisions comment

  bun run check:ci-comment [<comments.json>] [options]
  gh api --paginate "repos/OWNER/REPO/issues/N/comments" | bun run check:ci-comment

Reads the JSON array returned by GET /repos/{owner}/{repo}/issues/{n}/comments, from a
file argument or from stdin.

Options:
  --expect-total=N   Lower bound on the comment count GitHub reports for the issue.
                     Pass the smallest count observed around the list read.
  --expect-id=N      The comment id seen after an earlier dispatch; asserts the Action
                     updated in place rather than creating a replacement.
  --expect-ids=A,B   Ids of owned comments seen BEFORE this run dispatched anything.
                     Diagnostic only: distinguishes a duplicate this run created from
                     one the pull request already carried.
  --id-file=PATH     Write the surviving comment's id to PATH.
  --help, -h         Show this message.

Exit codes: 0 ok; 1 a definitive violation or a usage error; 2 only retryable
violations (the read looks inconsistent — read again; never treat as success).`;

export interface ParsedArgs {
  path?: string;
  checks: CrossChecks;
  idFile?: string;
  help: boolean;
}

/**
 * Pure: read the flags this gate accepts, so argument handling is testable rather than
 * improvised in bash. A malformed value throws instead of being silently dropped —
 * `--expect-total=` with an empty value would otherwise disable the completeness check
 * while looking like it was applied.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const checks: CrossChecks = {};
  let path: string | undefined;
  let idFile: string | undefined;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { path: undefined, checks: {}, help: true };

    const idOut = /^--id-file=(.*)$/.exec(arg);
    if (idOut) {
      if ((idOut[1] as string).trim() === '') throw new Error('--id-file needs a path');
      idFile = idOut[1] as string;
      continue;
    }

    const idList = /^--expect-ids=(.*)$/.exec(arg);
    if (idList) {
      const raw = (idList[1] as string).trim();
      // An empty list is meaningful and distinct from the flag being absent: it says
      // "no owned comment existed before this run", which is what proves a create.
      const ids = raw === '' ? [] : raw.split(',').map((token) => Number(token.trim()));
      if (ids.some((value) => !Number.isInteger(value))) {
        throw new Error(`--expect-ids needs a comma-separated list of integers, got "${raw}"`);
      }
      checks.priorIds = ids;
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

    if (arg.startsWith('-')) throw new Error(`unrecognised option ${arg}`);
    path = arg;
  }

  return { path, checks, idFile, help: false };
}

/** Thrown with the exit code the CLI should use, so `main` never calls `process.exit`. */
export class CheckFailure extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2,
  ) {
    super(message);
    this.name = 'CheckFailure';
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const { path, checks, idFile, help } = parseArgs(argv);
  if (help) {
    console.log(USAGE);
    return;
  }

  const payload = path ? await readFile(path, 'utf8') : await Bun.stdin.text();
  const report = findCommentViolations(parseComments(payload), checks);
  console.log(formatReport(report));

  if (report.violations.length > 0) {
    const detail = report.violations
      .map((violation) => `  [${violation.rule}] ${violation.message}`)
      .join('\n\n');
    const retryable = onlyRetryable(report.violations);
    throw new CheckFailure(
      `the governing-decisions comment is not as expected on this pull request:\n\n${detail}\n\n` +
        (retryable
          ? `Every violation above is retryable: read the comment list again.\n`
          : `The Action must post one comment per pull request and update it in place\n` +
            `(ADR-0026). If you did not change packages/ci, scripts/check-ci-comment.ts, or\n` +
            `.github/workflows/ci.yml, this is a repository-side failure rather than something\n` +
            `your branch caused — say so on the pull request rather than changing your code.\n`) +
        `Reproduce locally with:\n` +
        `  gh api --paginate "repos/<owner>/<repo>/issues/<pr>/comments" | bun run check:ci-comment`,
      retryable ? 2 : 1,
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
    process.exit(error instanceof CheckFailure ? error.exitCode : 1);
  }
}
