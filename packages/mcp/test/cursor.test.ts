import { describe, expect, test } from 'bun:test';
import {
  encodeCursor,
  verifyCursor,
  paginate,
  checkInapplicablePrimaryCursor,
  queryShapeHash,
  type CursorScope,
} from '../src/pagination/cursor.ts';
import { walkChannel } from './helpers.ts';

const FP = 'a'.repeat(64);
const QH = 'b'.repeat(64);
const ALL_SCOPES: CursorScope[] = [
  'search.results',
  'search.findings',
  'get_decision.candidates',
  'get_decision.findings',
  'context.results',
  'context.findings',
  'superseded.results',
  'superseded.findings',
];

function mint(scope: CursorScope, offset: number, fp = FP, qh = QH): string {
  return encodeCursor({ v: 1, scope, fp, qh, offset });
}

function failReason(result: { ok: boolean } & Record<string, unknown>): unknown {
  return result.ok ? 'ok' : result.reason;
}

describe('cursor wire format', () => {
  test('encodes fixed-field-order base64url V1 with no padding or whitespace', () => {
    const cursor = mint('search.results', 3);
    expect(cursor).not.toContain('=');
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    expect(json).toBe(`{"v":1,"scope":"search.results","fp":"${FP}","qh":"${QH}","offset":3}`);
  });

  test('is deterministic for identical payloads', () => {
    expect(mint('search.results', 3)).toBe(mint('search.results', 3));
  });

  test('round-trips through verifyCursor for all eight scopes', () => {
    for (const scope of ALL_SCOPES) {
      const result = verifyCursor({ cursor: mint(scope, 7), expectedScope: scope, fp: FP, qh: QH });
      expect(result).toEqual({ ok: true, offset: 7 });
    }
  });
});

describe('verifyCursor decode/verify order', () => {
  test('decode-failed on garbage', () => {
    expect(verifyCursor({ cursor: '!!!not-base64!!!', expectedScope: 'search.results', fp: FP, qh: QH })).toEqual({
      ok: false,
      reason: 'decode-failed',
    });
  });

  test('decode-failed on offset 0, negative, or non-safe', () => {
    for (const offset of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      const raw = Buffer.from(JSON.stringify({ v: 1, scope: 'search.results', fp: FP, qh: QH, offset })).toString(
        'base64url',
      );
      expect(verifyCursor({ cursor: raw, expectedScope: 'search.results', fp: FP, qh: QH }).ok).toBe(false);
    }
  });

  test('decode-failed on unknown keys / missing keys', () => {
    const extra = Buffer.from(JSON.stringify({ v: 1, scope: 'search.results', fp: FP, qh: QH, offset: 1, x: 1 })).toString('base64url');
    expect(failReason(verifyCursor({ cursor: extra, expectedScope: 'search.results', fp: FP, qh: QH }))).toBe('decode-failed');
  });

  test('version-unsupported for a future v', () => {
    const raw = Buffer.from(JSON.stringify({ v: 2, scope: 'search.results', fp: FP, qh: QH, offset: 1 })).toString('base64url');
    expect(failReason(verifyCursor({ cursor: raw, expectedScope: 'search.results', fp: FP, qh: QH }))).toBe(
      'version-unsupported',
    );
  });

  test('wrong-channel when scope differs from the input field', () => {
    expect(failReason(verifyCursor({ cursor: mint('search.findings', 1), expectedScope: 'search.results', fp: FP, qh: QH }))).toBe(
      'wrong-channel',
    );
    // a different tool's channel entirely
    expect(failReason(verifyCursor({ cursor: mint('superseded.results', 1), expectedScope: 'search.results', fp: FP, qh: QH }))).toBe(
      'wrong-channel',
    );
  });

  test('corpus-changed when fp mismatches', () => {
    expect(failReason(verifyCursor({ cursor: mint('search.results', 1, 'c'.repeat(64)), expectedScope: 'search.results', fp: FP, qh: QH }))).toBe(
      'corpus-changed',
    );
  });

  test('query-mismatch when qh mismatches', () => {
    expect(failReason(verifyCursor({ cursor: mint('search.results', 1, FP, 'd'.repeat(64)), expectedScope: 'search.results', fp: FP, qh: QH }))).toBe(
      'query-mismatch',
    );
  });

  test('fp is checked before qh (corpus-changed wins when both differ)', () => {
    const cursor = mint('search.results', 1, 'c'.repeat(64), 'd'.repeat(64));
    expect(failReason(verifyCursor({ cursor, expectedScope: 'search.results', fp: FP, qh: QH }))).toBe('corpus-changed');
  });
});

describe('paginate (applicable channel)', () => {
  const items = [0, 1, 2, 3, 4];
  const base = { scope: 'search.results' as const, fp: FP, qh: QH, limit: 2 };

  test('first page (no cursor) mints a continuation cursor', () => {
    const result = paginate({ items, cursor: undefined, ...base });
    expect(result).toEqual({ ok: true, page: { items: [0, 1], cursor: expect.any(String) } });
  });

  test('a lossless walk returns every item exactly once', async () => {
    const collected = await walkChannel<number>(async (cursor) => {
      const result = paginate({ items, cursor, ...base });
      if (!result.ok) throw new Error(result.reason);
      return result.page;
    });
    expect(collected).toEqual([0, 1, 2, 3, 4]);
  });

  test('the final page has a null cursor', () => {
    const result = paginate({ items, cursor: mint('search.results', 4), ...base });
    expect(result.ok && result.page.cursor).toBeNull();
    expect(result.ok && result.page.items).toEqual([4]);
  });

  test('offset-out-of-range when offset >= length', () => {
    const result = paginate({ items, cursor: mint('search.results', 5), ...base });
    expect(result).toEqual({ ok: false, reason: 'offset-out-of-range' });
  });

  test('an empty channel with no cursor is a single null-cursor page', () => {
    const result = paginate({ items: [], cursor: undefined, ...base });
    expect(result).toEqual({ ok: true, page: { items: [], cursor: null } });
  });
});

describe('checkInapplicablePrimaryCursor (step 7)', () => {
  test('a well-formed, correctly-scoped cursor with no channel is cursor-not-applicable', () => {
    expect(
      checkInapplicablePrimaryCursor({ cursor: mint('get_decision.candidates', 2), scope: 'get_decision.candidates', fp: FP, qh: QH }),
    ).toEqual({ ok: false, reason: 'cursor-not-applicable' });
  });

  test('no cursor supplied is fine (nothing to resume)', () => {
    expect(
      checkInapplicablePrimaryCursor({ cursor: undefined, scope: 'get_decision.candidates', fp: FP, qh: QH }),
    ).toEqual({ ok: true });
  });

  test('a cursor that fails an earlier step reports that earlier reason, not cursor-not-applicable', () => {
    expect(
      checkInapplicablePrimaryCursor({ cursor: mint('get_decision.candidates', 2, 'c'.repeat(64)), scope: 'get_decision.candidates', fp: FP, qh: QH }),
    ).toEqual({ ok: false, reason: 'corpus-changed' });
  });
});

describe('queryShapeHash', () => {
  test('is a deterministic 64-hex digest', () => {
    expect(queryShapeHash(['a', ['b'], 20])).toMatch(/^[0-9a-f]{64}$/);
    expect(queryShapeHash(['a', ['b'], 20])).toBe(queryShapeHash(['a', ['b'], 20]));
  });

  test('changes when any hashed parameter changes', () => {
    expect(queryShapeHash(['a', 20])).not.toBe(queryShapeHash(['a', 50]));
  });
});
