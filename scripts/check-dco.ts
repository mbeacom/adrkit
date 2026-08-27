/**
 * Fail when a commit in a pull request carries no valid DCO sign-off.
 *
 * [ADR-0006](../docs/adr/0006-license-apache-2-and-single-monorepo.md) chose a
 * DCO over a CLA because it "forecloses a rug-pull" while keeping contribution
 * friction low. That trade only pays if sign-off is actually present, and until
 * this check existed it was documented in `CONTRIBUTING.md` and enforced by
 * nothing — an unsigned commit would have merged.
 *
 * Implemented as a repository script rather than by installing the
 * [DCO app](https://github.com/apps/dco), so the check stays inside the surface
 * ADR-0007 keeps mechanical and self-contained. The accept/reject semantics
 * deliberately track that app's, because they are the contract contributors
 * already know, with two differences noted at {@link findDcoViolations}.
 *
 *   bun run scripts/check-dco.ts [range]
 *
 * `range` is any two-dot git revision range and defaults to
 * `origin/main..HEAD`. CI passes the pull request's own range explicitly.
 *
 * **Where this runs, and why it matters (#137, ADR-0035).** There are two
 * invocations of this script, and only one of them is the gate.
 *
 * The authority is the `trusted-dco` job in `.github/workflows/trusted-gates.yml`.
 * It is triggered by `pull_request_target`, which GitHub executes from the
 * repository's **default branch** — workflow file, referenced actions, and
 * `actions/checkout` commit alike — so neither this script nor the step invoking
 * it is under the pull request's control. It reads the pull request's commits as
 * fetched objects and never checks them out.
 *
 * The `dco` job in `ci.yml` is the same check run from the pull request's own
 * checkout. It is faster and reports first, and it can be neutered by the pull
 * request it judges — so it is advisory, and can only ever fail open. Keeping it
 * costs nothing because the trusted job must also pass; removing the trusted job
 * is what would matter, and that is a change under `.github/workflows/`, which
 * `gate-integrity` blocks without an explicit maintainer acknowledgment.
 *
 * What remains open is stated plainly rather than papered over: whoever can merge
 * can change a gate and acknowledge the change. Merge access is the boundary it
 * always was. What is closed is the narrower property that made #137 worth
 * filing — that the check certifying a pull request could be authored by that
 * same pull request.
 */

import { execFileSync } from 'node:child_process';

export interface Identity {
  name: string;
  email: string;
}

export interface Commit {
  sha: string;
  /** Empty for a root commit; more than one marks a merge. */
  parents: readonly string[];
  author: Identity;
  committer: Identity;
  /** Raw message, subject and body, exactly as `git log %B` renders it. */
  message: string;
}

export interface Signoff {
  name: string;
  email: string;
}

/** Why a commit was not required to match an identity. Always reported. */
export type ExemptionReason = 'merge' | 'bot';

export interface Exemption {
  sha: string;
  subject: string;
  author: string;
  reason: ExemptionReason;
  detail: string;
}

export interface Violation {
  sha: string;
  subject: string;
  author: string;
  detail: string;
}

export interface DcoReport {
  /** Every commit the range produced, exempt or not. */
  examined: number;
  /** Commits that carried a sign-off matching a required identity. */
  signed: number;
  exemptions: Exemption[];
  violations: Violation[];
}

/**
 * Source for the sign-off matcher. A fresh `RegExp` is built per scan rather
 * than sharing one module-level instance: `matchAll` seeds its matcher from the
 * source regex's `lastIndex`, so a shared global regex any caller had poked with
 * `.exec()` would start mid-message and skip trailers.
 *
 * Anchored to the start of a physical line, because a sign-off is a trailer and
 * a mid-line mention is prose.
 *
 * Every class excludes `\r` and `\n`, so no match can span a line boundary. This
 * is load-bearing rather than tidy. `[^<>]` alone also matches a newline, so a
 * line reading exactly `Signed-off-by:` — no address on it — let the lazy name
 * group run *down the message* to the next `<`, swallowing the real trailer
 * beneath it into one match whose name is `Signed-off-by: Jane Doe`. That
 * removed the only valid candidate and failed a correctly signed commit, which
 * is the merge-blocking direction. Confining to one line also caps the
 * quantifiers' backtracking at a single line's length.
 *
 * Both halves further exclude `<` and `>`, which git's own ident parser forbids.
 * The reference implementation captures the name greedily as `(.*)`, so on
 * `Signed-off-by: Jane Doe <jane@example.com> <spoof@example.com>` it backtracks
 * the first pair into the *name* and reads the address as `spoof@example.com`.
 * Excluding the brackets from the name leaves the line with no parse at all,
 * which is the honest reading of a trailer naming two addresses.
 */
const SIGNOFF_SOURCE = String.raw`^Signed-off-by:[ \t]*([^<>\r\n]+?)[ \t]*<([^<>\r\n]*)>[ \t\r]*$`;

/** A fresh matcher. Never share one — see {@link SIGNOFF_SOURCE}. */
export function signoffPattern(): RegExp {
  return new RegExp(SIGNOFF_SOURCE, 'gim');
}

/**
 * Pure: every `Signed-off-by` trailer in `message`, in the order written.
 *
 * Deliberately accepts a trailer anywhere in the message rather than only in the
 * final paragraph. A stricter reading would reject a sign-off separated from the
 * end by a `Co-authored-by` block or a revert footer, and a false rejection here
 * blocks a merge — a far worse failure than tolerating a sign-off quoted in
 * prose, which can only ever add a candidate and never remove a valid one.
 */
export function parseSignoffs(message: string): Signoff[] {
  const found: Signoff[] = [];
  for (const match of message.matchAll(signoffPattern())) {
    found.push({ name: (match[1] as string).trim(), email: (match[2] as string).trim() });
  }
  return found;
}

/** Case-insensitive, whitespace-tolerant equality on the name half of an identity. */
function sameName(signoff: Signoff, identity: Identity): boolean {
  return signoff.name.trim().toLowerCase() === identity.name.trim().toLowerCase();
}

/** Case-insensitive, whitespace-tolerant equality on both halves of an identity. */
function matchesIdentity(signoff: Signoff, identity: Identity): boolean {
  return (
    sameName(signoff, identity) &&
    signoff.email.trim().toLowerCase() === identity.email.trim().toLowerCase()
  );
}

/** A GitHub App account: `<login>[bot]` with the noreply address GitHub issues it. */
const BOT_NAME = /\[bot\]$/;
const BOT_EMAIL = /^\d+\+[^@\s]*\[bot\]@users\.noreply\.github\.com$/i;

/**
 * Pure: whether `identity` is a GitHub App account.
 *
 * Both halves are required. The name suffix alone is a string anyone can type
 * into `user.name`; pairing it with the numeric-id noreply address GitHub issues
 * to app accounts is what makes the claim cost something. Neither is verified by
 * git, which is why every commit this exempts is named in the output rather than
 * skipped quietly — a human who exempts themselves appears in the CI log.
 */
export function isBotIdentity(identity: Identity): boolean {
  return BOT_NAME.test(identity.name.trim()) && BOT_EMAIL.test(identity.email.trim());
}

function subjectOf(message: string): string {
  return (message.split('\n', 1)[0] ?? '').trim();
}

function render(identity: Identity): string {
  return `${identity.name} <${identity.email}>`;
}

/**
 * Pure: classify every commit in `commits` as signed, exempt, or in violation.
 *
 * A commit needs a `Signed-off-by` trailer whose name **and address together**
 * equal the author's or the committer's. Two rules differ from the DCO app:
 *
 * - **The pair must come from one identity.** The app accepts a name from the
 *   author and an address from the committer, so a web-UI commit signed
 *   `Jane Doe <noreply@github.com>` passes there. Pairing can only reject a
 *   sign-off that names nobody who touched the commit, so it rejects nothing a
 *   well-formed trailer produces.
 * - **A bot still has to sign.** The app skips app-authored commits outright.
 *   They are exempted here from the *address* half of the match only, because a
 *   bot signs from a service address — Dependabot's author is
 *   `dependabot[bot] <…+dependabot[bot]@users.noreply.github.com>` while it signs
 *   `dependabot[bot] <support@github.com>`, so the two cannot be equal by
 *   construction. The trailer must still *name* the bot, or the exemption would
 *   accept an unrelated person's signature on a bot's commit and report it as
 *   the app account's.
 *
 * Merge commits are exempt: the commits they merge carry the certification, and
 * the person who ran `git merge` authored none of it. That reasoning covers the
 * ordinary merge and not an evil merge, whose recorded tree can hold conflict
 * resolution present in neither parent. The DCO app skips merges outright too,
 * so this matches the contract contributors expect rather than closing that gap.
 */
export function findDcoViolations(commits: readonly Commit[]): DcoReport {
  const exemptions: Exemption[] = [];
  const violations: Violation[] = [];
  let signed = 0;

  for (const commit of commits) {
    const sha = commit.sha;
    const subject = subjectOf(commit.message);
    const author = render(commit.author);

    if (commit.parents.length > 1) {
      exemptions.push({ sha, subject, author, reason: 'merge', detail: 'merge commit' });
      continue;
    }

    const signoffs = parseSignoffs(commit.message);
    if (signoffs.length === 0) {
      violations.push({
        sha,
        subject,
        author,
        detail: 'the sign-off is missing',
      });
      continue;
    }

    // An app account signs from a service address — Dependabot authors as
    // `dependabot[bot] <…+dependabot[bot]@users.noreply.github.com>` and signs as
    // `dependabot[bot] <support@github.com>` — so the address cannot match by
    // construction. The *name* still can, and requiring it is what stops the
    // exemption from accepting an unrelated person's trailer on a bot's commit
    // and then reporting it as "signed by the app account".
    if (isBotIdentity(commit.author)) {
      const byBot = signoffs.find((signoff) => sameName(signoff, commit.author));
      if (byBot) {
        exemptions.push({
          sha,
          subject,
          author,
          reason: 'bot',
          detail: `signed by the app account as ${render(byBot)}`,
        });
        continue;
      }
      // Nothing here names the bot. Fall through to the identity match so this
      // fails with the precise mismatch below, rather than being waved through
      // on a signature that certifies somebody else's work.
    }

    const matched = signoffs.some(
      (signoff) => matchesIdentity(signoff, commit.author) || matchesIdentity(signoff, commit.committer),
    );

    if (matched) {
      signed += 1;
      continue;
    }

    // Name both identities when they differ. The classifier accepts either, so a
    // message naming only the author omits a valid way to fix the commit.
    const committer = render(commit.committer);
    const expected =
      author.toLowerCase() === committer.toLowerCase() ? `"${author}"` : `"${author}" or "${committer}"`;
    const got = signoffs.map((signoff) => `"${render(signoff)}"`).join(', ');
    violations.push({
      sha,
      subject,
      author,
      detail: `expected a sign-off by ${expected}, but got ${got}`,
    });
  }

  return { examined: commits.length, signed, exemptions, violations };
}

/** Field order in {@link GIT_FORMAT}. Changing one without the other misparses. */
const GIT_FIELDS = 7;

/**
 * NUL between every field and, with `-z`, between every record. A commit object
 * cannot contain a NUL byte, so the framing is unambiguous for any message —
 * unlike a printable delimiter, which a commit body may legitimately contain.
 */
const GIT_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%B';

/**
 * Pure: parse the NUL-framed output of `git log -z --format=`{@link GIT_FORMAT}.
 *
 * A token count that is not a whole number of records throws rather than
 * dropping the remainder, because a partially-parsed range silently checks
 * fewer commits than the range contained.
 */
export function parseGitLog(stdout: string): Commit[] {
  const tokens = stdout.split('\0');
  // `-z` terminates the final record too, leaving one empty trailing token.
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop();
  if (tokens.length === 0) return [];

  if (tokens.length % GIT_FIELDS !== 0) {
    throw new Error(
      `git log produced ${tokens.length} fields, which is not a multiple of ${GIT_FIELDS}; ` +
        `refusing to check a partially-parsed range`,
    );
  }

  const commits: Commit[] = [];
  for (let i = 0; i < tokens.length; i += GIT_FIELDS) {
    commits.push({
      sha: (tokens[i] as string).trim(),
      parents: (tokens[i + 1] as string).trim().split(/\s+/).filter(Boolean),
      author: { name: tokens[i + 2] as string, email: tokens[i + 3] as string },
      committer: { name: tokens[i + 4] as string, email: tokens[i + 5] as string },
      message: tokens[i + 6] as string,
    });
  }
  return commits;
}

export function readCommits(range: string, cwd?: string): Commit[] {
  let stdout: string;
  try {
    stdout = execFileSync('git', ['log', '-z', `--format=${GIT_FORMAT}`, range], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // Say that the range could not be *read*, not that commits were unsigned.
    // git's own text here is `fatal: bad revision`, which reads like a defect in
    // the pull request rather than in the checkout. The usual cause is a base
    // commit that was never fetched — for a conflicting pull request GitHub may
    // have no current merge ref, so the object the range names is simply absent.
    const detail = error instanceof Error ? error.message.trim() : String(error);
    throw new Error(
      `could not read the commit range ${range}, so no commit was examined.\n` +
        `This is a checkout problem, not a sign-off problem — the base or head commit is\n` +
        `probably missing from this clone (fetch it, or resolve the pull request's conflicts).\n` +
        `git said: ${detail}`,
    );
  }
  return parseGitLog(stdout);
}

export function formatReport(range: string, report: DcoReport): string {
  const lines = [`check-dco: examined ${report.examined} commit(s) in ${range}`];
  for (const exemption of report.exemptions) {
    lines.push(`  exempt  ${exemption.sha.slice(0, 8)}  ${exemption.subject}  — ${exemption.detail}`);
  }
  return lines.join('\n');
}

function main(argv: readonly string[]): void {
  const range = argv[0] ?? process.env.DCO_RANGE ?? 'origin/main..HEAD';
  const base = range.split('..')[0] || 'origin/main';
  const commits = readCommits(range);

  // A pull request always contains at least one commit, so an empty range means
  // the base ref was never fetched or the range was misspelled — not that every
  // commit passed. Reporting "0 commits, ok" here is the exact fail-quiet shape
  // ADR-0016 exists to prevent, and it would render identically to a clean run.
  if (commits.length === 0) {
    throw new Error(
      `no commits in range ${range}; the base ref is probably unfetched or misspelled. ` +
        `Refusing to report a pass over an empty range.`,
    );
  }

  const report = findDcoViolations(commits);
  console.log(formatReport(range, report));

  if (report.violations.length > 0) {
    const detail = report.violations
      .map(
        (violation) =>
          `  ${violation.sha.slice(0, 8)} ${violation.subject}\n` +
          `    author:  ${violation.author}\n` +
          `    problem: ${violation.detail}`,
      )
      .join('\n\n');
    throw new Error(
      `${report.violations.length} of ${report.examined} commit(s) lack a valid DCO sign-off:\n\n${detail}\n\n` +
        `Every commit needs "Signed-off-by: Your Name <your@email>" naming its author or its\n` +
        `committer. Sign-off is your statement that you have the right to submit this work\n` +
        `under the project's license — see https://developercertificate.org/.\n\n` +
        `Sign the whole branch and force-push:\n` +
        `  git rebase --signoff ${base}\n` +
        `  git push --force-with-lease\n\n` +
        `Use --force-with-lease, not --force: it refuses rather than discarding a commit\n` +
        `someone else pushed. If git cannot find ${base}, run "git fetch origin" first.\n` +
        `See CONTRIBUTING.md.`,
    );
  }

  console.log(
    `check-dco: ok — ${report.signed} signed, ${report.exemptions.length} exempt, 0 unsigned`,
  );
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-dco: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
