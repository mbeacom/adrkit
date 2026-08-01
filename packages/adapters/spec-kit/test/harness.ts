import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageRoot } from './manifest-fixture.ts';

export const scriptsDir = join(packageRoot, 'scripts');

/**
 * The external utilities the scripts actually invoke. The sandbox PATH contains
 * these and nothing else, so a real `adr` installed on the developer's machine
 * can never leak in and make the "CLI is missing" tests pass for the wrong
 * reason.
 */
const SANDBOX_UTILITIES = ['dirname', 'sed', 'head', 'date', 'node'] as const;

export interface Sandbox {
  /** The project the scripts run inside. Nothing else lives here. */
  project: string;
  /** The only directory on PATH. Deliberately does not contain `adr`. */
  binDir: string;
  /** A fake `adr`, off PATH, reachable only via ADRKIT_CLI. */
  fakeCli: string;
  /** A fake `adr` shipped as a .js entry point, to exercise the node branch. */
  fakeCliJs: string;
  /** Where the fake CLI records the argv it was handed, one argument per line. */
  argvLog: string;
}

export function makeSandbox(): Sandbox {
  const base = mkdtempSync(join(tmpdir(), 'adrkit-speckit-'));
  const project = join(base, 'project');
  const binDir = join(base, 'bin');
  const tools = join(base, 'tools');
  for (const dir of [project, binDir, tools]) mkdirSync(dir, { recursive: true });

  for (const utility of SANDBOX_UTILITIES) {
    const resolved = Bun.which(utility);
    if (!resolved) throw new Error(`sandbox cannot be built: '${utility}' is not on PATH`);
    symlinkSync(resolved, join(binDir, utility));
  }

  const argvLog = join(tools, 'argv.log');
  writeFileSync(argvLog, '');

  const fakeCli = join(tools, 'adr');
  writeFileSync(
    fakeCli,
    `#!/bin/sh
for arg in "$@"; do printf '%s\\n' "$arg" >> ${JSON.stringify(argvLog)}; done
printf '{"fake":"adr","argc":%s}\\n' "$#"
exit "\${ADRKIT_FAKE_EXIT:-0}"
`,
  );
  chmodSync(fakeCli, 0o755);

  const fakeCliJs = join(tools, 'adr-entry.js');
  writeFileSync(
    fakeCliJs,
    `import { appendFileSync } from 'node:fs';
for (const arg of process.argv.slice(2)) appendFileSync(${JSON.stringify(argvLog)}, arg + '\\n');
process.stdout.write('{"fake":"adr-js"}\\n');
process.exit(Number(process.env.ADRKIT_FAKE_EXIT ?? 0));
`,
  );

  return { project, binDir, fakeCli, fakeCliJs, argvLog };
}

/** Give the sandbox project an ADR corpus. */
export function withCorpus(sandbox: Sandbox, dir = 'docs/adr'): string {
  const corpus = join(sandbox.project, dir);
  mkdirSync(corpus, { recursive: true });
  writeFileSync(join(corpus, '.keep'), '');
  return corpus;
}

/** Give the sandbox project a Spec Kit feature directory, optionally planned. */
export function withFeature(sandbox: Sandbox, options: { plan: boolean }): string {
  const feature = join(sandbox.project, 'specs', '001-example');
  mkdirSync(feature, { recursive: true });
  if (options.plan) writeFileSync(join(feature, 'plan.md'), '# Plan\n');
  return feature;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Every argument the fake CLI was handed, in order, across all invocations. */
  argv: string[];
}

export async function runScript(
  sandbox: Sandbox,
  script: string,
  args: string[] = [],
  env: Record<string, string> = {},
): Promise<RunResult> {
  writeFileSync(sandbox.argvLog, '');

  const proc = Bun.spawn(['/bin/sh', join(scriptsDir, script), ...args], {
    cwd: sandbox.project,
    env: { PATH: sandbox.binDir, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  const argv = readFileSync(sandbox.argvLog, 'utf8').split('\n').filter(Boolean);
  return { stdout, stderr, exitCode, argv };
}

/** Path -> content hash for every file under `root`, for mutation comparison. */
export function snapshotTree(root: string): Record<string, string> {
  const tree: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        tree[`${full}/`] = 'dir';
        walk(full);
      } else {
        tree[full] = Bun.hash(readFileSync(full)).toString(16);
      }
    }
  };
  walk(root);
  return tree;
}
