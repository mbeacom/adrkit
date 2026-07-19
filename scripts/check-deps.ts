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
      dependencies: new Set(['@adrkit/core']),
      devDependencies: new Set(['@types/bun']),
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
