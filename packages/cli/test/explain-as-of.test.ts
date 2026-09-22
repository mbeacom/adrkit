import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  acceptedRecordMarkdown,
  cleanupTestDir,
  recordMarkdown,
  resetTestDir,
  supersededRecordMarkdown,
  writeText,
} from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-explain-as-of';

async function runAdr(args: string[], cwd = process.cwd()) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args, '--color', 'never'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/**
 * Run git with a **fixed** identity, a **fixed** clock, and — the one that is easy to skip
 * and expensive to skip — no global or system config. A developer with `tag.gpgSign = true`
 * set globally otherwise turns `git tag -a` here into a GPG passphrase prompt that hangs the
 * suite, and the same machine-specific config can make these assertions pass or fail for
 * reasons that have nothing to do with adrkit.
 */
async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...Bun.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_DATE: '2026-02-10T09:00:00+00:00',
      GIT_COMMITTER_DATE: '2026-02-10T09:00:00+00:00',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim()}`);
  return stdout.trim();
}

/**
 * A corpus in a fresh OS temp directory, outside every git repository.
 *
 * `resetTestDir` writes under the repository's own `.test-output/`, where `git rev-parse`
 * walks up and finds **adrkit's** repository. That makes "outside a repository" untestable
 * there, and makes a `git init` in these tests a nested repo rather than a standalone one.
 */
const tempRoots: string[] = [];

async function isolatedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'adrkit-explain-as-of-'));
  tempRoots.push(root);
  return root;
}

async function repoRoot(): Promise<string> {
  const root = await isolatedRoot();
  await writeSupersessionCorpus(root);
  await git(['init', '-q', '-b', 'main', '.'], root);
  await git(['add', '-A'], root);
  await git(['commit', '-qm', 'first'], root);
  return root;
}

function withAffects(markdown: string, pattern: string): string {
  return markdown.replace('affects: []', ['affects:', '  - type: path', `    pattern: "${pattern}"`].join('\n'));
}

function withDate(markdown: string, date: string): string {
  return markdown.replace('date: 2026-07-18', `date: ${date}`);
}

/**
 * ADR-0007 superseded by ADR-0019 on 2026-06-01, both governing `src/auth/**`, with the
 * source file declaring the historical record. This is the issue's own worked example.
 */
async function writeSupersessionCorpus(root: string): Promise<string> {
  const dir = join(root, 'docs/adr');
  await writeText(
    join(dir, '0007-use-jwt.md'),
    withDate(withAffects(supersededRecordMarkdown('0007', '0019', 'Use JWT sessions'), 'src/auth/**'), '2026-01-15'),
  );
  await writeText(
    join(dir, '0019-use-opaque.md'),
    withDate(withAffects(acceptedRecordMarkdown('0019', 'Use opaque server sessions'), 'src/auth/**'), '2026-06-01'),
  );
  await writeText(join(root, 'src/auth/session.ts'), '// @adr 0007\nexport const session = 1;\n');
  return dir;
}

/**
 * Whether this machine's git can produce an SSH-signed commit.
 *
 * The signature regression below needs a genuinely signed commit — `log.showSignature`
 * changes nothing without one — and SSH signing needs git >= 2.34 plus `ssh-keygen`. The
 * probe keeps an old toolchain from failing the suite for a reason that is not adrkit's.
 */
async function canSignCommits(): Promise<boolean> {
  const probe = await isolatedRoot();
  try {
    const key = join(probe, 'signing-key');
    const keygen = Bun.spawn(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', key, '-C', 'adrkit-test'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if ((await keygen.exited) !== 0) return false;
    await git(['init', '-q', '-b', 'main', '.'], probe);
    await writeText(join(probe, 'a.txt'), 'x\n');
    await git(['add', '-A'], probe);
    await git(
      ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${key}.pub`, '-c', 'commit.gpgsign=true', 'commit', '-qm', 'signed'],
      probe,
    );
    return true;
  } catch {
    return false;
  }
}

const SIGNING_AVAILABLE = await canSignCommits();

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('adr explain --as-of', () => {
  test('reports a record superseded today as governing on a date inside its window', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeSupersessionCorpus(root);

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', '2026-03-01'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('As of 2026-03-01');
    expect(result.stdout).toContain('Decisions governing src/auth/session.ts as of 2026-03-01:');
    // Present status in brackets, window underneath: both facts, neither invented.
    expect(result.stdout).toContain('0007  [superseded] Use JWT sessions');
    expect(result.stdout).toContain('in force 2026-01-15 → 2026-06-01 (closed by 0019)');
    expect(result.stdout).toContain('Not yet recorded as of 2026-03-01:');
    expect(result.stdout).toContain('recorded 2026-06-01');
  });

  test('the view says plainly that evidence is not re-dated, and only under --as-of', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeSupersessionCorpus(root);

    const asOf = await runAdr(['explain', 'src/auth/session.ts', '--as-of', '2026-03-01'], root);
    const present = await runAdr(['explain', 'src/auth/session.ts'], root);

    // Every `via path:` and `declared by` line below the header was read from today's
    // corpus and today's file. Without this, `via path: src/auth/**` under a record dated
    // after the query reads as a claim about what matched back then.
    expect(asOf.stdout).toContain('only standing is re-dated');
    expect(present.stdout).not.toContain('only standing is re-dated');
  });

  test('the handover date belongs to the successor alone', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeSupersessionCorpus(root);

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', '2026-06-01'], root);

    expect(result.stdout).toContain('Decisions governing src/auth/session.ts as of 2026-06-01:');
    expect(result.stdout).toContain('0019  [accepted] Use opaque server sessions');
    expect(result.stdout).toContain('Historical records as of 2026-06-01 (not binding):');
  });

  test('a marker that was accurate on that date is not reported stale', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeSupersessionCorpus(root);

    const asOf = await runAdr(['explain', 'src/auth/session.ts', '--as-of', '2026-03-01'], root);
    const present = await runAdr(['explain', 'src/auth/session.ts'], root);

    expect(asOf.stdout).not.toContain('stale-marker');
    // The same marker, the same file, judged against today: still stale. `--as-of`
    // re-dates the corpus, it does not disable the diagnostic.
    expect(present.stdout).toContain('stale-marker');
  });

  test('a marker is stale again once the window has closed', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeSupersessionCorpus(root);

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', '2026-08-01'], root);

    expect(result.stdout).toContain('stale-marker');
  });

  test('without the flag, output is byte-identical to before', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeSupersessionCorpus(root);

    const result = await runAdr(['explain', 'src/auth/session.ts'], root);

    expect(result.stdout).toContain('Decisions governing src/auth/session.ts:');
    expect(result.stdout).not.toContain('As of ');
    expect(result.stdout).not.toContain('in force ');
  });

  test('--json adds an asOf block and leaves the present-tense keys untouched', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeSupersessionCorpus(root);

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', '2026-03-01', '--json'], root);
    const payload = JSON.parse(result.stdout);

    expect(payload.asOf.date).toBe('2026-03-01');
    expect(payload.asOf.requested).toBe('2026-03-01');
    expect(payload.asOf.resolvedFrom).toBe('date');
    expect(payload.asOf.commit).toBeUndefined();
    expect(payload.asOf.governing.map((d: { recordId: string }) => d.recordId)).toEqual(['0007']);
    expect(payload.asOf.notYetRecorded.map((d: { recordId: string }) => d.recordId)).toEqual(['0019']);
    expect(payload.asOf.governing[0].window).toEqual({
      opensOn: '2026-01-15',
      closesOn: '2026-06-01',
      closedBy: '0019',
    });
    expect(payload.asOf.governing[0].standing).toBe('governing');

    // A consumer that has never heard of `--as-of` must not find these re-dated under it.
    expect(payload.governing.map((d: { recordId: string }) => d.recordId)).toEqual(['0019']);
    expect(payload.history.map((d: { recordId: string }) => d.recordId)).toEqual(['0007']);
  });

  test('--json omits the asOf block entirely when the flag is absent', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeSupersessionCorpus(root);

    const result = await runAdr(['explain', 'src/auth/session.ts', '--json'], root);

    expect(JSON.parse(result.stdout).asOf).toBeUndefined();
  });

  test('a deprecated record is reported as undetermined, never guessed at', async () => {
    const root = await resetTestDir(DIR_NAME);
    const dir = join(root, 'docs/adr');
    await writeText(
      join(dir, '0031-old-way.md'),
      withDate(withAffects(recordMarkdown('0031', 'Use the old way'), 'src/**'), '2026-01-15')
        .replace('status: draft', 'status: deprecated'),
    );
    await writeText(join(root, 'src/app.ts'), 'export const app = 1;\n');

    const result = await runAdr(['explain', 'src/app.ts', '--as-of', '2026-06-01'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Standing on 2026-06-01 not determinable:');
    expect(result.stdout).toContain('no date it stopped governing is recorded');
    expect(result.stdout).toContain('temporal-window-undetermined');
    // Advisory only — it never reaches the exit code.
    expect(result.stdout).not.toContain('Decisions governing src/app.ts as of');
  });

  test('a path no decision reaches says so for the date asked about', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeSupersessionCorpus(root);

    const result = await runAdr(['explain', 'src/unrelated.ts', '--as-of', '2026-03-01'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No decision governed src/unrelated.ts as of 2026-03-01.');
  });
});

describe('adr explain --as-of <ref>', () => {
  test('resolves a git ref to its commit committer date', async () => {
    const root = await repoRoot();
    const head = await git(['rev-parse', 'HEAD'], root);

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', 'HEAD', '--json'], root);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.asOf.resolvedFrom).toBe('ref');
    expect(payload.asOf.requested).toBe('HEAD');
    expect(payload.asOf.date).toBe('2026-02-10');
    expect(payload.asOf.commit).toBe(head);
    expect(payload.asOf.committedAt).toBe('2026-02-10T09:00:00Z');
    expect(payload.asOf.governing.map((d: { recordId: string }) => d.recordId)).toEqual(['0007']);
  });

  test('peels an annotated tag to its commit', async () => {
    const root = await repoRoot();
    await git(['tag', '-a', 'v1.0.0', '-m', 'release'], root);

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', 'v1.0.0', '--json'], root);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).asOf.date).toBe('2026-02-10');
  });

  test('a date is tried before a ref, so a tag named like a date reads as a date', async () => {
    const root = await repoRoot();
    // The tag's commit is 2026-02-10; the tag's *name* is a different date.
    await git(['tag', '2026-03-01'], root);

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', '2026-03-01', '--json'], root);
    const payload = JSON.parse(result.stdout);

    expect(payload.asOf.resolvedFrom).toBe('date');
    expect(payload.asOf.date).toBe('2026-03-01');
  });
});

describe('adr explain --as-of rejections', () => {
  test('an unresolvable ref names git, and exits 2', async () => {
    const root = await repoRoot();

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', 'no-such-ref'], root);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('git could not resolve it to a commit');
    expect(result.stdout).toBe('');
  });

  test('outside a repository, the reason is the missing repository rather than a bad ref', async () => {
    const root = await isolatedRoot();
    await writeSupersessionCorpus(root);

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', 'a1b2c3d'], root);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('is not a git repository');
  });

  test('a timezone-less datetime is rejected in the same words adr queue uses', async () => {
    const root = await resetTestDir(DIR_NAME);
    await writeSupersessionCorpus(root);

    const explain = await runAdr(['explain', 'src/auth/session.ts', '--as-of', '2026-03-01T00:00:00'], root);
    const queue = await runAdr(['queue', '--as-of', '2026-03-01T00:00:00'], root);

    expect(explain.exitCode).toBe(2);
    expect(explain.stderr).toContain('Timezone-less datetimes are ambiguous');
    expect(queue.stderr).toContain('Timezone-less datetimes are ambiguous');
  });

  test('an impossible calendar date is diagnosed as a date, not as a missing ref', async () => {
    const root = await repoRoot();

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', '2026-02-30'], root);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Expected YYYY-MM-DD');
    expect(result.stderr).not.toContain('git could not resolve');
  });

  test('a following option is never consumed as a ref and handed to git', async () => {
    const root = await isolatedRoot();
    await writeSupersessionCorpus(root);

    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', '--json'], root);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Option '--as-of' argument is ambiguous");
  });

  test('a dash-leading value forced with = is rejected before it can reach git as an option', async () => {
    const root = await isolatedRoot();
    await writeSupersessionCorpus(root);

    // `parseArgs` deliberately permits `--as-of=-XYZ`, so this is the one spelling that can
    // hand a leading dash through. `git rev-parse` would read it as an option.
    const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of=--all'], root);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Missing value for option "--as-of"');
  });
});

describe('adr explain --as-of and inherited git config', () => {
  test.skipIf(!SIGNING_AVAILABLE)(
    'a signed commit under log.showSignature still resolves',
    async () => {
      const root = await isolatedRoot();
      await writeSupersessionCorpus(root);
      const key = join(root, 'signing-key');
      const keygen = Bun.spawn(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', key, '-C', 'adrkit-test'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(await keygen.exited).toBe(0);

      await git(['init', '-q', '-b', 'main', '.'], root);
      await git(['add', '-A'], root);
      await git(
        ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${key}.pub`, '-c', 'commit.gpgsign=true', 'commit', '-qm', 'first'],
        root,
      );
      // Repo-local, so the CLI's own git invocation inherits it exactly as a user's
      // global config would.
      await git(['config', 'log.showSignature', 'true'], root);

      const result = await runAdr(['explain', 'src/auth/session.ts', '--as-of', 'HEAD', '--json'], root);

      // Without `--no-show-signature`, git prepends `Good "git" signature for …` to
      // stdout and this exits 2 with "git could not resolve it to a commit".
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).asOf.date).toBe('2026-02-10');
    },
  );

  test('a ref resolves against the working directory, not --dir', async () => {
    const repo = await repoRoot();
    const elsewhere = await isolatedRoot();
    await writeSupersessionCorpus(elsewhere);

    // The corpus lives outside the repository the ref is resolved in. `--dir` selects
    // records; the working directory selects the git history. Pinned because moving ref
    // resolution to the corpus directory would look like a tidy-up and silently change
    // which repository a ref means.
    const result = await runAdr(
      ['explain', 'src/auth/session.ts', '--dir', join(elsewhere, 'docs/adr'), '--as-of', 'HEAD', '--json'],
      repo,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).asOf.date).toBe('2026-02-10');
  });
});
