import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const coreUrl = new URL('../packages/core/dist/index.js', import.meta.url);
const evaluatorUrl = new URL('../packages/evaluator/dist/index.js', import.meta.url);
const cliPath = fileURLToPath(new URL('../packages/cli/dist/index.js', import.meta.url));
const actionPath = fileURLToPath(new URL('../packages/ci/dist/index.js', import.meta.url));

if (!existsSync(fileURLToPath(coreUrl))) {
  throw new Error('Expected packages/core/dist/index.js to exist; run bun run build first');
}
if (!existsSync(fileURLToPath(evaluatorUrl))) {
  throw new Error('Expected packages/evaluator/dist/index.js to exist; run bun run build first');
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

const evaluator = await import(evaluatorUrl.href);
if (typeof evaluator.evaluatePass0 !== 'function') {
  throw new Error('Expected built @adrkit/evaluator to export evaluatePass0');
}

// The built @adrkit/mcp public surface is only the sealed lifecycle handle.
const mcpUrl = new URL('../packages/mcp/dist/index.js', import.meta.url);
if (!existsSync(fileURLToPath(mcpUrl))) {
  throw new Error('Expected packages/mcp/dist/index.js to exist; run bun run build first');
}
const mcp = await import(mcpUrl.href);
if (typeof mcp.createAdrkitMcpServer !== 'function') {
  throw new Error('Expected built @adrkit/mcp to export createAdrkitMcpServer');
}
if (mcp.buildRegisteredServer !== undefined) {
  throw new Error('Built @adrkit/mcp must not export its internal builder');
}
const mcpHandle = mcp.createAdrkitMcpServer({ cwd: repoRoot, dir: 'docs/adr' });
if (Object.getPrototypeOf(mcpHandle) !== null) {
  throw new Error('Built MCP handle must be a null-prototype object');
}
if (!Object.isFrozen(mcpHandle)) {
  throw new Error('Built MCP handle must be frozen');
}
if (JSON.stringify(Object.getOwnPropertyNames(mcpHandle).sort()) !== JSON.stringify(['close', 'start'])) {
  throw new Error('Built MCP handle must expose exactly start and close');
}

// Run the built bin under Node with the side-effect-denial preload, over real stdio,
// against this repository's own docs/adr corpus; every stdout line must be JSON-RPC.
const mcpBinPath = fileURLToPath(new URL('../packages/mcp/dist/bin.js', import.meta.url));
const mcpPreloadPath = fileURLToPath(new URL('../packages/mcp/test/side-effect-denial-preload.mjs', import.meta.url));

async function runBuiltMcpStdio() {
  const proc = spawn(process.execPath, ['--import', mcpPreloadPath, mcpBinPath, '--cwd', repoRoot], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const messages = new Map();
  const wanted = [2, 3, 4, 5, 6];
  let buffer = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Built MCP stdio smoke timed out')), 20000);
    proc.on('error', reject);
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.jsonrpc !== '2.0') {
          reject(new Error('Built adrkit-mcp emitted a non-JSON-RPC stdout line'));
          return;
        }
        if (typeof message.id === 'number') messages.set(message.id, message);
        if (wanted.every((id) => messages.has(id))) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    const frames = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_decisions', arguments: { query: 'git' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_decision', arguments: { ref: '0001' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_decision_context', arguments: { files: ['README.md'] } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_superseded', arguments: {} } },
    ];
    proc.stdin.write(frames.map((f) => JSON.stringify(f) + '\n').join(''));
  });
  proc.stdin.end();
  proc.kill();
  const names = (messages.get(2)?.result?.tools ?? []).map((t) => t.name).sort();
  const expected = ['get_decision', 'get_decision_context', 'list_superseded', 'search_decisions'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Built adrkit-mcp did not list the four tools: ${names}`);
  }
  for (const id of [3, 4, 5, 6]) {
    const outcome = messages.get(id)?.result?.structuredContent?.result?.outcome;
    if (!outcome) throw new Error(`Built adrkit-mcp tool call ${id} did not return a structured outcome`);
  }
}

await runBuiltMcpStdio();

const cli = spawnSync(process.execPath, [cliPath, 'lint', 'docs/adr'], {
  cwd: repoRoot,
  encoding: 'utf8',
});

if (cli.stdout) process.stdout.write(cli.stdout);
if (cli.stderr) process.stderr.write(cli.stderr);
if (cli.status !== 0) {
  throw new Error(`Built CLI smoke failed with exit ${cli.status}`);
}

// Offline, model-free `adr evaluate` against a committed fixture proposal + snapshot.
// No model, network, clock, or credential is available; the evaluator must still run.
const evaluate = spawnSync(
  process.execPath,
  [
    cliPath,
    'evaluate',
    'packages/evaluator/test/fixtures/proposal-0042.md',
    '--snapshot',
    'packages/evaluator/test/fixtures/snapshot.clean.json',
    '--date',
    '2026-07-19',
    '--json',
  ],
  { cwd: repoRoot, encoding: 'utf8' },
);

if (evaluate.stderr) process.stderr.write(evaluate.stderr);
if (evaluate.status !== 0) {
  throw new Error(`Built CLI \`adr evaluate\` smoke failed with exit ${evaluate.status}`);
}
const evaluatePayload = JSON.parse(evaluate.stdout);
if (!Array.isArray(evaluatePayload.result?.report?.results) || evaluatePayload.result.report.results.length !== 11) {
  throw new Error('Expected `adr evaluate --json` to emit exactly eleven rule results');
}
if (evaluatePayload.result.report.outcome !== 'ok') {
  throw new Error(`Expected the clean fixture proposal to evaluate to outcome "ok", got "${evaluatePayload.result.report.outcome}"`);
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

console.log('smoke-node: built core import, evaluator import, MCP sealed handle + stdio tools, CLI lint, offline `adr evaluate`, and Action bundle passed');

