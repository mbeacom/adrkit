import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const coreUrl = new URL('../packages/core/dist/index.js', import.meta.url);
const cliPath = fileURLToPath(new URL('../packages/cli/dist/index.js', import.meta.url));
const actionPath = fileURLToPath(new URL('../packages/ci/dist/index.js', import.meta.url));

if (!existsSync(fileURLToPath(coreUrl))) {
  throw new Error('Expected packages/core/dist/index.js to exist; run bun run build first');
}
if (!existsSync(cliPath)) {
  throw new Error('Expected packages/cli/dist/index.js to exist; run bun run build first');
}
if (!existsSync(actionPath)) {
  throw new Error('Expected packages/ci/dist/index.js to exist; run bun run build first');
}

const core = await import(coreUrl.href);
if (typeof core.lintCorpus !== 'function') {
  throw new Error('Expected built @adrkit/core to export lintCorpus');
}
if (typeof core.checkChanges !== 'function') {
  throw new Error('Expected built @adrkit/core to export checkChanges');
}

const cli = spawnSync(process.execPath, [cliPath, 'lint', 'docs/adr'], {
  cwd: repoRoot,
  encoding: 'utf8',
});

if (cli.stdout) process.stdout.write(cli.stdout);
if (cli.stderr) process.stderr.write(cli.stderr);
if (cli.status !== 0) {
  throw new Error(`Built CLI smoke failed with exit ${cli.status}`);
}

// The committed Action bundle must run self-contained on the target Node runtime.
// Outside a pull_request event it is a graceful no-op — that is enough to prove the
// bundle loads and all its dependencies resolved.
const action = spawnSync(process.execPath, [actionPath], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, GITHUB_EVENT_NAME: '', GITHUB_EVENT_PATH: '' },
});

if (action.stdout) process.stdout.write(action.stdout);
if (action.stderr) process.stderr.write(action.stderr);
if (action.status !== 0) {
  throw new Error(`Built Action bundle smoke failed with exit ${action.status}`);
}
if (!action.stdout.includes('not a pull_request event')) {
  throw new Error('Expected the Action bundle to no-op outside a pull_request event');
}

console.log('smoke-node: built core import, CLI lint, and Action bundle passed');

