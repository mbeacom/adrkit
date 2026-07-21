import { describe, expect, test } from 'bun:test';
import { mapFindingToCorpusFinding, RULE_TO_CORPUS_CODE, type Finding } from '@adrkit/core';

const ONE_WAY_DOOR_MESSAGE =
  'one-way-door decisions may not take the auto-approve fast path (reversibility: one-way-door, review.tier: auto)';

function finding(rule: string, message: string): Finding {
  return { rule, severity: 'error', message, path: 'docs/adr/0001-x.md' };
}

describe('mapFindingToCorpusFinding', () => {
  test('file-read → corpus.read-error with "Cannot read file:" prefix', () => {
    const cf = mapFindingToCorpusFinding(finding('file-read', 'EACCES: permission denied'), 'docs/adr/0001-x.md');
    expect(cf).toEqual({
      sourcePath: 'docs/adr/0001-x.md',
      code: 'corpus.read-error',
      severity: 'error',
      message: 'Cannot read file: EACCES: permission denied',
    });
  });

  test('frontmatter-parse → corpus.parse-error, message passed through', () => {
    const cf = mapFindingToCorpusFinding(finding('frontmatter-parse', 'bad yaml'), 'docs/adr/0001-x.md');
    expect(cf.code).toBe('corpus.parse-error');
    expect(cf.message).toBe('bad yaml');
  });

  test('frontmatter-fence → corpus.parse-error, message passed through', () => {
    const cf = mapFindingToCorpusFinding(finding('frontmatter-fence', 'missing fence'), 'docs/adr/0001-x.md');
    expect(cf.code).toBe('corpus.parse-error');
    expect(cf.message).toBe('missing fence');
  });

  test('one-way-door-disallows-auto → corpus.one-way-door-auto-tier with canonical message', () => {
    const cf = mapFindingToCorpusFinding(
      finding('one-way-door-disallows-auto', 'one-way-door decisions may not take the auto-approve fast path'),
      'docs/adr/0001-x.md',
    );
    expect(cf.code).toBe('corpus.one-way-door-auto-tier');
    expect(cf.message).toBe(ONE_WAY_DOOR_MESSAGE);
  });

  test('invalid-enum-value → corpus.schema-invalid, message passed through', () => {
    const cf = mapFindingToCorpusFinding(finding('invalid-enum-value', 'Invalid enum'), 'docs/adr/0001-x.md');
    expect(cf.code).toBe('corpus.schema-invalid');
    expect(cf.message).toBe('Invalid enum');
  });

  test('required-field → corpus.schema-invalid', () => {
    expect(mapFindingToCorpusFinding(finding('required-field', 'x'), 'docs/adr/0001-x.md').code).toBe(
      'corpus.schema-invalid',
    );
  });

  test('unrecognized future rule falls back to corpus.schema-invalid (never undefined)', () => {
    const cf = mapFindingToCorpusFinding(finding('contract-xyz', 'novel rule'), 'docs/adr/0001-x.md');
    expect(cf.code).toBe('corpus.schema-invalid');
    expect(cf.message).toBe('novel rule');
  });

  test('always sets severity error and the provided sourcePath', () => {
    const cf = mapFindingToCorpusFinding(finding('invalid-type', 'x'), 'docs/adr/0007-y.md');
    expect(cf.severity).toBe('error');
    expect(cf.sourcePath).toBe('docs/adr/0007-y.md');
  });
});

describe('RULE_TO_CORPUS_CODE', () => {
  test('maps the four representative rules to their canonical codes', () => {
    expect(RULE_TO_CORPUS_CODE['file-read']).toBe('corpus.read-error');
    expect(RULE_TO_CORPUS_CODE['frontmatter-parse']).toBe('corpus.parse-error');
    expect(RULE_TO_CORPUS_CODE['frontmatter-fence']).toBe('corpus.parse-error');
    expect(RULE_TO_CORPUS_CODE['one-way-door-disallows-auto']).toBe('corpus.one-way-door-auto-tier');
    expect(RULE_TO_CORPUS_CODE['invalid-enum-value']).toBe('corpus.schema-invalid');
  });
});
