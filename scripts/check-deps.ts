import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface DependencyViolation {
  packageName: string;
  packagePath: string;
  dependency: string;
  section: DependencySection;
  reason: string;
}

/**
 * The GitHub Action toolkit (and its Octokit tree) is permitted only in the
 * `@adrkit/ci` surface; it must never reach `@adrkit/core`, the schema, or the CLI
 * (ADR-0007 / R2 / R3). Matched by dependency name prefix on declared deps.
 */
const TOOLKIT_DEPENDENCY = /^(@actions\/|@octokit\/|octokit$)/;
const CI_SURFACE_PACKAGE = '@adrkit/ci';

/**
 * The Backstage SDK never enters this repository (ADR-0029 clause 3). The publication
 * surface is a downstream consumer in its own repository, because its dependency tree
 * measured 1,274 packages and 1.0 GB against this repository's 94 and 65 MB, and brought
 * the first two lifecycle scripts this graph would ever carry.
 *
 * A blanket prohibition rather than the confined allowlist an earlier draft proposed:
 * there is no exception to get wrong, and it fires on a package `allowedDependenciesFor`
 * has never heard of — which this file documents below as *silently unconstrained*, and
 * which an allowlist-keyed rule would therefore wave straight through.
 */
const BACKSTAGE_DEPENDENCY = /^@backstage\//;

export interface DependencyCheckResult {
  ok: boolean;
  violations: DependencyViolation[];
}

interface WorkspacePackage {
  packageJson: PackageJson;
  packagePath: string;
}

function displayPath(path: string): string {
  return path.split(sep).join('/');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function readPackageJson(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageJson;
}

async function readWorkspacePackages(root: string): Promise<WorkspacePackage[]> {
  const packages: WorkspacePackage[] = [];
  const packagesDir = join(root, 'packages');
  if (!(await pathExists(packagesDir))) return packages;

  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'adapters') {
      const adaptersDir = join(packagesDir, 'adapters');
      if (!(await pathExists(adaptersDir))) continue;
      for (const adapter of await readdir(adaptersDir, { withFileTypes: true })) {
        if (!adapter.isDirectory()) continue;
        const packagePath = join(adaptersDir, adapter.name, 'package.json');
        packages.push({ packagePath, packageJson: await readPackageJson(packagePath) });
      }
    } else {
      const packagePath = join(packagesDir, entry.name, 'package.json');
      packages.push({ packagePath, packageJson: await readPackageJson(packagePath) });
    }
  }

  return packages.sort((a, b) => a.packagePath.localeCompare(b.packagePath));
}

function isAdapterPackage(workspace: WorkspacePackage, root: string): boolean {
  return displayPath(relative(root, workspace.packagePath)).startsWith('packages/adapters/');
}

function allowedDependenciesFor(packageName: string): Record<DependencySection, Set<string>> | undefined {
  if (packageName === '@adrkit/core') {
    return {
      dependencies: new Set(['picomatch', 'semver', 'zod', 'yaml']),
      devDependencies: new Set(['@types/bun', '@types/picomatch', '@types/semver']),
      peerDependencies: new Set(),
      optionalDependencies: new Set(),
    };
  }

  if (packageName === '@adrkit/cli') {
    return {
      dependencies: new Set(['@adrkit/core', '@adrkit/evaluator']),
      devDependencies: new Set(['@types/bun']),
      peerDependencies: new Set(),
      optionalDependencies: new Set(),
    };
  }

  if (packageName === '@adrkit/evaluator') {
    // The evaluator surface may depend on core and the T002-approved deterministic
    // JSONPath engine only — never an adapter, model, toolkit, or network/fs client.
    return {
      dependencies: new Set(['@adrkit/core', 'jsonpath-rfc9535']),
      devDependencies: new Set(['@types/bun']),
      peerDependencies: new Set(),
      optionalDependencies: new Set(),
    };
  }

  if (packageName === '@adrkit/mcp') {
    // The MCP server surface may depend on core, the pinned Model Context Protocol
    // SDK server package, and zod only — never an adapter, GitHub toolkit, network/
    // auth/model/embedding/database/cache client, native addon, or worker helper
    // (R2/R10). The SDK client package is development-only: it drives the in-process
    // and real-stdio conformance harnesses and is never imported by shipped code.
    return {
      dependencies: new Set(['@adrkit/core', '@modelcontextprotocol/server', 'zod']),
      devDependencies: new Set(['@modelcontextprotocol/client', '@types/bun']),
      peerDependencies: new Set(),
      optionalDependencies: new Set(),
    };
  }

  if (packageName === CI_SURFACE_PACKAGE) {
    // The first-party CI surface may depend on core and the public GitHub Action
    // toolkit only — never an adapter (enforced separately below).
    return {
      dependencies: new Set(['@adrkit/core', '@actions/core', '@actions/github']),
      devDependencies: new Set(['@types/bun']),
      peerDependencies: new Set(),
      optionalDependencies: new Set(),
    };
  }

  if (packageName === '@adrkit/catalog-backstage') {
    // Feature 010's offline Backstage snapshot generator. The surface is frozen by
    // `specs/010-catalog-backstage/contracts/package-boundary.md` §2: core for
    // canonicalization primitives only (`canonicalStringify`, `compareCodeUnits` —
    // never the same-named function in the evaluator, which is a different
    // signature), plus `picomatch` for the restricted glob dialect and `yaml` for
    // descriptor decoding. Both registry dependencies are already resolved in the
    // committed lockfile, so neither adds a new registry surface.
    //
    // It must NOT reach `@adrkit/catalog-envelope`: the envelope file on disk is
    // the entire interface between generator and consumer (§3), and an import edge
    // would make the consumer's digest check compare the generator against itself.
    return {
      dependencies: new Set(['@adrkit/core', 'picomatch', 'yaml']),
      devDependencies: new Set(['@types/bun', '@types/picomatch']),
      peerDependencies: new Set(),
      optionalDependencies: new Set(),
    };
  }

  if (packageName === '@adrkit/catalog-envelope') {
    // Feature 010's envelope consumer — a non-adapter workspace library, which it
    // is by *location* (`packages/catalog-envelope/`, outside `packages/adapters/`)
    // rather than by any exception granted here; `isAdapterPackage()` above
    // classifies on the path prefix alone. It may reach core and nothing else, and
    // in particular never `@adrkit/catalog-backstage` (`package-boundary.md` §3).
    return {
      dependencies: new Set(['@adrkit/core']),
      devDependencies: new Set(['@types/bun']),
      peerDependencies: new Set(),
      optionalDependencies: new Set(),
    };
  }

  // Reached by any package with no entry above — and note what that means: the
  // allowed-surface guard below is then skipped entirely, so such a package is
  // *silently unconstrained* and passes `check:deps` no matter what it declares
  // (`package-boundary.md` §4). Omitting an entry does not produce a failure; it
  // produces a green check that means nothing. The only proof an entry is present
  // is to add a disallowed dependency and watch a violation appear, which is why
  // the two entries above each carry a negative case in `check-deps.test.ts`.
  return undefined;
}

export async function checkDependencyRules(root = process.cwd()): Promise<DependencyCheckResult> {
  const workspaces = await readWorkspacePackages(root);
  const adapterNames = new Set(
    workspaces
      .filter((workspace) => isAdapterPackage(workspace, root))
      .map((workspace) => workspace.packageJson.name)
      .filter((name): name is string => Boolean(name)),
  );
  const violations: DependencyViolation[] = [];

  for (const workspace of workspaces) {
    const packageName = workspace.packageJson.name ?? '(unnamed)';
    const packagePath = displayPath(relative(root, workspace.packagePath));
    const adapterPackage = isAdapterPackage(workspace, root);
    const allowed = allowedDependenciesFor(packageName);

    for (const section of DEPENDENCY_SECTIONS) {
      const dependencies = workspace.packageJson[section] ?? {};
      for (const [dependency, version] of Object.entries(dependencies)) {
        // TODO(phase: adapters): Resolve `npm:` aliases and `file:` specifiers to workspace identities,
        // and extend the allowlist model to every workspace once adapter packages exist.
        if (!adapterPackage && (adapterNames.has(dependency) || version.includes('packages/adapters/'))) {
          violations.push({
            packageName,
            packagePath,
            dependency,
            section,
            reason: 'non-adapter workspace depends on an adapter package',
          });
        }

        if (packageName !== CI_SURFACE_PACKAGE && TOOLKIT_DEPENDENCY.test(dependency)) {
          violations.push({
            packageName,
            packagePath,
            dependency,
            section,
            reason: 'GitHub Action toolkit must stay confined to @adrkit/ci and never reach core/schema/cli',
          });
        }

        if (BACKSTAGE_DEPENDENCY.test(dependency)) {
          violations.push({
            packageName,
            packagePath,
            dependency,
            section,
            reason:
              'Backstage SDK must not enter this repository; the publication surface is a downstream consumer in its own repository (ADR-0029)',
          });
        }

        if (allowed && !allowed[section].has(dependency)) {
          violations.push({
            packageName,
            packagePath,
            dependency,
            section,
            reason: `${packageName} declares a dependency outside its allowed public surface`,
          });
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await checkDependencyRules();
  if (result.ok) {
    console.log('core-has-no-adapter-deps: ok');
  } else {
    for (const violation of result.violations) {
      console.error(
        `${violation.packagePath}: ${violation.packageName} ${violation.section}.${violation.dependency} - ${violation.reason}`,
      );
    }
    process.exitCode = 1;
  }
}
