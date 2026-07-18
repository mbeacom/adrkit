import picomatch from 'picomatch';

export interface PathMatcherResult {
  matched: boolean;
  badPattern?: 'leading-slash' | 'invalid-glob';
}

function normalizeCandidate(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function hasDotSegment(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '..');
}

function patternAllowsDotSegment(pattern: string): boolean {
  return pattern.split('/').some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '..');
}

export function matchPathPattern(pattern: string, changedFiles: readonly string[]): PathMatcherResult {
  if (pattern.startsWith('/')) {
    return { matched: false, badPattern: 'leading-slash' };
  }

  try {
    const isMatch = picomatch(pattern, { dot: false, nocase: false, nonegate: true });
    const allowsDot = patternAllowsDotSegment(pattern);
    return {
      matched: changedFiles.some((path) => {
        const candidate = normalizeCandidate(path);
        return (!hasDotSegment(candidate) || allowsDot) && isMatch(candidate);
      }),
    };
  } catch {
    return { matched: false, badPattern: 'invalid-glob' };
  }
}
