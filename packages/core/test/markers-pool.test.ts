import { describe, expect, test } from 'bun:test';
import { MARKER_SCAN_CONCURRENCY } from '../src/markers/index.ts';
import { mapConcurrent } from '../src/markers/pool.ts';

describe('marker scan worker pool', () => {
  test('never exceeds the fixed concurrency and preserves input order', async () => {
    const items = Array.from({ length: MARKER_SCAN_CONCURRENCY * 3 }, (_, index) => index);
    let active = 0;
    let maximum = 0;

    const results = await mapConcurrent(items, MARKER_SCAN_CONCURRENCY, async (item) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Bun.sleep(item % 3);
      active -= 1;
      return `item-${item}`;
    });

    expect(maximum).toBe(MARKER_SCAN_CONCURRENCY);
    expect(results).toEqual(items.map((item) => `item-${item}`));
  });

  test('preserves input order when each concurrency window finishes in reverse order', async () => {
    const items = Array.from({ length: MARKER_SCAN_CONCURRENCY * 2 }, (_, index) => index);

    const results = await mapConcurrent(items, MARKER_SCAN_CONCURRENCY, async (item) => {
      await Bun.sleep(MARKER_SCAN_CONCURRENCY - (item % MARKER_SCAN_CONCURRENCY));
      return `result-${item}`;
    });

    expect(results).toEqual(items.map((item) => `result-${item}`));
  });
});
