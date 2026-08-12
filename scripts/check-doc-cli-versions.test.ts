import { describe, expect, test } from 'bun:test';
import { cliPinPattern, findStalePins, type DocFile } from './check-doc-cli-versions.ts';

const doc = (text: string, path = 'site/src/content/docs/badges.mdx'): DocFile => ({ path, text });
const found = (text: string, expected = '0.6.0') => findStalePins([doc(text)], expected);

describe('findStalePins', () => {
  test('accepts an executable pin that matches the current release', () => {
    expect(found('npx @adrkit/cli@0.6.0 queue --format json')).toEqual([]);
  });

  test('rejects a stale executable pin', () => {
    expect(found('npx @adrkit/cli@0.5.0 queue')).toEqual([
      { path: 'site/src/content/docs/badges.mdx', raw: '0.5.0', found: '0.5.0', expected: '0.6.0' },
    ]);
  });

  // Regression 1. The first matcher was `\d+\.\d+\.\d+`, which found the `0.6.0`
  // inside `0.6.0-rc.1` and passed.
  test('rejects a pre-release pin rather than matching its release prefix', () => {
    expect(found('npx @adrkit/cli@0.6.0-rc.1 queue')[0]?.found).toBe('0.6.0-rc.1');
  });

  // Regression 2. The second matcher anchored with a negative lookahead, so the
  // pre-release token stopped matching at all — and a guard that sees nothing
  // reports nothing.
  test('does not let an unmatched shape become a silent pass', () => {
    expect(found('npx @adrkit/cli@0.6.0-rc.1 queue')).toHaveLength(1);
    expect(found('npx @adrkit/cli@latest queue')[0]?.found).toBe('latest');
  });

  // Regression 3. The capture class swallowed sentence punctuation, so a prose
  // line ending in a pin failed a REQUIRED check and blocked every merge.
  test.each([
    ['period', 'Run npx @adrkit/cli@0.6.0.'],
    ['comma', 'Run npx @adrkit/cli@0.6.0, then commit.'],
    ['closing paren', '(run npx @adrkit/cli@0.6.0)'],
    ['closing bracket', '[npx @adrkit/cli@0.6.0]'],
    ['backtick fence', 'Run `npx @adrkit/cli@0.6.0` now.'],
  ])('accepts a current pin followed by %s', (_label, text) => {
    expect(found(text)).toEqual([]);
  });

  test('still reports the version as written when a punctuated pin is stale', () => {
    const [stale] = found('Run npx @adrkit/cli@0.5.0.');
    expect(stale?.raw).toBe('0.5.0.');
    expect(stale?.found).toBe('0.5.0');
  });

  // Regression 4. `npx -y` is the common prompt-suppressing form and did not
  // match at all, so a stale pin written that way escaped the guard entirely.
  test.each([
    ['-y', 'npx -y @adrkit/cli@0.1.0 queue'],
    ['--yes', 'npx --yes @adrkit/cli@0.1.0 queue'],
    ['--no-install', 'npx --no-install @adrkit/cli@0.1.0 queue'],
  ])('guards a stale pin invoked with %s', (_label, text) => {
    expect(found(text)).toHaveLength(1);
  });

  test('accepts a current pin invoked with flags', () => {
    expect(found('npx -y @adrkit/cli@0.6.0 queue')).toEqual([]);
  });

  // A guard that cannot tell a recipe from prose blocks the first upgrade note
  // anyone writes.
  test('ignores prose that names an older release', () => {
    expect(found('If you were on `@adrkit/cli@0.4.0`, re-run the recipe.')).toEqual([]);
  });

  test('guards a bunx invocation the same as npx', () => {
    expect(found('bunx @adrkit/cli@0.5.0 queue')).toHaveLength(1);
  });

  test('reports every stale pin, not just the first', () => {
    const text = 'npx @adrkit/cli@0.5.0 queue\nx\nbunx @adrkit/cli@0.4.0 lint';
    expect(found(text).map((s) => s.found)).toEqual(['0.5.0', '0.4.0']);
  });

  test('reports the file each stale pin came from', () => {
    const stale = findStalePins(
      [doc('npx @adrkit/cli@0.5.0 x', 'site/src/content/docs/a.mdx'), doc('npx @adrkit/cli@0.6.0 x')],
      '0.6.0',
    );
    expect(stale.map((s) => s.path)).toEqual(['site/src/content/docs/a.mdx']);
  });
});

describe('cliPinPattern', () => {
  // Regression 5 (latent). `matchAll` seeds its matcher from the source regex's
  // `lastIndex`, so a shared global instance any caller had poked would start
  // mid-string and skip pins.
  test('hands out an independent matcher each call', () => {
    const a = cliPinPattern();
    a.exec('npx @adrkit/cli@0.5.0 queue');
    expect(a.lastIndex).toBeGreaterThan(0);
    expect(cliPinPattern().lastIndex).toBe(0);
  });

  test('scanning is unaffected by a previously advanced matcher', () => {
    const poked = cliPinPattern();
    poked.lastIndex = 21;
    const files = [doc('npx @adrkit/cli@0.5.0 queue')];
    expect(findStalePins(files, '0.6.0')).toHaveLength(1);
    expect(findStalePins(files, '0.6.0')).toHaveLength(1);
  });
});
