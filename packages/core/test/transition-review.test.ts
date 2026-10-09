import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  approveAdrSource,
  objectAdrSource,
  parseFrontmatter,
  resolveObjectionAdrSource,
  MAX_OBJECTION_SUMMARY_LENGTH,
} from '@adrkit/core';
import { finishSplice, locateFrontmatter } from '../src/transition/splice.ts';

const PATH = 'docs/adr/0007-adopt.md';

function record(lines: { status?: string; review?: string; extra?: string } = {}): string {
  return [
    '---',
    'schemaVersion: 0.2.0',
    'id: "0007"',
    'title: "Adopt a thing"',
    `status: ${lines.status ?? 'proposed'}`,
    'date: 2026-09-01',
    'deciders: ["@alice"]',
    'tags: [cli]',
    'scope: component',
    'reversibility: two-way-door',
    'blastRadius: component',
    'affects: []',
    'provenance:',
    '  authoredBy: agent-drafted',
    ...(lines.review ? [lines.review] : []),
    ...(lines.extra ? [lines.extra] : []),
    '---',
    '',
    '# ADR-0007: Adopt a thing',
    '',
  ].join('\n');
}

const approve = (source: string, by = '@bob') => approveAdrSource({ source, by, path: PATH });
const object = (source: string, by = '@dan', summary = 'Needs a cost estimate') =>
  objectAdrSource({ source, by, summary, path: PATH });
const resolveObjection = (source: string, objection = 1, by = '@dan') =>
  resolveObjectionAdrSource({ source, by, objection, path: PATH });

function review(content: string): Record<string, any> {
  return (parseFrontmatter(content).data as Record<string, any>).review;
}

/** Everything except `review` parses identically before and after. */
function restOf(content: string): Record<string, unknown> {
  const { review: _review, ...rest } = parseFrontmatter(content).data as Record<string, unknown>;
  return rest;
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

/** Each splice shape, as the `review:` block (or its absence) of a proposed record. */
const SHAPES: Record<string, { review?: string; extra?: string }> = {
  'review absent': {},
  'review with other keys': { review: 'review:\n  tier: async\n  slaDays: 5' },
  'block lists': {
    review: 'review:\n  tier: async\n  approvals:\n    - "@erin"\n  objections:\n    - by: "@dan"\n      summary: Earlier\n      resolved: true',
  },
  'empty flow lists': { review: 'review:\n  approvals: []\n  objections: []\n  tier: async' },
  'flow lists with items': {
    review: 'review:\n  approvals: ["@erin", "@frank"]\n  objections: [{ by: "@dan", summary: Earlier, resolved: true }]',
  },
  'comments near the block': {
    review:
      'review:\n  # routing\n  tier: async\n  approvals:\n    - "@erin" # first\n    # trailing note\n  objections:\n    - by: "@dan"\n      resolved: true\n    # after the objections\n# a top-level comment',
    extra: 'reviewBy: 2027-01-01',
  },
};

describe('approveAdrSource', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    test(`adds the approval and changes nothing else: ${name}`, () => {
      const source = record(shape);
      const before = review(source)?.approvals ?? [];
      const result = ok(approve(source));
      expect(result.changed).toBe(true);
      expect(review(result.content).approvals).toEqual([...before, '@bob']);
      expect(result.approvals).toBe(before.length + 1);
      expect(restOf(result.content)).toEqual(restOf(source));
      const { approvals: _a, ...otherReview } = review(result.content);
      const { approvals: _b, ...otherBefore } = review(source) ?? {};
      expect(otherReview).toEqual(otherBefore);
      expect(result.content.endsWith('# ADR-0007: Adopt a thing\n')).toBe(true);
    });
  }

  test('appends a block item at the existing indent, after a trailing comment', () => {
    const result = ok(approve(record(SHAPES['comments near the block']!)));
    expect(result.content).toContain('    - "@erin" # first\n    - "@bob"\n    # trailing note\n  objections:');
  });

  test('appends inside a flow list and keeps it a flow list', () => {
    expect(ok(approve(record(SHAPES['empty flow lists']!))).content).toContain('  approvals: ["@bob"]\n');
    expect(ok(approve(record(SHAPES['flow lists with items']!))).content).toContain('  approvals: ["@erin", "@frank", "@bob"]\n');
  });

  test('creates the review block when it is absent', () => {
    expect(ok(approve(record())).content).toContain('  authoredBy: agent-drafted\nreview:\n  approvals:\n    - "@bob"\n---\n');
  });

  test('preserves CRLF line endings', () => {
    for (const shape of Object.values(SHAPES)) {
      const result = ok(approve(record(shape).replace(/\n/g, '\r\n')));
      expect(result.content.replace(/\r\n/g, '')).not.toContain('\n');
    }
  });

  test('is a no-op when the identity has already approved', () => {
    const source = record(SHAPES['block lists']!);
    const result = ok(approve(source, '@erin'));
    expect(result).toEqual({ ok: true, changed: false, content: source, approvals: 1 });
    const once = ok(approve(source)).content;
    expect(ok(approve(once))).toMatchObject({ changed: false, content: once });
  });
});

describe('objectAdrSource', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    test(`appends an unresolved objection and changes nothing else: ${name}`, () => {
      const source = record(shape);
      const before = review(source)?.objections ?? [];
      const result = ok(object(source));
      expect(result.changed).toBe(true);
      expect(result.objection).toBe(before.length + 1);
      expect(review(result.content).objections).toEqual([
        ...before,
        { by: '@dan', summary: 'Needs a cost estimate', resolved: false },
      ]);
      expect(restOf(result.content)).toEqual(restOf(source));
    });
  }

  test('writes the summary as a quoted scalar, whatever it contains', () => {
    const summary = `#1: "quotes", 'apostrophes', key: value, - dash, [flow], {map}, & * ! | > % @ \` \\ ünï`;
    const result = ok(object(record(), '@dan', summary));
    expect(review(result.content).objections[0].summary).toBe(summary);
    expect(result.content).toContain(`      summary: ${JSON.stringify(summary)}\n`);
  });

  test('appends a block item with the corpus layout', () => {
    expect(ok(object(record(SHAPES['block lists']!))).content).toContain(
      '      resolved: true\n    - by: "@dan"\n      summary: "Needs a cost estimate"\n      resolved: false\n---',
    );
  });

  test('preserves CRLF line endings', () => {
    for (const shape of Object.values(SHAPES)) {
      const result = ok(object(record(shape).replace(/\n/g, '\r\n')));
      expect(result.content.replace(/\r\n/g, '')).not.toContain('\n');
    }
  });

  test('is a no-op when the same person already raised the same unresolved objection', () => {
    const once = ok(object(record())).content;
    expect(ok(object(once))).toEqual({ ok: true, changed: false, content: once, objection: 1 });
    expect(ok(object(once, '@dan', 'A different concern'))).toMatchObject({ changed: true, objection: 2 });
  });

  test('refuses an empty, multiline, control-character, or overlong summary', () => {
    const source = record();
    for (const summary of ['', '   ', 'two\nlines', 'cr\rhere', 'tab\there', 'bell\u0007', 'sep\u2028arator', 'x'.repeat(MAX_OBJECTION_SUMMARY_LENGTH + 1)]) {
      expect(object(source, '@dan', summary)).toMatchObject({ ok: false, code: 'invalid-summary' });
    }
    expect(ok(object(source, '@dan', 'é'.repeat(MAX_OBJECTION_SUMMARY_LENGTH))).changed).toBe(true);
  });
});

describe('resolveObjectionAdrSource', () => {
  const OPEN: Record<string, string> = {
    'block item without resolved': 'review:\n  objections:\n    - by: "@dan"\n      summary: Needs a cost estimate\n  tier: async',
    'block item with resolved: false': 'review:\n  objections:\n    - by: "@erin"\n      resolved: true\n    - by: "@dan"\n      resolved: false',
    'flow item without resolved': 'review:\n  objections: [{ by: "@dan", summary: Needs work }]',
    'flow item with resolved: false': 'review:\n  objections: [{ by: "@dan", resolved: false }]',
    'comments near the block': 'review:\n  objections:\n    # the objection\n    - by: "@dan" # objector\n      summary: Needs work\n    # trailing\n# top-level',
  };

  for (const [name, block] of Object.entries(OPEN)) {
    test(`resolves the objection and changes nothing else: ${name}`, () => {
      const source = record({ review: block, extra: 'reviewBy: 2027-01-01' });
      const objections = review(source).objections as Array<Record<string, unknown>>;
      const index = objections.findIndex((objection) => objection.by === '@dan') + 1;
      const result = ok(resolveObjectionAdrSource({ source, by: '@dan', objection: index, path: PATH }));
      expect(result.changed).toBe(true);
      const after = review(result.content).objections as Array<Record<string, unknown>>;
      expect(after).toEqual(objections.map((objection, i) => (i === index - 1 ? { ...objection, resolved: true } : objection)));
      expect(restOf(result.content)).toEqual(restOf(source));
      // And again with CRLF.
      const crlf = ok(resolveObjectionAdrSource({ source: source.replace(/\n/g, '\r\n'), by: '@dan', objection: index, path: PATH }));
      expect(crlf.content.replace(/\r\n/g, '')).not.toContain('\n');
    });
  }

  test('inserts resolved: true at the item’s own indent', () => {
    const result = ok(resolveObjection(record({ review: OPEN['block item without resolved'] })));
    expect(result.content).toContain('    - by: "@dan"\n      summary: Needs a cost estimate\n      resolved: true\n  tier: async');
  });

  test('round-trips with objectAdrSource', () => {
    for (const shape of Object.values(SHAPES)) {
      const objected = ok(object(record(shape)));
      const resolved = ok(resolveObjection(objected.content, objected.objection));
      expect(review(resolved.content).objections.at(-1)).toEqual({ by: '@dan', summary: 'Needs a cost estimate', resolved: true });
    }
  });

  test('is a no-op when the objection is already resolved', () => {
    const source = record({ review: OPEN['block item with resolved: false'] });
    const once = ok(resolveObjection(source, 2)).content;
    expect(ok(resolveObjection(once, 2))).toEqual({ ok: true, changed: false, content: once });
  });

  test('only the objector may resolve, and the index must exist', () => {
    const source = record({ review: OPEN['block item with resolved: false'] });
    expect(resolveObjection(source, 2, '@erin')).toMatchObject({ ok: false, code: 'not-objector' });
    expect(resolveObjection(source, 3)).toMatchObject({ ok: false, code: 'objection-not-found' });
    expect(resolveObjection(record())).toMatchObject({ ok: false, code: 'objection-not-found' });
    for (const index of [0, -1, 1.5, Number.NaN]) {
      expect(resolveObjection(source, index)).toMatchObject({ ok: false, code: 'invalid-objection-index' });
    }
  });
});

describe('refusals leave the source untouched', () => {
  const refusals: Array<[string, () => { ok: boolean; code?: string }, string]> = [
    ['approve: not proposed', () => approve(record({ status: 'draft' })), 'not-proposed'],
    ['object: not proposed', () => object(record({ status: 'rejected' })), 'not-proposed'],
    ['resolve: not proposed', () => resolveObjection(record({ status: 'draft', review: 'review:\n  objections:\n    - by: "@dan"' })), 'not-proposed'],
    ['approve: bad identity', () => approve(record(), 'bob'), 'invalid-identity'],
    ['object: bad identity', () => object(record(), 'dan'), 'invalid-identity'],
    ['resolve: bad identity', () => resolveObjection(record(), 1, 'dan'), 'invalid-identity'],
    ['approve: flow review', () => approve(record({ review: 'review: { tier: async }' })), 'unsupported-layout'],
    ['object: flow review', () => object(record({ review: 'review: { tier: async }' })), 'unsupported-layout'],
    ['resolve: flow review', () => resolveObjection(record({ review: 'review: { objections: [{ by: "@dan" }] }' })), 'unsupported-layout'],
    ['approve: BOM', () => approve(`﻿${record()}`), 'invalid-record'],
    ['object: BOM', () => object(`﻿${record()}`), 'invalid-record'],
    ['resolve: BOM', () => resolveObjection(`﻿${record({ review: 'review:\n  objections:\n    - by: "@dan"' })}`), 'invalid-record'],
    ['approve: invalid record', () => approve(record().replace('scope: component', 'scope: galaxy')), 'invalid-record'],
  ];
  for (const [name, run, code] of refusals) {
    test(name, () => {
      const result = run();
      expect(result).toMatchObject({ ok: false, code });
      expect('content' in result).toBe(false);
    });
  }
});

describe('the re-parse guard', () => {
  test('refuses a splice that changes another field, and one that no longer parses', () => {
    const source = record();
    const located = locateFrontmatter(source);
    const data = parseFrontmatter(source).data as Record<string, unknown>;
    const expected = { ...data, review: { approvals: ['@bob'] } };
    const base = { source, located, expected, path: PATH, owned: 'review.approvals', resultNoun: 'a valid record', id: '0007' };
    const titleAt = located.yaml.indexOf('"Adopt a thing"');
    const correct = { start: located.yaml.length, end: located.yaml.length, text: 'review:\n  approvals:\n    - "@bob"\n' };
    expect(finishSplice({ ...base, edits: [correct] }).ok).toBe(true);
    expect(
      finishSplice({ ...base, edits: [correct, { start: titleAt, end: titleAt + 15, text: '"Adopt another"' }] }),
    ).toMatchObject({ ok: false, code: 'unsupported-layout' });
    expect(finishSplice({ ...base, edits: [{ ...correct, text: 'review:\n  approvals:\n  - "@bob\n' }] })).toMatchObject({
      ok: false,
      code: 'unsupported-layout',
    });
  });
});

describe('across every record in this corpus', () => {
  test('approve, object, and resolve never change a field they do not own', () => {
    // Real layouts — flow arrays, folded scalars, comments, nested maps. Each record
    // is rolled back to `proposed`; records that are then invalid (a superseded one
    // keeps supersededBy) are skipped.
    const dir = resolve(import.meta.dir, '../../../docs/adr');
    const files = readdirSync(dir).filter((file) => /^\d{4}-.+\.md$/.test(file));
    let exercised = 0;
    for (const file of files) {
      const proposed = readFileSync(join(dir, file), 'utf8').replace(/^status: \w+$/m, 'status: proposed');
      const approved = approveAdrSource({ source: proposed, by: '@zed-reviewer', path: file });
      if (!approved.ok && approved.code === 'invalid-record') continue;
      if (!approved.ok) throw new Error(`${file}: ${approved.code}: ${approved.message}`);
      const objected = objectAdrSource({ source: approved.content, by: '@zed-reviewer', summary: 'A concern', path: file });
      if (!objected.ok) throw new Error(`${file}: ${objected.code}: ${objected.message}`);
      const resolved = resolveObjectionAdrSource({ source: objected.content, by: '@zed-reviewer', objection: objected.objection, path: file });
      if (!resolved.ok) throw new Error(`${file}: ${resolved.code}: ${resolved.message}`);
      const lines = (text: string) => text.split('\n');
      const removed = lines(proposed).filter((line) => !lines(resolved.content).includes(line));
      // At most one rewritten line per list key.
      expect({ file, removed: removed.length <= 2 }).toEqual({ file, removed: true });
      // The whole file: the body byte for byte, and the frontmatter equal to the
      // original plus exactly the approval and the resolved objection.
      const before = parseFrontmatter(proposed);
      const after = parseFrontmatter(resolved.content);
      expect({ file, body: after.body }).toEqual({ file, body: before.body });
      const expected = structuredClone(before.data) as Record<string, any>;
      expected.review ??= {};
      expected.review.approvals = [...(expected.review.approvals ?? []), '@zed-reviewer'];
      expected.review.objections = [...(expected.review.objections ?? []), { by: '@zed-reviewer', summary: 'A concern', resolved: true }];
      expect({ file, data: after.data }).toEqual({ file, data: expected });
      expect(resolved.content.startsWith(proposed.slice(0, proposed.indexOf('\n') + 1))).toBe(true);
      exercised += 1;
    }
    expect(exercised).toBeGreaterThan(20);
  });
});

describe('round 1: identities compare case-insensitively (ADR-0051)', () => {
  test('approve is a no-op for a case variant of an existing approval', () => {
    const source = record({ review: 'review:\n  approvals: ["@bob", "Eve@Example.com"]' });
    expect(ok(approve(source, '@Bob'))).toEqual({ ok: true, changed: false, content: source, approvals: 2 });
    expect(ok(approve(source, 'eve@example.COM'))).toMatchObject({ changed: false });
    expect(ok(approve(source, '@bobby'))).toMatchObject({ changed: true, approvals: 3 });
  });

  test('approvals counts distinct identities', () => {
    const source = record({ review: 'review:\n  approvals: ["@bob", "@Bob"]' });
    expect(ok(approve(source, '@carol'))).toMatchObject({ changed: true, approvals: 2 });
  });

  test('object is a no-op for a case variant of the same open objection', () => {
    const once = ok(object(record(), '@dan')).content;
    expect(ok(object(once, '@DAN'))).toEqual({ ok: true, changed: false, content: once, objection: 1 });
  });

  test('the objector may resolve under a case variant of their identity', () => {
    const source = record({ review: 'review:\n  objections:\n    - by: "@dan"' });
    expect(ok(resolveObjection(source, 1, '@Dan')).changed).toBe(true);
    expect(resolveObjection(source, 1, '@danny')).toMatchObject({ ok: false, code: 'not-objector' });
  });
});

describe('round 1: invisible and control characters are refused', () => {
  test('in a summary: bidi overrides, zero-width characters, and the BOM', () => {
    for (const summary of ['rtl \u202e evil', 'zero\u200bwidth', 'join\u200dme', 'bom\ufeff', 'isolate\u2066x', 'nel\u0085']) {
      expect({ summary, result: object(record(), '@dan', summary) }).toMatchObject({ summary, result: { ok: false, code: 'invalid-summary' } });
    }
  });

  test('in an identity, for all three commands', () => {
    for (const by of ['x\u001b[31m@c.de', 'x\u202e@c.de', 'x\u200b@c.de', 'x\u0000@c.de']) {
      expect(approve(record(), by)).toMatchObject({ ok: false, code: 'invalid-identity' });
      expect(object(record(), by)).toMatchObject({ ok: false, code: 'invalid-identity' });
      expect(resolveObjection(record(), 1, by)).toMatchObject({ ok: false, code: 'invalid-identity' });
    }
  });

  test('the length cap applies after trimming', () => {
    const result = ok(object(record(), '@dan', `  ${'x'.repeat(MAX_OBJECTION_SUMMARY_LENGTH)}  `));
    expect(review(result.content).objections[0].summary).toBe('x'.repeat(MAX_OBJECTION_SUMMARY_LENGTH));
    expect(object(record(), '@dan', 'x'.repeat(MAX_OBJECTION_SUMMARY_LENGTH + 1))).toMatchObject({ ok: false, code: 'invalid-summary' });
  });
});

describe('round 1: layouts that used to be refused', () => {
  const dashNested = 'review:\n  objections:\n    -\n      by: "@dan"\n      summary: a\n    -\n      by: "@eve"\n      summary: b';

  test('resolve finds the dash line of a `-` on its own line', () => {
    const source = record({ review: dashNested });
    const first = ok(resolveObjectionAdrSource({ source, by: '@dan', objection: 1, path: PATH }));
    expect(review(first.content).objections).toEqual([
      { by: '@dan', summary: 'a', resolved: true },
      { by: '@eve', summary: 'b' },
    ]);
    const second = ok(resolveObjectionAdrSource({ source, by: '@eve', objection: 2, path: PATH }));
    expect(review(second.content).objections[1]).toEqual({ by: '@eve', summary: 'b', resolved: true });
    expect(ok(object(source)).changed).toBe(true);
  });

  test('a literal block whose content has a # line is not split', () => {
    const source = record({ review: 'review:\n  objections:\n    - by: "@erin"\n      resolved: false\n      summary: |\n        line\n        # not a comment' });
    const result = ok(object(source));
    expect(review(result.content).objections[0].summary).toBe('line\n# not a comment\n');
    expect(ok(resolveObjectionAdrSource({ source, by: '@erin', objection: 1, path: PATH })).changed).toBe(true);
    const noResolved = record({ review: 'review:\n  objections:\n    - by: "@erin"\n      summary: |\n        line\n        # not a comment' });
    expect(ok(resolveObjectionAdrSource({ source: noResolved, by: '@erin', objection: 1, path: PATH })).changed).toBe(true);
  });

  test('a keep-chomped scalar with trailing blank lines keeps them', () => {
    // A keep scalar as the last key of `review`, and as the last key of the last block.
    const inReview = record({ review: 'review:\n  tier: async\n  tierReason: |+\n    why\n\n' });
    const result = ok(approve(inReview));
    expect(review(inReview).tierReason).toMatch(/^why\n\n+$/);
    expect(review(result.content).tierReason).toBe(review(inReview).tierReason);
    expect(review(result.content).approvals).toEqual(['@bob']);
    const topLevel = record().replace('  authoredBy: agent-drafted\n', '  authoredBy: agent-drafted\n  sourceArtifact: |+\n    line\n\n\n');
    const top = ok(approve(topLevel));
    expect((parseFrontmatter(top.content).data as any).provenance.sourceArtifact).toBe('line\n\n\n');
    expect(ok(object(topLevel)).changed).toBe(true);
  });
});
