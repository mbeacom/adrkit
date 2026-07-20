import { describe, expect, test } from 'bun:test';
import {
  matchPathPattern,
  parsePackagePattern,
  matchPackagePattern,
  type ChangedDependency,
} from '../src/affects/index.ts';

/**
 * The evaluator reuses core's neutral matcher grammar for `path` and `package`
 * target resolution instead of duplicating it (research §R4). These tests pin the
 * exact primitives the evaluator relies on: the repo-relative path-glob semantics
 * (dot segments, leading-slash and invalid-glob rejection) and the package pattern
 * parser over a complete dependency inventory.
 */

describe('path matcher primitive is reusable', () => {
  test('matches a repo-relative glob and normalizes ./ candidates', () => {
    expect(matchPathPattern('src/**/*.ts', ['src/a/b.ts']).matched).toBe(true);
    expect(matchPathPattern('src/**/*.ts', ['./src/a/b.ts']).matched).toBe(true);
    expect(matchPathPattern('src/**/*.ts', ['docs/a.md']).matched).toBe(false);
  });

  test('hidden (dot) segments only match when the pattern opts in', () => {
    expect(matchPathPattern('**/*.ts', ['.hidden/a.ts']).matched).toBe(false);
    expect(matchPathPattern('.hidden/**', ['.hidden/a.ts']).matched).toBe(true);
  });

  test('rejects a leading-slash pattern as not repo-relative', () => {
    expect(matchPathPattern('/etc/passwd', ['/etc/passwd'])).toEqual({
      matched: false,
      badPattern: 'leading-slash',
    });
  });

  test('never throws on odd glob input; degrades to no match', () => {
    // picomatch tolerates these, so the neutral primitive returns a non-throwing
    // no-match rather than a violation — the property the evaluator relies on.
    for (const pattern of ['src/[', 'src/[a-', '**/+(']) {
      const result = matchPathPattern(pattern, ['src/x']);
      expect(result.matched).toBe(false);
    }
  });
});

describe('package matcher primitive is reusable over a full inventory', () => {
  test('parses a bare name and a name@range', () => {
    expect(parsePackagePattern('react')).toEqual({ name: 'react' });
    expect(parsePackagePattern('react@>=19')).toEqual({ name: 'react', range: '>=19' });
  });

  test('rejects an invalid semver range', () => {
    expect(parsePackagePattern('react@not-a-range')).toBeUndefined();
  });

  test('matches a package against a complete dependency inventory with range semantics', () => {
    const inventory: readonly ChangedDependency[] = [
      { name: 'react', version: '19.2.0' },
      { name: 'zod', version: '4.4.3' },
    ];
    expect(matchPackagePattern('react@>=19', inventory).matched).toBe(true);
    expect(matchPackagePattern('react@<19', inventory).matched).toBe(false);
    expect(matchPackagePattern('left-pad', inventory).matched).toBe(false);
  });

  test('is inert (unresolvable) when no inventory is supplied', () => {
    expect(matchPackagePattern('react', undefined).unresolvable).toBe(true);
  });
});
