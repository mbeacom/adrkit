/**
 * Repo-qualified `affects` matchers (#300).
 *
 * A matcher with a `repo` qualifier names another repository. In a single-repository
 * corpus it can never apply, and before #300 it was skipped with no finding at all
 * (ADR-0016: a silent failure is the worst kind). It still must not match; it must now
 * say so with an advisory `info` finding (ADR-0059 clause 11), which carries no exit-code
 * authority (ADR-0022).
 */
import { describe, expect, test } from 'bun:test';
import { matcherAppliesToMember, resolveAffects } from '../src/affects/index.ts';
import { exitCodeForFindings } from '../src/validate/findings.ts';
import { validateAffectsRepoQualifiers } from '../src/validate/affects-repo-qualifier.ts';
import { AdrFrontmatter, type Adr } from '../src/schema/adr.schema.ts';

function record(id: string, affects: Record<string, unknown>[], status = 'accepted'): Adr {
  return {
    frontmatter: AdrFrontmatter.parse({
      schemaVersion: '0.1.0',
      id,
      title: `Use repo-qualified record ${id}`,
      status,
      date: '2026-10-10',
      deciders: ['@mbeacom'],
      tags: [],
      scope: 'component',
      reversibility: 'unknown',
      blastRadius: 'component',
      affects,
      provenance: { authoredBy: 'human' },
    }),
    body: '',
    path: `docs/adr/${id}-repo.md`,
  };
}

describe('repo-qualified affects matchers in a single-repository corpus', () => {
  test('a repo-qualified path matcher does not match and emits one info finding', () => {
    const result = resolveAffects({
      records: [record('0001', [{ type: 'path', pattern: 'src/**', repo: 'payments' }])],
      changedFiles: ['src/a.ts'],
    });

    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([
      {
        rule: 'affects-repo-not-applicable',
        severity: 'info',
        message:
          'path matcher "src/**" is qualified with repo "payments" and cannot apply in a single-repository corpus; it was skipped, and is kept for a federation that includes that repository.',
        id: '0001',
        path: 'docs/adr/0001-repo.md',
        field: 'affects.path',
        pattern: 'src/**',
      },
    ]);
    expect(exitCodeForFindings(result.findings)).toBe(0);
  });

  test('the finding fires regardless of the changed path, as affects-unresolvable does', () => {
    const result = resolveAffects({
      records: [record('0001', [{ type: 'path', pattern: 'src/**', repo: 'payments' }])],
      changedFiles: ['unrelated/file.md'],
    });
    expect(result.findings.map((finding) => finding.rule)).toEqual(['affects-repo-not-applicable']);
  });

  test('a skipped repo-qualified matcher is not also evaluated (one finding per matcher)', () => {
    // ADR-0056's live shape: a `resource` matcher qualified with an owner/name repo.
    const result = resolveAffects({
      records: [
        record('0056', [
          { type: 'path', pattern: 'packages/server/**' },
          { type: 'resource', pattern: 'azurerm_api_management', repo: 'mbeacom/adrkit-azure' },
        ]),
      ],
      changedFiles: ['packages/server/src/index.ts'],
    });

    expect(result.matches).toEqual([
      { recordId: '0056', firedMatchers: [{ type: 'path', pattern: 'packages/server/**' }] },
    ]);
    expect(result.findings.map((finding) => [finding.rule, finding.pattern])).toEqual([
      ['affects-repo-not-applicable', 'azurerm_api_management'],
    ]);
  });

  test('a repo-qualified negation cannot suppress a local match', () => {
    const result = resolveAffects({
      records: [
        record('0001', [
          { type: 'path', pattern: 'src/**' },
          { type: 'path', pattern: 'src/**', repo: 'payments', negate: true },
        ]),
      ],
      changedFiles: ['src/a.ts'],
    });
    expect(result.matches.map((match) => match.recordId)).toEqual(['0001']);
    expect(result.findings.map((finding) => finding.rule)).toEqual(['affects-repo-not-applicable']);
  });

  test('an unqualified matcher is unaffected and emits nothing', () => {
    const result = resolveAffects({
      records: [record('0001', [{ type: 'path', pattern: 'src/**' }])],
      changedFiles: ['src/a.ts'],
    });
    expect(result.matches.map((match) => match.recordId)).toEqual(['0001']);
    expect(result.findings).toEqual([]);
  });
});

describe('the federation hook: an explicit member identity (ADR-0059 clause 11)', () => {
  const member = { log: 'payments', repo: 'acme/payments' };

  test('matcherAppliesToMember: unqualified always applies; qualified needs a member', () => {
    expect(matcherAppliesToMember({}, undefined)).toBe(true);
    expect(matcherAppliesToMember({}, member)).toBe(true);
    expect(matcherAppliesToMember({ repo: 'payments' }, undefined)).toBe(false);
    expect(matcherAppliesToMember({ repo: 'payments' }, member)).toBe(true);
    expect(matcherAppliesToMember({ repo: 'acme/payments' }, member)).toBe(true);
    expect(matcherAppliesToMember({ repo: 'acme/billing' }, member)).toBe(false);
  });

  test('with a member, a matcher naming its repo or its log applies and emits nothing', () => {
    for (const repo of ['payments', 'acme/payments']) {
      const result = resolveAffects({
        records: [record('0001', [{ type: 'path', pattern: 'src/**', repo }])],
        changedFiles: ['src/a.ts'],
        member,
      });
      expect(result.matches.map((match) => match.recordId)).toEqual(['0001']);
      expect(result.findings).toEqual([]);
    }
  });

  test('with a member, a matcher naming another member is skipped silently: it applies there', () => {
    const result = resolveAffects({
      records: [record('0001', [{ type: 'path', pattern: 'src/**', repo: 'acme/billing' }])],
      changedFiles: ['src/a.ts'],
      member,
    });
    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  test("Adr.log is not consulted: a record's source log does not make its matcher apply", () => {
    const sourced: Adr = { ...record('0001', [{ type: 'path', pattern: 'src/**', repo: 'payments' }]), log: 'payments' };
    const result = resolveAffects({ records: [sourced], changedFiles: ['src/a.ts'] });
    expect(result.matches).toEqual([]);
    expect(result.findings.map((finding) => finding.rule)).toEqual(['affects-repo-not-applicable']);
  });
});

describe('validateAffectsRepoQualifiers (adr lint, once per record)', () => {
  test('one info finding per record with repo-qualified matchers, naming count and repos', () => {
    const findings = validateAffectsRepoQualifiers([
      record('0056', [
        { type: 'path', pattern: 'packages/server/**' },
        { type: 'resource', pattern: 'azurerm_api_management', repo: 'mbeacom/adrkit-azure' },
        { type: 'resource', pattern: 'azapi_resource', repo: 'mbeacom/adrkit-azure' },
        { type: 'path', pattern: 'src/**', repo: 'payments' },
      ]),
      record('0057', [{ type: 'path', pattern: 'src/**' }]),
    ]);

    expect(findings).toEqual([
      {
        rule: 'affects-repo-not-applicable',
        severity: 'info',
        message:
          '3 affects matchers are qualified with another repository (repo "mbeacom/adrkit-azure", "payments") and cannot apply in a single-repository corpus; adr check and adr explain skip them, and they are kept for a federation that includes that repository.',
        path: 'docs/adr/0056-repo.md',
        id: '0056',
        field: 'affects',
      },
    ]);
    expect(exitCodeForFindings(findings)).toBe(0);
  });

  test('a single qualified matcher reads in the singular', () => {
    const [finding] = validateAffectsRepoQualifiers([
      record('0001', [{ type: 'path', pattern: 'src/**', repo: 'payments' }]),
    ]);
    expect(finding?.message).toStartWith('1 affects matcher is qualified with another repository (repo "payments")');
  });

  test('records without repo-qualified matchers produce nothing', () => {
    expect(validateAffectsRepoQualifiers([record('0001', [{ type: 'path', pattern: 'src/**' }])])).toEqual([]);
  });
});

describe('checkChanges passes the member through', () => {
  test('no member: the advisory, no governing record, ok; a member naming the repo: governed', async () => {
    const { checkChanges } = await import('../src/check/index.ts');
    const records = [record('0001', [{ type: 'path', pattern: 'src/**', repo: 'payments' }])];
    const lint = { checked: 1, findings: [], records };

    const single = checkChanges({ lint, changedFiles: ['src/a.ts'] });
    expect(single.governing).toEqual([]);
    expect(single.ok).toBe(true);
    expect(single.findings.map((finding) => finding.rule)).toEqual(['affects-repo-not-applicable']);

    const federated = checkChanges({ lint, changedFiles: ['src/a.ts'], member: { log: 'payments', repo: 'acme/payments' } });
    expect(federated.governing.map((decision) => decision.recordId)).toEqual(['0001']);
    expect(federated.findings).toEqual([]);
  });
});
