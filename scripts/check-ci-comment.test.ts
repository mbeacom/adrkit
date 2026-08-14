import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { CI_COMMENT_MARKER as ACTION_MARKER } from '../packages/ci/src/comment.ts';
import {
  CI_COMMENT_MARKER,
  classify,
  findCommentViolations,
  formatReport,
  main,
  parseArgs,
  parseComments,
  type ExaminedComment,
} from './check-ci-comment.ts';

const FIXTURES = resolve(import.meta.dir, '__fixtures__', 'ci-comment');
const readFixture = (name: string) => Bun.file(resolve(FIXTURES, name)).text();
const fixturePath = (name: string) => resolve(FIXTURES, name);

const BODY = `${CI_COMMENT_MARKER}\n### Decisions governing this change\n\n- **ADR-0026** — …\n`;

function comment(overrides: Partial<ExaminedComment> = {}): ExaminedComment {
  return {
    id: 1,
    user: { login: 'github-actions[bot]', type: 'Bot' },
    created_at: '2026-08-11T09:00:00Z',
    updated_at: '2026-08-11T09:00:00Z',
    body: BODY,
    ...overrides,
  };
}

describe('marker drift', () => {
  // The gate keeps its own copy of the marker so it can import only builtins
  // (`check-dco.ts`'s reasoning). A copy nothing compares is a copy that drifts, and a
  // drifted copy makes this gate look for a string nothing posts — which reports
  // `absent` on a perfectly healthy pull request, or worse, is "fixed" by relaxing the
  // rule. This is the comparison.
  test("equals the Action's CI_COMMENT_MARKER", () => {
    expect(CI_COMMENT_MARKER).toBe(ACTION_MARKER);
  });
});

describe('classify', () => {
  test('reads a body whose first line is the marker as our own', () => {
    expect(classify(comment())?.relation).toBe('own');
  });

  test('reads a CRLF body as our own — GitHub returns comment bodies with CRLF', () => {
    const crlf = comment({ body: BODY.replace(/\n/g, '\r\n') });
    expect(classify(crlf)?.relation).toBe('own');
  });

  test('reads a CR-only body as our own, matching github.ts:markerLeadsBody', () => {
    const cr = comment({ body: BODY.replace(/\n/g, '\r') });
    expect(classify(cr)?.relation).toBe('own');
  });

  test('reads a quoted marker as quoting, not as our own', () => {
    const quoted = comment({ body: `They said:\n\n> ${CI_COMMENT_MARKER}\n> heading\n` });
    expect(classify(quoted)?.relation).toBe('quoting');
  });

  test('ignores a comment that never mentions the marker', () => {
    expect(classify(comment({ body: 'LGTM' }))).toBeUndefined();
  });

  test('treats a missing body as no body rather than throwing', () => {
    expect(classify(comment({ body: null }))).toBeUndefined();
  });

  test('reports an edit when updated_at has moved past created_at', () => {
    const edited = comment({ updated_at: '2026-08-11T10:00:00Z' });
    expect(classify(edited)?.edited).toBe(true);
    expect(classify(comment())?.edited).toBe(false);
  });
});

describe('findCommentViolations', () => {
  test('accepts exactly one bot-authored comment leading with the marker', () => {
    const report = findCommentViolations([comment(), comment({ id: 2, body: 'LGTM' })]);
    expect(report.violations).toEqual([]);
    expect(report.own).toHaveLength(1);
    expect(report.examined).toBe(2);
  });

  test('does not count a human quoting the comment against the total', () => {
    const quoted = comment({ id: 2, user: { login: 'octocat', type: 'User' }, body: `> ${CI_COMMENT_MARKER}` });
    const report = findCommentViolations([comment(), quoted]);
    expect(report.violations).toEqual([]);
    expect(report.own).toHaveLength(1);
    expect(report.quoting).toHaveLength(1);
  });

  // ADR-0016 permanent negative case #1 — the #107 shape. A pull request that
  // accumulated one comment per push. The gate MUST reject it; every unit and contract
  // test in packages/ci was green while this was live in two releases.
  test('rejects a pull request carrying more than one marked comment', () => {
    const report = findCommentViolations([comment(), comment({ id: 2 }), comment({ id: 3 })]);
    expect(report.violations.map((violation) => violation.rule)).toEqual(['duplicate']);
    expect(report.violations[0]?.message).toContain('3 comments');
  });

  // ADR-0016 permanent negative case #2 — the blind-pass shape. `at most one` would
  // accept this, and so would any assertion phrased as an absence. A revoked
  // permission, a wrong pull-request number, and a silently-degraded Action all land
  // here, and all three render identically to a clean run.
  test('rejects a pull request carrying no marked comment', () => {
    const report = findCommentViolations([comment({ body: 'LGTM' })]);
    expect(report.violations.map((violation) => violation.rule)).toEqual(['absent']);
  });

  test('rejects an empty comment list rather than reading it as nothing to check', () => {
    expect(findCommentViolations([]).violations.map((violation) => violation.rule)).toEqual(['absent']);
  });

  // ADR-0016 permanent negative case #3 — a count that is right for the wrong reason.
  // Asserting a specific observed value (the author is a Bot) rather than only the
  // count is clause 3 of that record.
  test('rejects a lone marked comment that a human authored', () => {
    const report = findCommentViolations([comment({ user: { login: 'octocat', type: 'User' } })]);
    expect(report.violations.map((violation) => violation.rule)).toEqual(['not-a-bot']);
    expect(report.violations[0]?.message).toContain('octocat');
  });

  test('rejects a lone marked comment whose author GitHub did not return', () => {
    expect(
      findCommentViolations([comment({ user: null })]).violations.map((violation) => violation.rule),
    ).toEqual(['not-a-bot']);
  });
});

describe('parseComments', () => {
  test('reads the array the GitHub API returns', () => {
    expect(parseComments('[{"id":1}]')).toEqual([{ id: 1 }]);
  });

  // `gh api` prints an error *object* on a failed request. Coercing that to an empty
  // list would turn a failed API call into a passing gate — the exact substitution
  // ADR-0016 exists to prevent, one layer earlier than the `absent` rule.
  test('refuses an error object, rather than reading it as zero comments', () => {
    expect(() => parseComments('{"message":"Not Found","status":"404"}')).toThrow(/not a JSON array/);
  });

  test('refuses an empty payload', () => {
    expect(() => parseComments('   ')).toThrow(/empty/);
  });

  test('refuses a payload that is not JSON at all', () => {
    expect(() => parseComments('gh: command not found')).toThrow(/not JSON/);
  });
});

describe('formatReport', () => {
  test('states how many comments were examined, not only the verdict', () => {
    const report = findCommentViolations([comment(), comment({ id: 2, body: 'LGTM' })]);
    expect(formatReport(report)).toContain('examined 2 comment(s)');
  });

  test('names every marked comment it found, with its author and timestamps', () => {
    const report = findCommentViolations([comment({ updated_at: '2026-08-11T10:00:00Z' })]);
    const rendered = formatReport(report);
    expect(rendered).toContain('#1');
    expect(rendered).toContain('github-actions[bot] (Bot)');
    expect(rendered).toContain('[edited]');
  });

  test('bounds a pathological first line rather than flooding the job log', () => {
    const long = comment({ body: `${CI_COMMENT_MARKER} ${'x'.repeat(5000)}\nrest` });
    expect(formatReport(findCommentViolations([long])).length).toBeLessThan(1000);
  });
});

describe('fixtures', () => {
  test('single.json passes — one marked comment, a quote, and unrelated noise', async () => {
    const report = findCommentViolations(parseComments(await readFixture('single.json')));
    expect(report.violations).toEqual([]);
    expect(report.own).toHaveLength(1);
    expect(report.quoting).toHaveLength(1);
    expect(report.examined).toBe(4);
  });

  test('duplicate.json fails — the permanent #107 negative case', async () => {
    const report = findCommentViolations(parseComments(await readFixture('duplicate.json')));
    expect(report.violations.map((violation) => violation.rule)).toEqual(['duplicate']);
  });

  test('absent.json fails — a quote is not a comment', async () => {
    const report = findCommentViolations(parseComments(await readFixture('absent.json')));
    expect(report.violations.map((violation) => violation.rule)).toEqual(['absent']);
  });

  test('empty.json fails — an empty list is "could not look"', async () => {
    const report = findCommentViolations(parseComments(await readFixture('empty.json')));
    expect(report.violations.map((violation) => violation.rule)).toEqual(['absent']);
  });

  test('human-authored.json fails — the count is right, the author is not', async () => {
    const report = findCommentViolations(parseComments(await readFixture('human-authored.json')));
    expect(report.violations.map((violation) => violation.rule)).toEqual(['not-a-bot']);
  });
});

describe('cross-checks', () => {
  // Raised in review of #143: `gh api --paginate` was thought to emit one JSON document
  // per page. It does not — it merges a top-level array into one document (verified
  // against gh 2.96.0 over 12 pages of 1). But the adjacent gap is real: a caller who
  // drops --paginate gets page 1 only, and a duplicate sitting on page 2 then reads
  // exactly like a healthy single comment. That is a blind pass, so it is asserted.
  test('rejects a list shorter than the count GitHub reports for the issue', () => {
    const report = findCommentViolations([comment()], { expectTotal: 31 });
    expect(report.violations.map((violation) => violation.rule)).toEqual(['incomplete']);
    expect(report.violations[0]?.message).toContain('--paginate');
  });

  test('accepts a list matching the reported count', () => {
    expect(findCommentViolations([comment()], { expectTotal: 1 }).violations).toEqual([]);
  });

  // The caller reads the total before the list, so a comment arriving between the two
  // makes the list longer. Failing there would turn a human commenting mid-job into a
  // red run on a healthy Action.
  test('accepts a list longer than the reported count — a comment arrived mid-run', () => {
    const report = findCommentViolations([comment(), comment({ id: 2, body: 'nice' })], { expectTotal: 1 });
    expect(report.violations).toEqual([]);
  });

  test('reports incompleteness alongside the other rules, not instead of them', () => {
    const report = findCommentViolations([comment(), comment({ id: 2 })], { expectTotal: 9 });
    expect(report.violations.map((violation) => violation.rule)).toEqual(['incomplete', 'duplicate']);
  });

  // The reviewer's improvement on the un-asserted `edited` field: an in-place update
  // preserves the comment id, a create issues a new one, and unlike `updated_at` on a
  // byte-identical PATCH that is contractual.
  test('rejects a comment whose id changed since the previous dispatch', () => {
    const report = findCommentViolations([comment({ id: 77 })], { expectId: 42 });
    expect(report.violations.map((violation) => violation.rule)).toEqual(['id-changed']);
    expect(report.violations[0]?.message).toContain('#42');
  });

  test('accepts a comment whose id is unchanged', () => {
    expect(findCommentViolations([comment({ id: 42 })], { expectId: 42 }).violations).toEqual([]);
  });

  test('applies no cross-checks when none are supplied', () => {
    expect(findCommentViolations([comment()]).violations).toEqual([]);
  });
});

describe('parseArgs', () => {
  test('reads a bare path', () => {
    expect(parseArgs(['comments.json'])).toEqual({ path: 'comments.json', checks: {}, idFile: undefined });
  });

  test('reads both cross-checks and --id-file', () => {
    expect(parseArgs(['c.json', '--expect-total=5', '--expect-id=9', '--id-file=/tmp/id'])).toEqual({
      path: 'c.json',
      checks: { expectTotal: 5, expectId: 9 },
      idFile: '/tmp/id',
    });
  });

  test('refuses an empty --id-file path', () => {
    expect(() => parseArgs(['--id-file='])).toThrow(/needs a path/);
  });

  // An empty or non-numeric value would otherwise disable the check while looking
  // exactly like it was applied — the failure this whole gate exists to prevent.
  test('refuses an empty cross-check value rather than dropping the check', () => {
    expect(() => parseArgs(['--expect-total='])).toThrow(/non-negative integer/);
  });

  test('refuses a non-numeric cross-check value', () => {
    expect(() => parseArgs(['--expect-id=abc'])).toThrow(/non-negative integer/);
  });

  test('refuses an unrecognised option rather than treating it as a path', () => {
    expect(() => parseArgs(['--pagniate'])).toThrow(/unrecognised option/);
  });
});

describe('main', () => {
  test('resolves on the passing fixture', async () => {
    await expect(main([fixturePath('single.json')])).resolves.toBeUndefined();
  });

  test('throws on the duplicate fixture, naming the issue it regresses', async () => {
    await expect(main([fixturePath('duplicate.json')])).rejects.toThrow(/issues\/107/);
  });

  test('throws on the absent fixture', async () => {
    await expect(main([fixturePath('absent.json')])).rejects.toThrow(/not unique/);
  });
});
