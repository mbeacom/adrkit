import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkChanges, lintCorpus, readSourceMarkersBatch } from '@adrkit/core';
import { acceptedRecordMarkdown, cleanupTestDir, recordMarkdown, resetTestDir, supersededRecordMarkdown, writeText } from '../../core/test/helpers.ts';
import { CI_COMMENT_MARKER, renderComment } from '../src/comment.ts';

const DIR_NAME = 'ci-comment-render';

function withAffects(markdown: string, matcherLines: string[]): string {
  return markdown.replace('affects: []', ['affects:', ...matcherLines].join('\n'));
}

const path = (pattern: string): string[] => [`  - type: path`, `    pattern: "${pattern}"`];
const entity = (pattern: string): string[] => [`  - type: entity`, `    pattern: "${pattern}"`];

async function seed(): Promise<string> {
  const root = await resetTestDir(DIR_NAME);
  const dir = join(root, 'docs/adr');
  await writeText(
    join(dir, '0001-api.md'),
    withAffects(acceptedRecordMarkdown('0001', 'Guard the API package'), [...path('packages/api/**'), ...entity('component:default/api')]),
  );
  await writeText(join(dir, '0002-web.md'), withAffects(acceptedRecordMarkdown('0002', 'Guard the web package'), path('packages/web/**')));
  return root;
}

async function outcomeFor(root: string, changedFiles: string[]) {
  const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });
  return checkChanges({ lint, changedFiles, dir: 'docs/adr' });
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
});

describe('renderComment', () => {
  test('renders the governing entry shape and carries the marker', async () => {
    const root = await seed();
    const outcome = await outcomeFor(root, ['packages/api/src/server.ts']);
    const body = renderComment(outcome);

    expect(body.startsWith(CI_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('**0001** — Guard the API package');
    expect(body).toContain('via `path`: `packages/api/**`');
    // Selective: the unrelated web record is not listed.
    expect(body).not.toContain('0002');
  });

  test('lists the union of multiple governing records', async () => {
    const root = await seed();
    const outcome = await outcomeFor(root, ['packages/api/src/a.ts', 'packages/web/src/b.ts']);
    const body = renderComment(outcome);

    expect(body).toContain('**0001** — Guard the API package');
    expect(body).toContain('**0002** — Guard the web package');
  });

  test('inert matchers are absent from the governing list but present as info findings (FR-009)', async () => {
    const root = await seed();
    const outcome = await outcomeFor(root, ['packages/api/src/server.ts']);
    const body = renderComment(outcome);

    // The entity matcher fired nothing, so it is not in the governing list...
    expect(body).not.toContain('component:default/api');
    expect(body).not.toContain('entity');
    // ...but the resolver surfaced it as an info finding in the outcome.
    const inert = outcome.findings.find((finding) => finding.rule === 'affects-unresolvable' && finding.pattern === 'component:default/api');
    expect(inert?.severity).toBe('info');
  });

  test('renders a concise empty state when nothing governs the change', async () => {
    const root = await seed();
    const outcome = await outcomeFor(root, ['README.md']);
    const body = renderComment(outcome);

    expect(body).toContain('No governing decisions for the changed files.');
    expect(body).not.toContain('**0001**');
    expect(body).not.toContain('**0002**');
  });

  test('keeps marker reference warnings out of the focused PR comment', async () => {
    const root = await seed();
    const outcome = await outcomeFor(root, ['docs/adr/0001-api.md']);
    outcome.findings.push({
      rule: 'dangling-marker',
      severity: 'warn',
      message: 'Source marker does not resolve',
      path: 'docs/adr/0001-api.md',
      field: 'marker',
      pattern: '9999',
    });

    const body = renderComment(outcome);

    expect(body).not.toContain('dangling-marker');
    expect(body).not.toContain('Source marker does not resolve');
  });
});

/**
 * adrkit#39 — a reviewer must never be told that a rejected, superseded, or deprecated
 * decision governs their change.
 */
describe('renderComment status awareness (#39)', () => {
  async function seedMixed(): Promise<string> {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(
      join(dir, '0001-accepted.md'),
      withAffects(acceptedRecordMarkdown('0001', 'Accepted record'), path('src/api/**')),
    );
    await writeText(join(dir, '0002-draft.md'), withAffects(recordMarkdown('0002', 'Draft record'), path('src/api/**')));
    await writeText(
      join(dir, '0003-superseded.md'),
      withAffects(supersededRecordMarkdown('0003', '0001', 'Superseded record'), path('src/api/**')),
    );
    return root;
  }

  test('only accepted records appear under the governing heading', async () => {
    const root = await seedMixed();
    const body = renderComment(await outcomeFor(root, ['src/api/thing.ts']));

    const governingSection = body.slice(
      body.indexOf('### Decisions governing this change'),
      body.indexOf('#### Active proposals'),
    );
    expect(governingSection).toContain('**0001** — Accepted record');
    expect(governingSection).not.toContain('0002');
    expect(governingSection).not.toContain('0003');
  });

  test('proposals and history are labelled with their status under their own headings', async () => {
    const root = await seedMixed();
    const body = renderComment(await outcomeFor(root, ['src/api/thing.ts']));

    expect(body).toContain('#### Active proposals touching this change');
    expect(body).toContain('**0002** — Draft record _(draft)_');
    expect(body).toContain('#### Historical records that once covered this change');
    expect(body).toContain('**0003** — Superseded record _(superseded)_ — superseded by **0001**');
  });

  /**
   * A declaration is authored by the pull request, and GitHub rejects a body over
   * 65,536 characters with a 422 — which is not a permission error and would fail the
   * job. ADR-0021 promises marker content can never do that, so the rendering is what
   * has to hold the promise.
   */
  describe('pull-request-authored content cannot grow the body without bound', () => {
    test('caps the declarations rendered for one decision and says how many were held back', async () => {
      const root = await seed();
      const outcome = await outcomeFor(root, ['packages/api/src/server.ts']);
      const decision = outcome.governing[0];
      if (!decision) throw new Error('expected a governing decision to annotate');
      decision.declaredBy = Array.from({ length: 12 }, (_, index) => ({
        path: 'packages/api/src/server.ts',
        line: index + 1,
        ref: '0001',
      }));

      const body = renderComment(outcome);

      expect(body.match(/ {2}- declared by /g)).toHaveLength(10);
      expect(body).toContain('  - …and 2 more declarations');
    });

    test('an 8 KB header window full of markers does not exceed the comment size limit', async () => {
      const root = await seed();
      // The path length is the author's too, and it multiplies by the declaration
      // count. A short one renders ~39 KB and would pass this assertion unfixed.
      const file = 'packages/api/src/a/very/long/directory/an/author/controls/entirely/payload.ts';
      let source = '';
      while (Buffer.byteLength(source) < 8192) source += '// @adr 0001\n';
      await writeText(join(root, file), source);

      const lint = await lintCorpus({ cwd: root, dir: 'docs/adr' });
      const markerScans = await readSourceMarkersBatch([file], root);
      const outcome = checkChanges({ lint, changedFiles: [file], dir: 'docs/adr', markerScans });

      // The scan really did find the pathological input; only the rendering is bounded.
      expect(outcome.governing[0]?.declaredBy?.length).toBeGreaterThan(600);
      expect(renderComment(outcome).length).toBeLessThanOrEqual(65536);
    });

    test('an oversized body is truncated to a marked, still-identifiable comment', async () => {
      const root = await seed();
      const outcome = await outcomeFor(root, ['docs/adr/0001-api.md']);
      // Findings on changed records are the remaining unbounded input; the guard is not
      // specific to markers.
      outcome.changedRecords = ['docs/adr/0001-api.md'];
      outcome.findings = Array.from({ length: 4000 }, (_, index) => ({
        rule: 'invalid-format',
        severity: 'error' as const,
        message: `finding ${index} ${'x'.repeat(60)}`,
        path: 'docs/adr/0001-api.md',
      }));

      const body = renderComment(outcome);

      expect(body.length).toBeLessThanOrEqual(65536);
      expect(body.startsWith(CI_COMMENT_MARKER)).toBe(true);
      expect(body).toContain('output truncated to fit GitHub');
      expect(renderComment(outcome)).toBe(body); // deterministic, so the upsert stays idempotent
    });

    test('truncatable governance detail cannot crowd out changed-record validation errors', async () => {
      const root = await seed();
      const outcome = await outcomeFor(root, ['packages/api/src/server.ts']);
      const decision = outcome.governing[0];
      if (!decision) throw new Error('expected a governing decision to expand');
      decision.firedMatchers = Array.from({ length: 1000 }, (_, index) => ({
        type: 'path',
        pattern: `src/${String(index).padStart(4, '0')}/${'x'.repeat(80)}`,
      }));
      outcome.changedRecords = ['docs/adr/9999-broken.md'];
      outcome.findings = [
        {
          rule: 'frontmatter-parse',
          severity: 'error',
          message: 'Unterminated frontmatter',
          path: 'docs/adr/9999-broken.md',
        },
      ];
      outcome.ok = false;

      const body = renderComment(outcome);

      expect(body.length).toBeLessThanOrEqual(65536);
      expect(body).toContain('output truncated to fit GitHub');
      expect(body).toContain('Validation errors on changed records');
      expect(body).toContain('docs/adr/9999-broken.md');
      expect(body).toContain('frontmatter-parse');
    });

    test('an oversized finding message cannot crowd out its blocking path and rule', async () => {
      const root = await seed();
      const outcome = await outcomeFor(root, ['packages/api/src/server.ts']);
      outcome.changedRecords = ['docs/adr/9999-broken.md'];
      outcome.findings = [
        {
          rule: 'frontmatter-parse',
          severity: 'error',
          message: 'x'.repeat(70_000),
          path: 'docs/adr/9999-broken.md',
        },
      ];
      outcome.ok = false;

      const body = renderComment(outcome);

      expect(body.length).toBeLessThanOrEqual(65536);
      expect(body).toContain('docs/adr/9999-broken.md');
      expect(body).toContain('frontmatter-parse');
      expect(body).toContain('[message truncated]');
      expect(body).not.toContain('x'.repeat(1024));
    });

    test('separated backtick runs cannot exceed Node\'s variadic argument limit', async () => {
      const root = await resetTestDir(DIR_NAME);
      const build = await Bun.build({
        entrypoints: [join(process.cwd(), 'packages/ci/src/comment.ts')],
        outdir: join(root, 'node-bundle'),
        target: 'node',
        format: 'esm',
      });
      expect(build.success).toBe(true);
      const output = build.outputs[0];
      if (!output) throw new Error('expected the Node renderer bundle');

      const script = [
        `import { renderComment } from ${JSON.stringify(pathToFileURL(output.path).href)};`,
        "const pattern = '`x'.repeat(300_000);",
        "const decision = { recordId: '0001', title: 'Guard', status: 'accepted', bucket: 'governing', firedMatchers: [{ type: 'path', pattern }] };",
        "const outcome = { changedFiles: ['src/a.ts'], governedBy: [decision], governing: [decision], activeProposals: [], history: [], changedRecords: [], findings: [], ok: true };",
        'const body = renderComment(outcome);',
        "process.stdout.write(String(body.length));",
      ].join('\n');
      const proc = Bun.spawn(['node', '--input-type=module', '--eval', script], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
      expect(Number(stdout)).toBeLessThanOrEqual(65536);
    });
  });

  /**
   * The path in a `declared by` line is a filename the pull request chose, and git
   * permits backticks and control characters in one. An unescaped span lets that
   * filename close the span and render live markdown as the bot.
   */
  describe('an authored path cannot escape its code span', () => {
    async function declaringOutcome(path: string) {
      const root = await seed();
      const outcome = await outcomeFor(root, ['packages/api/src/server.ts']);
      const decision = outcome.governing[0];
      if (!decision) throw new Error('expected a governing decision to annotate');
      decision.declaredBy = [{ path, line: 1, ref: '0001' }];
      return outcome;
    }

    test('a backtick in the filename widens the fence instead of ending the span', async () => {
      const hostile = 'src/x`[Approved — merge](https://evil.example)`y.ts';
      const body = renderComment(await declaringOutcome(hostile));

      expect(body).toContain(`declared by \`\`${hostile}:1\`\``);
      // The payload never becomes a live link: no `](` sits outside a span.
      expect(body).not.toContain(`declared by \`${hostile}:1\``);
    });

    test('a run of backticks is outrun rather than matched', async () => {
      const body = renderComment(await declaringOutcome('src/a``b.ts'));

      expect(body).toContain('declared by ```src/a``b.ts:1```');
    });

    test('a filename that begins or ends with a backtick is padded', async () => {
      const body = renderComment(await declaringOutcome('`src/lead.ts'));

      expect(body).toContain('declared by `` `src/lead.ts:1 ``');
    });

    test('a newline in the filename is escaped, not emitted as a line break', async () => {
      const body = renderComment(await declaringOutcome('src/a\nb.ts'));

      expect(body).toContain('declared by `src/a\\x0ab.ts:1`');
      expect(body.split('\n').filter((line) => line.includes('declared by'))).toHaveLength(1);
    });

    test('the same escaping covers finding paths, which predate declarations', async () => {
      const root = await seed();
      const outcome = await outcomeFor(root, ['docs/adr/0001-api.md']);
      outcome.changedRecords = ['docs/adr/0001-`bad`.md'];
      outcome.findings = [
        {
          rule: 'invalid-format',
          severity: 'error',
          message: 'bad record',
          path: 'docs/adr/0001-`bad`.md',
        },
      ];

      expect(renderComment(outcome)).toContain('- ``docs/adr/0001-`bad`.md``');
    });
  });

  test('a change matched only by non-accepted records says no accepted decision governs it', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeText(
      join(root, 'docs/adr/0001-draft.md'),
      withAffects(recordMarkdown('0001', 'Draft record'), path('src/api/**')),
    );

    const body = renderComment(await outcomeFor(root, ['src/api/thing.ts']));

    expect(body).toContain('No **accepted** decisions govern the changed files.');
    expect(body).toContain('#### Active proposals touching this change');
  });
});
