import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const coreUrl = new URL('../packages/core/dist/index.js', import.meta.url);
const cliPath = fileURLToPath(new URL('../packages/cli/dist/index.js', import.meta.url));

if (!existsSync(fileURLToPath(coreUrl))) {
  throw new Error('Expected packages/core/dist/index.js to exist; run bun run build first');
}
if (!existsSync(cliPath)) {
  throw new Error('Expected packages/cli/dist/index.js to exist; run bun run build first');
}

const core = await import(coreUrl.href);
if (typeof core.lintCorpus !== 'function') {
  throw new Error('Expected built @adrkit/core to export lintCorpus');
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

console.log('smoke-node: built core import and CLI lint passed');
