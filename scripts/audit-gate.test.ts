import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { evaluateAudit, formatEvaluation, main } from '../scripts/audit-gate.ts';
import mcpManifest from '../packages/mcp/package.json' with { type: 'json' };

const FIXTURES = resolve(import.meta.dir, '__fixtures__', 'audit');
const readFixture = (name: string) => Bun.file(resolve(FIXTURES, name)).text();
const ACTIVE_ACCEPTANCE_AS_OF = '2026-07-25';

/**
 * A synthetic acceptance used to keep the expiry and reporting machinery under test
 * while the real acceptance list is empty. Injected via `evaluateAudit`'s test-only
 * `acceptances` option, so it never claims a real exposure.
 */
const SAMPLE_ACCEPTANCE = {
  advisoryId: 'GHSA-example-0000-0000',
  url: 'https://github.com/advisories/GHSA-example-0000-0000',
  title: 'Example advisory used only to exercise the acceptance machinery',
  severity: 'moderate',
  package: 'example-transitive',
  observedVersion: '1.0.0',
  vulnerableVersions: '<2.0.0',
  affectedPublishedPackage: '@adrkit/example',
  affectedPublishedVersion: '0.0.0',
  dependencyPath: ['@adrkit/example', 'example-upstream@1.0.0', 'example-transitive'],
  acceptedUntil: '2026-10-31',
  whyNotFixed: 'synthetic fixture; upstream range cannot resolve the patched version.',
  consequence: 'synthetic fixture; no real consumer exposure.',
  resolvesWhen: 'synthetic fixture; never.',
} as const;

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
    const evaluation = evaluateAudit(await readFixture('clean.json'), { asOf: ACTIVE_ACCEPTANCE_AS_OF });
    expect(evaluation.ok).toBe(true);
    expect(evaluation.reason).toBeUndefined();
    expect(evaluation.blocking).toEqual([]);
    expect(evaluation.examinedPackages).toBe(0);
    expect(formatEvaluation(evaluation)).toContain('PASSED');
  });

  test('states that the live gate audits the workspace resolved tree, not published consumer installs', async () => {
    const evaluation = evaluateAudit(await readFixture('clean.json'), { asOf: ACTIVE_ACCEPTANCE_AS_OF });
    const rendered = formatEvaluation(evaluation);

    expect(rendered).toContain('scope: workspace-resolved-dependency-tree');
    expect(rendered).toContain('as resolved by `bun install --frozen-lockfile`');
    expect(rendered).toContain('does not audit consumer installs of published @adrkit/* packages');
  });

  test('records no known published-consumer exposure now that the MCP SDK v2 split removed the path', async () => {
    const evaluation = evaluateAudit(await readFixture('clean.json'), { asOf: ACTIVE_ACCEPTANCE_AS_OF });

    expect(evaluation.ok).toBe(true);
    // The @hono/node-server acceptance retired when @adrkit/mcp moved to
    // @modelcontextprotocol/server v2 (deps: @modelcontextprotocol/core + zod only).
    expect(evaluation.knownConsumerAdvisories).toEqual([]);
    expect(formatEvaluation(evaluation)).not.toContain('known published-consumer exposure');
    // Guard against a stale acceptance outliving the exposure it describes: the
    // manifest this repo is about to ship no longer reaches the vulnerable package.
    expect(mcpManifest.dependencies).not.toHaveProperty('@modelcontextprotocol/sdk');
  });

  test('reports an active acceptance in full, without hiding the scope gap', async () => {
    const evaluation = evaluateAudit(await readFixture('clean.json'), {
      asOf: ACTIVE_ACCEPTANCE_AS_OF,
      acceptances: [SAMPLE_ACCEPTANCE],
    });
    const known = evaluation.knownConsumerAdvisories?.[0];

    expect(evaluation.ok).toBe(true);
    expect(known?.package).toBe('example-transitive');
    expect(known?.expired).toBe(false);
    expect(known?.acceptedUntil).toBe('2026-10-31');

    const rendered = formatEvaluation(evaluation);
    expect(rendered).toContain('known published-consumer exposure');
    expect(rendered).toContain('GHSA-example-0000-0000');
    expect(rendered).toContain('accepted until 2026-10-31');
    expect(rendered).toContain('why not fixed:');
    expect(rendered).toContain('resolves when:');
  });

  test('fails closed once a known consumer advisory acceptance expires', async () => {
    const evaluation = evaluateAudit(await readFixture('clean.json'), {
      asOf: '2026-11-01',
      acceptances: [SAMPLE_ACCEPTANCE],
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.reason).toBe('consumer-advisory-acceptance-expired');
    expect(formatEvaluation(evaluation)).toContain('consumer advisory acceptance expired');
  });

  test('a clean tree with no recorded acceptances cannot expire', async () => {
    const evaluation = evaluateAudit(await readFixture('clean.json'), { asOf: '2099-01-01' });
    expect(evaluation.ok).toBe(true);
    expect(evaluation.reason).toBeUndefined();
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
    const evaluation = evaluateAudit(moderateOnly, { asOf: ACTIVE_ACCEPTANCE_AS_OF });
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

describe('audit-gate — schema shape (fail-closed on anything unrecognized)', () => {
  // These are the fail-OPEN cases: input that parses as JSON but is not the
  // shape `bun audit --json` produces. Before the shape check existed, every
  // one of these returned ok:true with "examined 0 packages" — indistinguishable
  // from a genuinely clean tree, which is the exact blind pass ADR-0016 governs.
  // A gate that cannot tell "nothing to report" from "I no longer understand the
  // report" is not a gate.

  test('rejects an envelope whose values are not arrays', () => {
    // The realistic regression: bun wraps output as { "advisories": { ... } }.
    const evaluation = evaluateAudit(JSON.stringify({ advisories: { 'some-pkg': [] } }));
    expect(evaluation.ok).toBe(false);
    expect(evaluation.reason).toBe('unexpected-shape');
    expect(formatEvaluation(evaluation)).toContain('could not be read');
  });

  test('rejects a top-level array', () => {
    const evaluation = evaluateAudit(JSON.stringify([{ severity: 'high' }]));
    expect(evaluation.ok).toBe(false);
    expect(evaluation.reason).toBe('unexpected-shape');
  });

  test('rejects top-level null without throwing', () => {
    // Object.entries(null) throws, so this crashed the gate rather than failing it.
    const evaluation = evaluateAudit('null');
    expect(evaluation.ok).toBe(false);
    expect(evaluation.reason).toBe('unexpected-shape');
  });

  test('rejects a scalar', () => {
    expect(evaluateAudit('42').reason).toBe('unexpected-shape');
    expect(evaluateAudit('"clean"').reason).toBe('unexpected-shape');
  });

  test('rejects an unknown severity rather than tallying it as non-blocking', () => {
    // If bun ever renames severities (e.g. uppercase), the old code incremented
    // an unknown key and reported a clean pass while a real advisory sat there.
    const renamed = JSON.stringify({
      'bad-pkg': [{ id: 3, url: 'https://example.test/a', title: 'thing', severity: 'HIGH' }],
    });
    const evaluation = evaluateAudit(renamed);
    expect(evaluation.ok).toBe(false);
    expect(evaluation.reason).toBe('unexpected-shape');
  });

  test('rejects an advisory missing the fields the report renders', () => {
    const missingUrl = JSON.stringify({ 'bad-pkg': [{ id: 4, title: 'thing', severity: 'high' }] });
    expect(evaluateAudit(missingUrl).reason).toBe('unexpected-shape');

    const notAnObject = JSON.stringify({ 'bad-pkg': ['high'] });
    expect(evaluateAudit(notAnObject).reason).toBe('unexpected-shape');
  });

  test('names what did not match, so the operator can tell why it went blind', () => {
    const evaluation = evaluateAudit(JSON.stringify({ advisories: { pkg: [] } }));
    expect(evaluation.shapeError).toContain('advisories');
    expect(formatEvaluation(evaluation)).toContain('advisories');
  });

  test('still accepts the real clean and dirty shapes', async () => {
    expect(evaluateAudit(await readFixture('clean.json'), { asOf: ACTIVE_ACCEPTANCE_AS_OF }).ok).toBe(true);
    expect(evaluateAudit(await readFixture('prefix-high.json')).reason).toBe('blocking-advisories');
    // An empty advisory array for a package is legitimate, not a shape error.
    expect(evaluateAudit(JSON.stringify({ 'some-pkg': [] }), { asOf: ACTIVE_ACCEPTANCE_AS_OF }).ok).toBe(true);
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
