import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { evaluateAudit, formatEvaluation, main } from '../scripts/audit-gate.ts';

const FIXTURES = resolve(import.meta.dir, '__fixtures__', 'audit');
const readFixture = (name: string) => Bun.file(resolve(FIXTURES, name)).text();

describe('audit-gate — evaluateAudit', () => {
  // ADR-0016 permanent negative case. `prefix-high.json` is the real, unedited
  // `bun audit --json` output captured from this repository's tree BEFORE the
  // fast-uri / @hono/node-server / undici fixes landed (commits d6ec94e, 4505a9d).
  // The gate MUST reject it, and MUST name the specific advisories — not merely
  // report a nonzero count, which is the blind failure shape ADR-0016 warns about.
  test('rejects the pre-fix tree and names the exact high-severity advisories', async () => {
    const evaluation = evaluateAudit(await readFixture('prefix-high.json'));

    expect(evaluation.ok).toBe(false);
    expect(evaluation.reason).toBe('blocking-advisories');
    expect(evaluation.examinedBySeverity.high).toBe(4);

    // Assert on specific observed values (ADR-0016 clause 3), not a bare count.
    const blockingUrls = evaluation.blocking.map((a) => a.url).sort();
    expect(blockingUrls).toEqual([
      'https://github.com/advisories/GHSA-v2hh-gcrm-f6hx', // fast-uri
      'https://github.com/advisories/GHSA-v9p9-hfj2-hcw8', // undici
      'https://github.com/advisories/GHSA-vrm6-8vpv-qv8q', // undici
      'https://github.com/advisories/GHSA-vxpw-j846-p89q', // undici
    ]);

    const fastUri = evaluation.blocking.find((a) => a.package === 'fast-uri');
    expect(fastUri?.severity).toBe('high');
    expect(fastUri?.url).toBe('https://github.com/advisories/GHSA-v2hh-gcrm-f6hx');

    // The rendered message names the advisory a reviewer must act on.
    const rendered = formatEvaluation(evaluation);
    expect(rendered).toContain('FAILED');
    expect(rendered).toContain('GHSA-v2hh-gcrm-f6hx');
  });

  test('passes a clean audit ({} — audit ran, found nothing)', async () => {
    const evaluation = evaluateAudit(await readFixture('clean.json'));
    expect(evaluation.ok).toBe(true);
    expect(evaluation.reason).toBeUndefined();
    expect(evaluation.blocking).toEqual([]);
    expect(evaluation.examinedPackages).toBe(0);
    expect(formatEvaluation(evaluation)).toContain('PASSED');
  });

  // The core ADR-0016 distinction: absence of output is "could not look", which
  // must NOT render as a clean pass. Without this branch the gate would silently
  // green on a broken/altered `bun audit` — the exact fail-quiet defect the ADR
  // was written to prevent.
  test('treats empty output as a blind failure, not a clean tree', () => {
    const evaluation = evaluateAudit('');
    expect(evaluation.ok).toBe(false);
    expect(evaluation.reason).toBe('no-output');
    expect(formatEvaluation(evaluation)).toContain('could not be read');
  });

  test('treats unparseable output as a blind failure', () => {
    const evaluation = evaluateAudit('not json <html>error</html>');
    expect(evaluation.ok).toBe(false);
    expect(evaluation.reason).toBe('unparseable');
  });

  test('a lone moderate advisory does not block (high/critical only)', () => {
    const moderateOnly = JSON.stringify({
      'some-pkg': [
        {
          id: 1,
          url: 'https://example.test/advisory',
          title: 'moderate thing',
          severity: 'moderate',
        },
      ],
    });
    const evaluation = evaluateAudit(moderateOnly);
    expect(evaluation.ok).toBe(true);
    expect(evaluation.examinedBySeverity.moderate).toBe(1);
    expect(evaluation.blocking).toEqual([]);
  });

  test('a critical advisory blocks', () => {
    const critical = JSON.stringify({
      'bad-pkg': [
        {
          id: 2,
          url: 'https://example.test/critical',
          title: 'critical thing',
          severity: 'critical',
        },
      ],
    });
    const evaluation = evaluateAudit(critical);
    expect(evaluation.ok).toBe(false);
    expect(evaluation.blocking[0]?.severity).toBe('critical');
  });
});

describe('audit-gate — argument handling', () => {
  // The gate takes no arguments, so silently ignoring them reproduces the exact
  // fail-quiet shape ADR-0016 governs: an operator passing `--input fixture.json`
  // would get a PASSED that describes the live tree, not the file they named.
  // These cases reject before any audit is spawned, so they need no network.
  const captureStderr = async (argv: readonly string[]): Promise<{ code: number; err: string }> => {
    const original = console.error;
    let err = '';
    console.error = (...args: unknown[]) => {
      err += `${args.map(String).join(' ')}\n`;
    };
    try {
      return { code: await main(argv), err };
    } finally {
      console.error = original;
    }
  };

  test('rejects an unknown flag with exit 2 instead of auditing the live tree', async () => {
    const { code, err } = await captureStderr(['--input', 'scripts/__fixtures__/audit/clean.json']);
    expect(code).toBe(2);
    expect(err).toContain('unexpected argument(s): --input scripts/__fixtures__/audit/clean.json');
    expect(err).toContain('takes no arguments');
    // Critically, it must not have rendered a verdict about a tree it never read.
    expect(err).not.toContain('PASSED');
  });

  test('rejects a stray positional argument', async () => {
    const { code } = await captureStderr(['clean.json']);
    expect(code).toBe(2);
  });
});
