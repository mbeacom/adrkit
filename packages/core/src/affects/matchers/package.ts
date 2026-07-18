import semver from 'semver';

export interface ChangedDependency {
  name: string;
  version: string;
}

export interface ParsedPackagePattern {
  name: string;
  range?: string;
}

export interface PackageMatcherResult {
  matched: boolean;
  unresolvable?: boolean;
  badPattern?: boolean;
}

export function parsePackagePattern(pattern: string): ParsedPackagePattern | undefined {
  const splitAt = pattern.lastIndexOf('@');
  const hasRange = splitAt > 0;
  const name = hasRange ? pattern.slice(0, splitAt) : pattern;
  const range = hasRange ? pattern.slice(splitAt + 1).trim() : undefined;

  if (!name.trim() || (hasRange && !range)) {
    return undefined;
  }

  if (range && !semver.validRange(range)) {
    return undefined;
  }

  return range ? { name, range } : { name };
}

export function matchPackagePattern(
  pattern: string,
  changedDependencies: readonly ChangedDependency[] | undefined,
): PackageMatcherResult {
  const parsed = parsePackagePattern(pattern);
  if (!parsed) {
    return { matched: false, badPattern: true };
  }

  if (!changedDependencies) {
    return { matched: false, unresolvable: true };
  }

  return {
    matched: changedDependencies.some(
      (dependency) =>
        dependency.name === parsed.name &&
        (!parsed.range || semver.satisfies(dependency.version, parsed.range)),
    ),
  };
}

function parseBunLockPackageLine(line: string): ChangedDependency | undefined {
  const match = line.match(/^\s*"([^"]+)":\s*\["([^"]+)"/);
  if (!match) return undefined;

  const [, name, descriptor] = match;
  if (!name || !descriptor?.startsWith(`${name}@`)) return undefined;

  const version = descriptor.slice(name.length + 1);
  if (!semver.valid(version)) return undefined;

  return { name, version };
}

/**
 * Derives the v1 package snapshot from a unified diff of `bun.lock`.
 * Only Bun's text lockfile package entries are supported.
 */
export function deriveChangedDependenciesFromBunLockDiff(diff: string): ChangedDependency[] {
  const added = new Map<string, Set<string>>();
  const removed = new Map<string, Set<string>>();

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    const bucket = line.startsWith('+') ? added : line.startsWith('-') ? removed : undefined;
    if (!bucket) continue;

    const dependency = parseBunLockPackageLine(line.slice(1));
    if (!dependency) continue;

    let versions = bucket.get(dependency.name);
    if (!versions) {
      versions = new Set<string>();
      bucket.set(dependency.name, versions);
    }
    versions.add(dependency.version);
  }

  const changedNames = new Set([...added.keys(), ...removed.keys()]);
  return [...changedNames]
    .flatMap((name) => {
      const versions = new Set([...(added.get(name) ?? []), ...(removed.get(name) ?? [])]);
      return [...versions].map((version) => ({ name, version }));
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
