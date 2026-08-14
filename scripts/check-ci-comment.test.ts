import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { CI_COMMENT_MARKER as ACTION_MARKER } from '../packages/ci/src/comment.ts';
import {
  CheckFailure,
  CI_COMMENT_MARKER,
  classify,
  findCommentViolations,
  formatReport,
  main,
  onlyRetryable,
  parseArgs,
  parseComments,
  USAGE,
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

const human = (overrides: Partial<ExaminedComment> = {}) =>
  comment({ user: { login: 'octocat', type: 'User' }, ...overrides });

const rules = (comments: readonly ExaminedComment[], checks = {}) =>
  findCommentViolations(comments, checks).violations.map((violation) => violation.rule);

describe('marker drift', () => {
  // The gate keeps its own copy of the marker so it can import only builtins
  // (`check-dco.ts`'s reasoning). A copy nothing compares is a copy that drifts, and a
  // drifted copy makes this gate look for a string nothing posts.
  test("equals the Action's CI_COMMENT_MARKER", () => {
    expect(CI_COMMENT_MARKER).toBe(ACTION_MARKER);
  });
});

describe('classify', () => {
  test('a bot comment whose first line is the marker is our own', () => {
    expect(classify(comment())?.relation).toBe('own');
  });

  test('reads a CRLF body as our own — GitHub returns comment bodies with CRLF', () => {
    expect(classify(comment({ body: BODY.replace(/\n/g, '\r\n') }))?.relation).toBe('own');
  });

  test('reads a CR-only body as our own, matching github.ts:markerLeadsBody', () => {
    expect(classify(comment({ body: BODY.replace(/\n/g, '\r') }))?.relation).toBe('own');
  });

  // Raised by the adversarial lens on #143. `findOwnComment`'s app-installation branch
  // requires `user.type === 'Bot'` AND marker-leads-body; the gate required only the
  // second, making it STRICTER than the Action it verifies.
  test('a human comment whose first line is the marker is an impostor, not our own', () => {
    expect(classify(human())?.relation).toBe('impostor');
  });

  test('a comment with no author is an impostor, not our own', () => {
    expect(classify(comment({ user: null }))?.relation).toBe('impostor');
  });

  test('a quoted marker is quoting, whoever wrote it', () => {
    expect(classify(human({ body: `They said:\n\n> ${CI_COMMENT_MARKER}\n` }))?.relation).toBe('quoting');
    expect(classify(comment({ body: `preamble\n${CI_COMMENT_MARKER}\n` }))?.relation).toBe('quoting');
  });

  test('ignores a comment that never mentions the marker', () => {
    expect(classify(comment({ body: 'LGTM' }))).toBeUndefined();
  });

  test('treats a missing body as no body rather than throwing', () => {
    expect(classify(comment({ body: null }))).toBeUndefined();
  });

  test('reports an edit when updated_at has moved past created_at', () => {
    expect(classify(comment({ updated_at: '2026-08-11T10:00:00Z' }))?.edited).toBe(true);
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
    const report = findCommentViolations([comment(), human({ id: 2, body: `> ${CI_COMMENT_MARKER}` })]);
    expect(report.violations).toEqual([]);
    expect(report.quoting).toHaveLength(1);
  });

  // ADR-0016 permanent negative case #1 — the #107 shape.
  test('rejects a pull request carrying more than one owned comment', () => {
    const report = findCommentViolations([comment(), comment({ id: 2 }), comment({ id: 3 })]);
    expect(report.violations.map((v) => v.rule)).toEqual(['duplicate']);
    expect(report.violations[0]?.message).toContain('3 bot-authored comments');
  });

  // ADR-0016 permanent negative case #2 — the blind-pass shape.
  test('rejects a pull request carrying no owned comment', () => {
    expect(rules([comment({ body: 'LGTM' })])).toEqual(['absent']);
  });

  test('rejects an empty comment list rather than reading it as nothing to check', () => {
    expect(rules([])).toEqual(['absent']);
  });

  // ADR-0016 permanent negative case #3 — the required check must not be deniable by
  // anyone who can comment. An invisible HTML comment must not read as a duplicate.
  describe('impostors', () => {
    test('a human marker-leading comment beside ours does NOT fire duplicate', () => {
      const report = findCommentViolations([comment(), human({ id: 2, body: `${CI_COMMENT_MARKER}\nlgtm` })]);
      expect(report.violations).toEqual([]);
      expect(report.own).toHaveLength(1);
      expect(report.impostors).toHaveLength(1);
    });

    test('a human marker-leading comment alone is absent, and the diagnosis names it', () => {
      const report = findCommentViolations([human()]);
      expect(report.violations.map((v) => v.rule)).toEqual(['absent']);
      expect(report.violations[0]?.message).toContain('octocat');
      expect(report.violations[0]?.message).toContain('not authored by a bot');
    });
  });

  describe('id stability', () => {
    test('rejects a comment whose id changed since the previous dispatch', () => {
      const report = findCommentViolations([comment({ id: 77 })], { expectId: 42 });
      expect(report.violations.map((v) => v.rule)).toEqual(['id-changed']);
      expect(report.violations[0]?.message).toContain('#42');
    });

    test('accepts a comment whose id is unchanged', () => {
      expect(rules([comment({ id: 42 })], { expectId: 42 })).toEqual([]);
    });
  });

  describe('completeness', () => {
    test('rejects a list shorter than the count GitHub reports', () => {
      const report = findCommentViolations([comment()], { expectTotal: 31 });
      expect(report.violations.map((v) => v.rule)).toEqual(['incomplete']);
      expect(report.violations[0]?.message).toContain('read replica');
      expect(report.violations[0]?.message).toContain('--paginate');
    });

    test('accepts a list matching the reported count', () => {
      expect(rules([comment()], { expectTotal: 1 })).toEqual([]);
    });

    // `expectTotal` is a lower bound, not an equality, because the caller cannot read
    // the count and the list atomically. A comment created mid-read makes the list
    // longer (handled here); one deleted mid-read makes it shorter, which the caller
    // handles by passing the smallest count it observed around the list.
    test('accepts a list longer than the reported count — a comment arrived mid-read', () => {
      expect(rules([comment(), comment({ id: 2, body: 'nice' })], { expectTotal: 1 })).toEqual([]);
    });

    test('reports incompleteness alongside the other rules, not instead of them', () => {
      expect(rules([comment(), comment({ id: 2 })], { expectTotal: 9 })).toEqual(['incomplete', 'duplicate']);
    });
  });

  // The Action never deletes, so a duplicate outlives its cause. Without the prior ids
  // the gate can only blame #107 on a pull request whose Action is healthy.
  describe('duplicate provenance', () => {
    const two = [comment({ id: 1 }), comment({ id: 2 })];

    test('says the surplus predates this run when every id was already there', () => {
      const report = findCommentViolations(two, { priorIds: [1, 2] });
      expect(report.violations[0]?.message).toContain('created none of them');
      expect(report.violations[0]?.message).not.toContain('issues/107');
    });

    test('names the regression when nothing predates this run', () => {
      const report = findCommentViolations(two, { priorIds: [] });
      expect(report.violations[0]?.message).toContain('issues/107');
    });

    // Observed on the reference run: with the comment cleared beforehand, this
    // workflow and a second marker-writing workflow both listed an empty set and both
    // created, on the same second. `--expect-ids` separates "predates this run" from
    // "created during it"; it cannot separate "created by this run's dispatch" from
    // "created by a concurrent foreign writer", so the message must not assert the
    // former. It names both causes and points at the Action's own log, which does
    // distinguish them.
    test('does not assert the #107 regression as the only cause', () => {
      const message = findCommentViolations(two, { priorIds: [] }).violations[0]?.message ?? '';
      expect(message).toContain('second writer created one concurrently');
      expect(message).toContain('cannot tell them apart');
      expect(message).toContain('`created` line');
    });

    test('reports a mixed provenance precisely', () => {
      const report = findCommentViolations(two, { priorIds: [1] });
      expect(report.violations[0]?.message).toContain('1 of them predate this run (#1)');
    });

    test('says it cannot tell when no prior ids were supplied', () => {
      expect(findCommentViolations(two).violations[0]?.message).toContain('cannot be told from here');
    });

    test('always names the remediation, whatever the provenance', () => {
      for (const checks of [{}, { priorIds: [] }, { priorIds: [1, 2] }]) {
        const message = findCommentViolations(two, checks).violations[0]?.message ?? '';
        expect(message).toContain('delete all but the newest');
        expect(message).toContain('hiding a comment as off-topic does not remove it');
      }
    });
  });
});

describe('onlyRetryable', () => {
  test('an incomplete-only verdict is retryable', () => {
    expect(onlyRetryable(findCommentViolations([comment()], { expectTotal: 9 }).violations)).toBe(true);
  });

  // Retrying a duplicate would be retrying until the gate passes, which it never will:
  // the comment set is wrong, and reading it again cannot change that.
  test('a duplicate alongside an incomplete is NOT retryable', () => {
    expect(onlyRetryable(findCommentViolations([comment(), comment({ id: 2 })], { expectTotal: 9 }).violations)).toBe(false);
  });

  test('no violations is not retryable', () => {
    expect(onlyRetryable([])).toBe(false);
  });
});

describe('parseComments', () => {
  test('reads the array the GitHub API returns', () => {
    expect(parseComments('[{"id":1}]')).toEqual([{ id: 1 }]);
  });

  // `gh api` prints an error object on a failed request. Coercing that to an empty list
  // would turn a failed API call into a passing gate.
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

describe('parseArgs', () => {
  test('reads a bare path', () => {
    expect(parseArgs(['comments.json'])).toEqual({ path: 'comments.json', checks: {}, idFile: undefined, help: false });
  });

  test('reads every cross-check', () => {
    expect(parseArgs(['c.json', '--expect-total=5', '--expect-id=9', '--expect-ids=1,2', '--id-file=/tmp/id'])).toEqual({
      path: 'c.json',
      checks: { expectTotal: 5, expectId: 9, priorIds: [1, 2] },
      idFile: '/tmp/id',
      help: false,
    });
  });

  // An empty --expect-ids is meaningful and distinct from the flag being absent: it
  // says no owned comment existed before this run.
  test('reads an empty --expect-ids as an empty list, not as absent', () => {
    expect(parseArgs(['--expect-ids=']).checks.priorIds).toEqual([]);
  });

  test('refuses a non-numeric id in --expect-ids', () => {
    expect(() => parseArgs(['--expect-ids=1,two'])).toThrow(/comma-separated list of integers/);
  });

  // An empty or non-numeric value would otherwise disable the check while looking
  // exactly like it was applied.
  test('refuses an empty cross-check value rather than dropping the check', () => {
    expect(() => parseArgs(['--expect-total='])).toThrow(/non-negative integer/);
  });

  test('refuses a non-numeric cross-check value', () => {
    expect(() => parseArgs(['--expect-id=abc'])).toThrow(/non-negative integer/);
  });

  test('refuses an empty --id-file path', () => {
    expect(() => parseArgs(['--id-file='])).toThrow(/needs a path/);
  });

  test('refuses an unrecognised option rather than treating it as a path', () => {
    expect(() => parseArgs(['--pagniate'])).toThrow(/unrecognised option/);
  });

  test('recognises --help and -h', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });
});

describe('USAGE', () => {
  test('documents every flag the parser accepts', () => {
    for (const flag of ['--expect-total', '--expect-id', '--expect-ids', '--id-file', '--help']) {
      expect(USAGE).toContain(flag);
    }
  });

  test('documents the exit codes, including the retryable one', () => {
    expect(USAGE).toContain('Exit codes');
    expect(USAGE).toContain('2');
  });
});

describe('formatReport', () => {
  test('states how many comments were examined, not only the verdict', () => {
    expect(formatReport(findCommentViolations([comment(), comment({ id: 2, body: 'LGTM' })]))).toContain(
      'examined 2 comment(s)',
    );
  });

  test('names every marked comment it found, with its author and timestamps', () => {
    const rendered = formatReport(findCommentViolations([comment({ updated_at: '2026-08-11T10:00:00Z' })]));
    expect(rendered).toContain('#1');
    expect(rendered).toContain('github-actions[bot] (Bot)');
    expect(rendered).toContain('[edited]');
  });

  test('distinguishes an impostor from our own in the report', () => {
    const rendered = formatReport(findCommentViolations([comment(), human({ id: 2 })]));
    expect(rendered).toContain('own');
    expect(rendered).toContain('impostor');
  });

  test('bounds a pathological first line rather than flooding the job log', () => {
    const long = comment({ body: `${CI_COMMENT_MARKER} ${'x'.repeat(5000)}\nrest` });
    expect(formatReport(findCommentViolations([long])).length).toBeLessThan(1000);
  });
});

describe('fixtures', () => {
  const verdict = async (name: string, checks = {}) =>
    findCommentViolations(parseComments(await readFixture(name)), checks).violations.map((v) => v.rule);

  test('single.json passes — one owned comment, a quote, and unrelated noise', async () => {
    expect(await verdict('single.json')).toEqual([]);
  });

  test('duplicate.json fails — the permanent #107 negative case', async () => {
    expect(await verdict('duplicate.json')).toEqual(['duplicate']);
  });

  test('absent.json fails — a quote is not a comment', async () => {
    expect(await verdict('absent.json')).toEqual(['absent']);
  });

  test('empty.json fails — an empty list is "could not look"', async () => {
    expect(await verdict('empty.json')).toEqual(['absent']);
  });

  test('human-authored.json fails as absent — a human cannot stand in for the Action', async () => {
    expect(await verdict('human-authored.json')).toEqual(['absent']);
  });

  test('impostor.json passes — a human marker comment cannot deny the check', async () => {
    expect(await verdict('impostor.json')).toEqual([]);
  });
});

describe('main', () => {
  test('resolves on the passing fixture', async () => {
    await expect(main([fixturePath('single.json')])).resolves.toBeUndefined();
  });

  test('prints usage for --help and does not read stdin', async () => {
    await expect(main(['--help'])).resolves.toBeUndefined();
  });

  test('exits 1 on the duplicate fixture, naming the remediation', async () => {
    const error = (await main([fixturePath('duplicate.json')]).catch((e) => e)) as CheckFailure;
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('delete all but the newest');
  });

  test('exits 1 on the absent fixture, and routes a contributor to the maintainer', async () => {
    const error = (await main([fixturePath('absent.json')]).catch((e) => e)) as CheckFailure;
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('repository-side failure');
  });

  // Exit 2 is what lets the caller retry a lagging read without retrying a real
  // verdict. A caller that treated it as success would reinstate the blind pass.
  test('exits 2 when the only violation is retryable', async () => {
    const error = (await main([fixturePath('single.json'), '--expect-total=99']).catch((e) => e)) as CheckFailure;
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('retryable');
  });

  test('exits 1 when a retryable violation accompanies a definitive one', async () => {
    const error = (await main([fixturePath('duplicate.json'), '--expect-total=99']).catch((e) => e)) as CheckFailure;
    expect(error.exitCode).toBe(1);
  });
});
