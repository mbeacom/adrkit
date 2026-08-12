import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  findDcoViolations,
  isBotIdentity,
  parseGitLog,
  parseSignoffs,
  type Commit,
  type Identity,
} from './check-dco.ts';
import { cleanupTestDir, resetTestDir } from '../packages/core/test/helpers.ts';

const DIR_NAME = 'check-dco';
const SCRIPT = resolve(import.meta.dir, 'check-dco.ts');

const HUMAN: Identity = { name: 'Jane Doe', email: 'jane@example.com' };
/** The identity GitHub records as committer for a squash or web-UI commit. */
const WEB_FLOW: Identity = { name: 'GitHub', email: 'noreply@github.com' };
/** Observed on `dependabot[bot]`'s commits in this repository (PR #99, 2df8d2bc). */
const DEPENDABOT: Identity = {
  name: 'dependabot[bot]',
  email: '49699333+dependabot[bot]@users.noreply.github.com',
};

function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    sha: 'a'.repeat(40),
    parents: ['b'.repeat(40)],
    author: HUMAN,
    committer: HUMAN,
    message: 'feat: a thing\n\nSigned-off-by: Jane Doe <jane@example.com>\n',
    ...overrides,
  };
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('parseSignoffs', () => {
  test('reads the name and address from a well-formed trailer', () => {
    expect(parseSignoffs('subject\n\nSigned-off-by: Jane Doe <jane@example.com>\n')).toEqual([
      { name: 'Jane Doe', email: 'jane@example.com' },
    ]);
  });

  test('reads every trailer, in the order written', () => {
    const message =
      'subject\n\nSigned-off-by: Jane Doe <jane@example.com>\nSigned-off-by: Sam Roe <sam@example.com>\n';
    expect(parseSignoffs(message)).toEqual([
      { name: 'Jane Doe', email: 'jane@example.com' },
      { name: 'Sam Roe', email: 'sam@example.com' },
    ]);
  });

  test('reads a trailer that is not in the final paragraph', () => {
    const message =
      'subject\n\nSigned-off-by: Jane Doe <jane@example.com>\nCo-authored-by: Sam Roe <sam@example.com>\n';
    expect(parseSignoffs(message)).toEqual([{ name: 'Jane Doe', email: 'jane@example.com' }]);
  });

  test('tolerates \\r\\n line endings', () => {
    expect(parseSignoffs('subject\r\n\r\nSigned-off-by: Jane Doe <jane@example.com>\r\n')).toEqual([
      { name: 'Jane Doe', email: 'jane@example.com' },
    ]);
  });

  // Negative case: a trailer is line-anchored, so a mid-line mention is prose.
  // Without the anchor this parses as a sign-off and a commit that merely
  // *discusses* the format certifies itself.
  test('does not read a mention that is not at the start of a line', () => {
    expect(parseSignoffs('subject\n\nadds Signed-off-by: Jane Doe <jane@example.com> parsing\n')).toEqual(
      [],
    );
  });

  // Negative case for the `[ \t\r]*$` terminator. Under the `m` flag a greedy
  // `\s*$` runs past the trailer's own line, so a following line is swallowed
  // into the match and the addresses stop lining up.
  test('stops the trailer at its own line when more text follows', () => {
    const message = 'subject\n\nSigned-off-by: Jane Doe <jane@example.com>\n\ntrailing prose\n';
    expect(parseSignoffs(message)).toEqual([{ name: 'Jane Doe', email: 'jane@example.com' }]);
  });

  // Negative case for `[^<>]*` over the reference implementation's greedy `(.*)`,
  // which captures `jane@example.com> <spoof@example.com` — an address that
  // equals no identity, turning a spoof attempt into an unreadable pass.
  test('does not let a second angle bracket extend the address', () => {
    expect(
      parseSignoffs('subject\n\nSigned-off-by: Jane Doe <jane@example.com> <spoof@example.com>\n'),
    ).toEqual([]);
  });

  test('finds nothing in a message with no trailer at all', () => {
    expect(parseSignoffs('feat: a thing\n\nA body with no trailer.\n')).toEqual([]);
  });
});

describe('isBotIdentity', () => {
  test('recognises the app account observed on this repository', () => {
    expect(isBotIdentity(DEPENDABOT)).toBe(true);
  });

  test('does not recognise a human', () => {
    expect(isBotIdentity(HUMAN)).toBe(false);
  });

  // Negative case: the `[bot]` suffix alone is a string anyone can type into
  // `user.name`. Requiring the numeric-id noreply address too is what stops a
  // human from renaming themselves into the identity exemption.
  test('does not recognise a name suffix without the app noreply address', () => {
    expect(isBotIdentity({ name: 'totally-a[bot]', email: 'jane@example.com' })).toBe(false);
  });

  test('does not recognise an app noreply address without the name suffix', () => {
    expect(
      isBotIdentity({ name: 'Jane Doe', email: '49699333+dependabot[bot]@users.noreply.github.com' }),
    ).toBe(false);
  });
});

describe('findDcoViolations', () => {
  test('accepts a commit signed by its author', () => {
    const report = findDcoViolations([commit()]);
    expect(report).toEqual({ examined: 1, signed: 1, exemptions: [], violations: [] });
  });

  test('accepts a sign-off matching the committer when the author differs', () => {
    const report = findDcoViolations([
      commit({
        author: { name: 'Sam Roe', email: 'sam@example.com' },
        committer: HUMAN,
      }),
    ]);
    expect(report.violations).toEqual([]);
    expect(report.signed).toBe(1);
  });

  test('compares case-insensitively', () => {
    const report = findDcoViolations([
      commit({ message: 'feat: a thing\n\nSigned-off-by: JANE DOE <JANE@EXAMPLE.COM>\n' }),
    ]);
    expect(report.signed).toBe(1);
  });

  test('accepts when one of several trailers matches', () => {
    const report = findDcoViolations([
      commit({
        message:
          'feat: a thing\n\nSigned-off-by: Sam Roe <sam@example.com>\nSigned-off-by: Jane Doe <jane@example.com>\n',
      }),
    ]);
    expect(report.signed).toBe(1);
  });

  // Negative case: the reason this check exists. Observed rejecting the shape of
  // `f74c089`, the unsigned squash commit that was on `main` when it was written.
  test('rejects a commit with no sign-off', () => {
    const report = findDcoViolations([
      commit({ sha: 'f74c089d4807d99d2d3f7d1cbb49dac40348d8d2', message: 'docs(adr): ratify\n\nA body.\n' }),
    ]);
    expect(report.signed).toBe(0);
    expect(report.violations).toEqual([
      {
        sha: 'f74c089d4807d99d2d3f7d1cbb49dac40348d8d2',
        subject: 'docs(adr): ratify',
        author: 'Jane Doe <jane@example.com>',
        detail: 'the sign-off is missing',
      },
    ]);
  });

  // Negative case: a sign-off naming somebody who did not touch the commit
  // certifies nothing, which is the failure a presence-only check cannot see.
  test('rejects a sign-off by an identity that is neither author nor committer', () => {
    const report = findDcoViolations([
      commit({ message: 'feat: a thing\n\nSigned-off-by: Sam Roe <sam@example.com>\n' }),
    ]);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.detail).toBe(
      'expected a sign-off by "Jane Doe <jane@example.com>", but got "Sam Roe <sam@example.com>"',
    );
  });
  // Negative case for pairing the halves of an identity. The DCO app takes the
  // name from either side and the address from either side, so this exact commit
  // passes there: `Jane Doe` is the author's name and `noreply@github.com` the
  // committer's address, yet nobody ever signed as that pair.
  test('rejects a name and address drawn from two different identities', () => {
    const report = findDcoViolations([
      commit({
        committer: WEB_FLOW,
        message: 'feat: a thing\n\nSigned-off-by: Jane Doe <noreply@github.com>\n',
      }),
    ]);
    expect(report.signed).toBe(0);
    expect(report.violations).toHaveLength(1);
  });

  test('exempts a merge commit, and says so', () => {
    const report = findDcoViolations([
      commit({ parents: ['b'.repeat(40), 'c'.repeat(40)], message: 'Merge pull request #22\n' }),
    ]);
    expect(report.violations).toEqual([]);
    expect(report.exemptions).toHaveLength(1);
    expect(report.exemptions[0]?.reason).toBe('merge');
  });

  test('exempts an app account from the identity match, and says so', () => {
    const report = findDcoViolations([
      commit({
        author: DEPENDABOT,
        committer: WEB_FLOW,
        message: 'build(deps): bump x\n\nSigned-off-by: dependabot[bot] <support@github.com>\n',
      }),
    ]);
    expect(report.violations).toEqual([]);
    expect(report.exemptions).toHaveLength(1);
    expect(report.exemptions[0]?.reason).toBe('bot');
    expect(report.exemptions[0]?.detail).toBe(
      'signed by the app account as dependabot[bot] <support@github.com>',
    );
  });

  // Negative case for the one place this is stricter than the DCO app, which
  // skips app-authored commits outright. Exempting the address must not silently
  // exempt presence too.
  test('rejects an app account that did not sign at all', () => {
    const report = findDcoViolations([
      commit({ author: DEPENDABOT, committer: WEB_FLOW, message: 'build(deps): bump x\n' }),
    ]);
    expect(report.exemptions).toEqual([]);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.detail).toBe('the sign-off is missing');
  });

  // Negative case: exempting only the *address* is the point. A presence-only
  // exemption accepts an unrelated person's trailer on a bot's commit and then
  // reports it as "signed by the app account" — a report asserting something it
  // never checked, which is the ADR-0016 failure the exemption exists inside.
  test('rejects an app account whose only sign-off names somebody else', () => {
    const report = findDcoViolations([
      commit({
        author: DEPENDABOT,
        committer: WEB_FLOW,
        message: 'build(deps): bump x\n\nSigned-off-by: Jane Doe <jane@example.com>\n',
      }),
    ]);
    expect(report.exemptions).toEqual([]);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.detail).toContain('dependabot[bot]');
    expect(report.violations[0]?.detail).toContain('but got "Jane Doe <jane@example.com>"');
  });

  test('exempts an app account on the trailer that names it, among several', () => {
    const report = findDcoViolations([
      commit({
        author: DEPENDABOT,
        committer: WEB_FLOW,
        message:
          'build(deps): bump x\n\nSigned-off-by: Jane Doe <jane@example.com>\nSigned-off-by: dependabot[bot] <support@github.com>\n',
      }),
    ]);
    expect(report.violations).toEqual([]);
    expect(report.exemptions[0]?.detail).toBe(
      'signed by the app account as dependabot[bot] <support@github.com>',
    );
  });

  // The classifier accepts a sign-off matching the author *or* the committer, so
  // a diagnostic naming only the author omits a valid way to fix the commit.
  test('names both identities in the diagnostic when they differ', () => {
    const report = findDcoViolations([
      commit({
        author: { name: 'Sam Roe', email: 'sam@example.com' },
        committer: WEB_FLOW,
        message: 'feat: a thing\n\nSigned-off-by: Nobody Here <nobody@example.com>\n',
      }),
    ]);
    expect(report.violations[0]?.detail).toBe(
      'expected a sign-off by "Sam Roe <sam@example.com>" or "GitHub <noreply@github.com>", ' +
        'but got "Nobody Here <nobody@example.com>"',
    );
  });

  test('names one identity when author and committer are the same', () => {
    const report = findDcoViolations([
      commit({ message: 'feat: a thing\n\nSigned-off-by: Nobody Here <nobody@example.com>\n' }),
    ]);
    expect(report.violations[0]?.detail).toBe(
      'expected a sign-off by "Jane Doe <jane@example.com>", but got "Nobody Here <nobody@example.com>"',
    );
  });

  test('reports every commit it examined, not only the failing ones', () => {
    const report = findDcoViolations([
      commit({ sha: '1'.repeat(40) }),
      commit({ sha: '2'.repeat(40), parents: ['x', 'y'] }),
      commit({ sha: '3'.repeat(40), message: 'feat: unsigned\n' }),
    ]);
    expect(report.examined).toBe(3);
    expect(report.signed).toBe(1);
    expect(report.exemptions).toHaveLength(1);
    expect(report.violations).toHaveLength(1);
  });

  test('examines nothing and reports nothing for an empty range', () => {
    expect(findDcoViolations([])).toEqual({
      examined: 0,
      signed: 0,
      exemptions: [],
      violations: [],
    });
  });
});

describe('parseGitLog', () => {
  const record = (sha: string, parents: string, message: string) =>
    [sha, parents, 'Jane Doe', 'jane@example.com', 'Jane Doe', 'jane@example.com', message].join('\0');

  test('parses a single NUL-terminated record', () => {
    const commits = parseGitLog(`${record('abc', 'def', 'subject\n')}\0`);
    expect(commits).toEqual([
      {
        sha: 'abc',
        parents: ['def'],
        author: HUMAN,
        committer: HUMAN,
        message: 'subject\n',
      },
    ]);
  });

  test('splits a merge commit into both parents', () => {
    const commits = parseGitLog(`${record('abc', 'def 012', 'merge\n')}\0`);
    expect(commits[0]?.parents).toEqual(['def', '012']);
  });

  test('gives a root commit no parents', () => {
    expect(parseGitLog(`${record('abc', '', 'first\n')}\0`)[0]?.parents).toEqual([]);
  });

  test('keeps a message containing blank lines and newlines intact', () => {
    const message = 'subject\n\nbody line one\n\nSigned-off-by: Jane Doe <jane@example.com>\n';
    expect(parseGitLog(`${record('abc', 'def', message)}\0`)[0]?.message).toBe(message);
  });

  test('returns nothing for empty output', () => {
    expect(parseGitLog('')).toEqual([]);
  });

  // Negative case: dropping a partial record would check fewer commits than the
  // range held and still report success — a count that cannot tell "looked and
  // found nothing" from "could not look" (ADR-0016).
  test('throws rather than dropping a partial trailing record', () => {
    expect(() => parseGitLog(`${record('abc', 'def', 'subject\n')}\0xyz\0`)).toThrow(
      /not a multiple of 7/,
    );
  });
});

/**
 * Run the script end to end against a real repository. The unit tests above prove
 * the kernel classifies correctly; these prove the wiring — `git log` framing,
 * exit code, and the empty-range guard — which is where a check most easily
 * becomes green by failing to look.
 */
describe('check-dco end to end', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });

  async function repoWith(commits: readonly { message: string }[]): Promise<string> {
    const root = await resetTestDir(DIR_NAME);
    git(root, 'init', '--quiet', '--initial-branch=main');
    git(root, 'config', 'user.name', HUMAN.name);
    git(root, 'config', 'user.email', HUMAN.email);
    git(root, 'commit', '--quiet', '--allow-empty', '-m', `base\n\nSigned-off-by: ${HUMAN.name} <${HUMAN.email}>`);
    git(root, 'branch', 'base');
    for (const { message } of commits) {
      git(root, 'commit', '--quiet', '--allow-empty', '-m', message);
    }
    return root;
  }

  function run(cwd: string, range: string) {
    const result = Bun.spawnSync(['bun', 'run', SCRIPT, range], { cwd });
    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  test('passes on a signed commit and names what it examined', async () => {
    const root = await repoWith([
      { message: `feat: signed\n\nSigned-off-by: ${HUMAN.name} <${HUMAN.email}>` },
    ]);
    const result = run(root, 'base..HEAD');
    expect(result.stdout).toContain('examined 1 commit(s) in base..HEAD');
    expect(result.stdout).toContain('ok — 1 signed, 0 exempt, 0 unsigned');
    expect(result.code).toBe(0);
  });

  // The permanent negative case required by ADR-0016: a real unsigned commit in a
  // real repository, observed being rejected. Watching the kernel reject a struct
  // literal proves the classifier; only this proves the script fails the build.
  test('fails on a real unsigned commit', async () => {
    const root = await repoWith([{ message: 'feat: unsigned' }]);
    const result = run(root, 'base..HEAD');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('1 of 1 commit(s) lack a valid DCO sign-off');
    expect(result.stderr).toContain('feat: unsigned');
    expect(result.stderr).toContain('the sign-off is missing');
    expect(result.stderr).toContain('git rebase --signoff base');
  });

  test('fails on the unsigned commit while accepting its signed neighbour', async () => {
    const root = await repoWith([
      { message: `feat: signed\n\nSigned-off-by: ${HUMAN.name} <${HUMAN.email}>` },
      { message: 'feat: unsigned' },
    ]);
    const result = run(root, 'base..HEAD');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('1 of 2 commit(s)');
    expect(result.stderr).toContain('feat: unsigned');
    expect(result.stderr).not.toContain('feat: signed');
  });

  // Negative case for the fail-quiet shape itself. A misspelled or unfetched base
  // ref makes `git log` return nothing, and every count in the report goes to
  // zero — indistinguishable from a clean pass unless the empty range is an error.
  test('refuses to pass an empty range instead of reporting zero commits', async () => {
    const root = await repoWith([
      { message: `feat: signed\n\nSigned-off-by: ${HUMAN.name} <${HUMAN.email}>` },
    ]);
    const result = run(root, 'HEAD..HEAD');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no commits in range HEAD..HEAD');
    expect(result.stderr).not.toContain('ok —');
  });

  test('fails rather than passing when the base ref does not exist', async () => {
    const root = await repoWith([
      { message: `feat: signed\n\nSigned-off-by: ${HUMAN.name} <${HUMAN.email}>` },
    ]);
    const result = run(root, 'origin/nonexistent..HEAD');
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain('ok —');
  });
});
