import { describe, expect, test } from 'bun:test';
import { CLI_PIN_PATTERN, findStalePins, type DocFile } from './check-doc-cli-versions.ts';

const doc = (text: string, path = 'site/src/content/docs/badges.mdx'): DocFile => ({ path, text });

describe('findStalePins', () => {
  test('accepts an executable pin that matches the current release', () => {
    expect(findStalePins([doc('npx @adrkit/cli@0.6.0 queue --format json')], '0.6.0')).toEqual([]);
  });

  test('rejects a stale executable pin', () => {
    const stale = findStalePins([doc('npx @adrkit/cli@0.5.0 queue')], '0.6.0');
    expect(stale).toEqual([
      { path: 'site/src/content/docs/badges.mdx', found: '0.5.0', expected: '0.6.0' },
    ]);
  });

  // The original guard matched `\d+\.\d+\.\d+`, so it found the `0.6.0` inside
  // `0.6.0-rc.1` and passed. Anchoring that pattern made the token stop matching
  // entirely, which also passed. Both shipped before being caught by running it.
  test('rejects a pre-release pin rather than matching its release prefix', () => {
    const stale = findStalePins([doc('npx @adrkit/cli@0.6.0-rc.1 queue')], '0.6.0');
    expect(stale).toHaveLength(1);
    expect(stale[0]?.found).toBe('0.6.0-rc.1');
  });

  test('rejects an unpinned dist-tag', () => {
    expect(findStalePins([doc('npx @adrkit/cli@latest queue')], '0.6.0')[0]?.found).toBe('latest');
  });

  // A guard that cannot tell a recipe from prose blocks the first upgrade note
  // anyone writes.
  test('ignores prose that names an older release', () => {
    const prose = 'If you were on `@adrkit/cli@0.4.0`, re-run the recipe.';
    expect(findStalePins([doc(prose)], '0.6.0')).toEqual([]);
  });

  test('guards a bunx invocation the same as npx', () => {
    expect(findStalePins([doc('bunx @adrkit/cli@0.5.0 queue')], '0.6.0')).toHaveLength(1);
  });

  test('reports every stale pin, not just the first', () => {
    const text = 'npx @adrkit/cli@0.5.0 queue\nlater\nbunx @adrkit/cli@0.4.0 lint';
    expect(findStalePins([doc(text)], '0.6.0').map((s) => s.found)).toEqual(['0.5.0', '0.4.0']);
  });

  test('reports the file each stale pin came from', () => {
    const stale = findStalePins(
      [doc('npx @adrkit/cli@0.5.0 x', 'site/src/content/docs/a.mdx'), doc('npx @adrkit/cli@0.6.0 x')],
      '0.6.0',
    );
    expect(stale.map((s) => s.path)).toEqual(['site/src/content/docs/a.mdx']);
  });

  test('is not stateful across calls despite the global regex', () => {
    const files = [doc('npx @adrkit/cli@0.5.0 queue')];
    expect(findStalePins(files, '0.6.0')).toHaveLength(1);
    expect(findStalePins(files, '0.6.0')).toHaveLength(1);
    expect(CLI_PIN_PATTERN.lastIndex).toBe(0);
  });
});
