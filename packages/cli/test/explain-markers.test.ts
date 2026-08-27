import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { acceptedRecordMarkdown, cleanupTestDir, resetTestDir, writeText } from '../../core/test/helpers.ts';

const CLI_PATH = resolve(process.cwd(), 'packages/cli/src/index.ts');
const DIR_NAME = 'cli-explain-markers';
/** A sibling of the working tree, so "outside it" is a real place on disk. */
const OUTSIDE_DIR_NAME = 'cli-explain-markers-outside';

async function runAdr(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function withAffects(markdown: string, pattern: string): string {
  return markdown.replace('affects: []', ['affects:', '  - type: path', `    pattern: "${pattern}"`].join('\n'));
}

/**
 * A corpus with one record that claims the *defining* file by pattern, and one that
 * claims nothing — the narrow-`affects` shape the inbound marker exists to complete.
 */
async function corpus(root: string): Promise<void> {
  const dir = join(root, 'docs/adr');
  await writeText(
    join(dir, '0001-sync-protocol.md'),
    withAffects(acceptedRecordMarkdown('0001', 'Use the sync protocol'), 'src/sync/protocol.ts'),
  );
  await writeText(
    join(dir, '0002-retry-policy.md'),
    acceptedRecordMarkdown('0002', 'Retry on transient sync failure'),
  );
}

afterEach(async () => {
  await cleanupTestDir(DIR_NAME);
  await cleanupTestDir(OUTSIDE_DIR_NAME);
});

describe('adr explain — inbound @adr markers', () => {
  test('a file declaring a record makes that record govern it', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    await writeText(join(root, 'src/sync/retry.ts'), '// @adr 0002\nexport const retry = true;\n');

    const result = await runAdr(['explain', 'src/sync/retry.ts', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('0002  [accepted] Retry on transient sync failure');
    expect(result.stdout).toContain('declared by src/sync/retry.ts:1 (@adr 0002)');
  });

  test('human output tells a pattern match apart from a file declaration', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    await writeText(join(root, 'src/sync/protocol.ts'), '// @adr 0002\nexport const protocol = 1;\n');

    const result = await runAdr(['explain', 'src/sync/protocol.ts', '--dir', 'docs/adr'], root);

    expect(result.stdout).toContain('via path: src/sync/protocol.ts');
    expect(result.stdout).toContain('declared by src/sync/protocol.ts:1 (@adr 0002)');
  });

  test('--json separates firedMatchers from declaredBy and is byte-stable', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    const source = '// @adr 0002\nexport const protocol = 1;\n';
    await writeText(join(root, 'src/sync/protocol.ts'), source);
    const bytes = new TextEncoder().encode(source).length;

    const first = await runAdr(['explain', 'src/sync/protocol.ts', '--dir', 'docs/adr', '--json'], root);
    const second = await runAdr(['explain', 'src/sync/protocol.ts', '--dir', 'docs/adr', '--json'], root);
    const parsed = JSON.parse(first.stdout);

    expect(second.stdout).toBe(first.stdout);
    expect(parsed.governedBy).toEqual([
      {
        recordId: '0001',
        title: 'Use the sync protocol',
        status: 'accepted',
        bucket: 'governing',
        firedMatchers: [{ type: 'path', pattern: 'src/sync/protocol.ts' }],
      },
      {
        recordId: '0002',
        title: 'Retry on transient sync failure',
        status: 'accepted',
        bucket: 'governing',
        firedMatchers: [],
        declaredBy: [{ path: 'src/sync/protocol.ts', line: 1, ref: '0002' }],
      },
    ]);
    expect(parsed.markers).toEqual({
      state: 'scanned',
      windowBytes: 8192,
      scannedBytes: bytes,
      fileBytes: bytes,
      truncated: false,
      declarationLimit: 64,
      totalDeclarations: 1,
      omittedDeclarations: 0,
      declared: [{ ref: '0002', line: 1 }],
    });
  });

  test('a marker naming a record that does not exist is reported, at exit 0', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    await writeText(join(root, 'src/sync/retry.ts'), '// @adr 0099\n');

    const result = await runAdr(['explain', 'src/sync/retry.ts', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('warn dangling-marker');
    expect(result.stdout).toContain('Source marker "@adr 0099" in src/sync/retry.ts:1');
  });

  test('reports exact per-file declaration overflow without resolving omitted claims', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    const source = Array.from({ length: 65 }, () => '// @adr 0002\n').join('');
    await writeText(join(root, 'src/sync/retry.ts'), source);

    const human = await runAdr(['explain', 'src/sync/retry.ts', '--dir', 'docs/adr'], root);
    const json = await runAdr(['explain', 'src/sync/retry.ts', '--dir', 'docs/adr', '--json'], root);
    const parsed = JSON.parse(json.stdout);

    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('retained the first 64 @adr declarations');
    expect(human.stdout).toContain('omitted 1 more');
    expect(parsed.governedBy[0].declaredBy).toHaveLength(64);
    expect(parsed.markers).toMatchObject({
      declarationLimit: 64,
      totalDeclarations: 65,
      omittedDeclarations: 1,
    });
    expect(parsed.markers.declared).toHaveLength(64);
  });

  test('says so when the path is not a file it could scan', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);

    const human = await runAdr(['explain', 'src/sync/missing.ts', '--dir', 'docs/adr'], root);
    const json = await runAdr(['explain', 'src/sync/missing.ts', '--dir', 'docs/adr', '--json'], root);

    expect(human.stdout).toContain(
      'Note: src/sync/missing.ts is not a file in this working tree; no @adr markers were scanned.',
    );
    expect(JSON.parse(json.stdout).markers).toEqual({
      state: 'absent',
      windowBytes: 8192,
      truncated: false,
      declarationLimit: 64,
      totalDeclarations: 0,
      omittedDeclarations: 0,
      declared: [],
    });
  });

  test('preserves the human scan note when corpus errors stop resolution', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    await writeText(
      join(root, 'docs/adr/0003-invalid.md'),
      acceptedRecordMarkdown('0003').replace('status: accepted', 'status: not-a-status'),
    );

    const result = await runAdr(['explain', 'src/sync/missing.ts', '--dir', 'docs/adr'], root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('invalid-enum-value');
    expect(result.stdout).toContain(
      'Note: src/sync/missing.ts is not a file in this working tree; no @adr markers were scanned.',
    );
  });

  test('refuses to answer for a path outside the working tree, and says why', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    const outside = await resetTestDir(OUTSIDE_DIR_NAME);
    await writeText(join(outside, 'claim.ts'), '// @adr 0002\n');
    const escape = `../${OUTSIDE_DIR_NAME}/claim.ts`;

    const human = await runAdr(['explain', escape, '--dir', 'docs/adr'], root);
    const json = await runAdr(['explain', escape, '--dir', 'docs/adr', '--json'], root);

    // The pattern half of `explain` can never match this path; without the boundary the
    // marker half would answer for it, and 0002 would govern a file in another tree.
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain(`No decision governs ${escape}.`);
    expect(human.stdout).toContain(
      `Note: ${escape} is not a repo-relative path inside this working tree; no @adr markers were scanned.`,
    );
    expect(JSON.parse(json.stdout).markers).toEqual({
      state: 'out-of-tree',
      windowBytes: 8192,
      truncated: false,
      declarationLimit: 64,
      totalDeclarations: 0,
      omittedDeclarations: 0,
      declared: [],
    });
  });

  test('discloses how much of a large file was scanned, and of what total', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    const source = `// @adr 0002\n${'#'.repeat(9000)}\n`;
    await writeText(join(root, 'src/sync/big.ts'), source);
    const bytes = new TextEncoder().encode(source).length;

    const result = await runAdr(['explain', 'src/sync/big.ts', '--dir', 'docs/adr'], root);

    expect(result.stdout).toContain('declared by src/sync/big.ts:1 (@adr 0002)');
    // The single 9000-byte line cannot be cut anywhere inside the window, so the header
    // line is the whole scanned extent — 13 bytes, not the 8192 the window suggests.
    expect(result.stdout).toContain(
      `Note: only the first 13 of ${bytes} bytes of src/sync/big.ts were scanned for @adr markers.`,
    );
  });

  /**
   * Issue #108: `truncated: true` alone cannot say whether `declared` is complete, so a
   * consumer had to treat every file over the window as indeterminate. The extent makes
   * the coverage question answerable without knowing the window constant.
   */
  test('--json reports the scanned extent, so a hit window is not automatically unknown', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    // Markers in the header, exactly where the docs recommend, in a file over the window.
    const header = '// @adr 0002\n';
    const body = `${'x'.repeat(200)}\n`.repeat(60);
    await writeText(join(root, 'src/sync/large.ts'), `${header}${body}`);

    const result = await runAdr(['explain', 'src/sync/large.ts', '--dir', 'docs/adr', '--json'], root);
    const markers = JSON.parse(result.stdout).markers;

    expect(markers.state).toBe('scanned');
    expect(markers.declared).toEqual([{ ref: '0002', line: 1 }]);
    expect(markers.truncated).toBe(true);
    // The consumer's own policy is now expressible: bytes remain unscanned, and it can
    // see how many rather than inheriting "indeterminate".
    expect(markers.fileBytes).toBe(new TextEncoder().encode(`${header}${body}`).length);
    // The exact extent, not a range: 13 header bytes plus as many whole 201-byte body
    // lines as fit under 8192. A bound like `scannedBytes < fileBytes` is satisfied by
    // any wrong smaller number, including the 13 a first-terminator cut would report.
    expect(markers.scannedBytes).toBe(header.length + 201 * 40);
    expect(markers.scannedBytes).toBeLessThan(markers.fileBytes);
  });

  test('--json omits the extent only for a path it never read', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    await writeText(join(root, 'src/sync/present.ts'), '// @adr 0002\n');

    const absent = await runAdr(['explain', 'src/sync/missing.ts', '--dir', 'docs/adr', '--json'], root);
    const scanned = await runAdr(['explain', 'src/sync/present.ts', '--dir', 'docs/adr', '--json'], root);

    // Asserted as exact key sequences, so this fails if the fields stop being reported,
    // if they appear for a path nothing was read from, or if the block's key ORDER
    // changes — `--json` is a byte contract, and a consumer may golden-diff it. Reporting
    // `0` for an unread path would read as a measurement of an empty file.
    expect(Object.keys(JSON.parse(absent.stdout).markers)).toEqual([
      'state',
      'windowBytes',
      'truncated',
      'declarationLimit',
      'totalDeclarations',
      'omittedDeclarations',
      'declared',
    ]);
    expect(Object.keys(JSON.parse(scanned.stdout).markers)).toEqual([
      'state',
      'windowBytes',
      'scannedBytes',
      'fileBytes',
      'truncated',
      'declarationLimit',
      'totalDeclarations',
      'omittedDeclarations',
      'declared',
    ]);
  });

  test('the scan note is silent when the whole file was read', async () => {
    const root = await resetTestDir(DIR_NAME);
    await corpus(root);
    await writeText(join(root, 'src/sync/small.ts'), '// @adr 0002\nexport const small = 1;\n');

    const result = await runAdr(['explain', 'src/sync/small.ts', '--dir', 'docs/adr'], root);

    // The note exists to disclose an incomplete read. On the common case — the whole file
    // scanned — it would state a limit that did not apply, so its absence is the contract.
    expect(result.stdout).toContain('declared by src/sync/small.ts:1 (@adr 0002)');
    expect(result.stdout).not.toContain('were scanned for @adr markers');
  });
});
