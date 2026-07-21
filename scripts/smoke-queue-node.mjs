import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Controlled, no-network smoke for the committed queue Action bundle. Spawns the
 * bundle with a temporary GITHUB_WORKSPACE whose configured corpus directory does not
 * exist. The entrypoint MUST fail at the corpus-load boundary — before constructing or
 * calling the GitHub client — with the known corpus error and a non-zero exit, not a
 * module-resolution error. No real API call is permitted.
 */

const bundle = fileURLToPath(new URL('../packages/ci/dist/queue-action.js', import.meta.url));
if (!existsSync(bundle)) {
  throw new Error('Expected packages/ci/dist/queue-action.js to exist; run bun run --filter @adrkit/ci build first');
}

const workspace = mkdtempSync(join(tmpdir(), 'adrkit-queue-smoke-'));

const result = spawnSync(process.execPath, [bundle], {
  encoding: 'utf8',
  env: {
    ...process.env,
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_TOKEN: 'fake_token',
    INPUT_DIR: 'docs/adr',
    INPUT_TOKEN: 'fake_token',
    'INPUT_ISSUE-TITLE': 'ADR ARB Queue Smoke',
  },
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

if (result.error) {
  throw new Error(`Failed to spawn the queue Action bundle: ${result.error.message}`);
}
if (result.status === 0) {
  throw new Error(`Expected the queue Action bundle to fail at the corpus-load boundary; it exited 0.\n${output}`);
}
if (/Cannot find (module|package)|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|is not defined/.test(output)) {
  throw new Error(`Queue Action bundle failed with a module-resolution error, not a corpus error:\n${output}`);
}
if (!output.includes('could not load the ADR corpus')) {
  throw new Error(`Expected the corpus-load error message, got:\n${output}`);
}

console.log(
  'smoke-queue-node: committed queue Action bundle failed cleanly at the corpus-load boundary (no network, no module-resolution error)',
);
