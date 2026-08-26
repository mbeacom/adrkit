import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runtime = process.env.CONTAINER_RUNTIME || 'docker';
const image = process.argv[2] || 'adrkit-mcp:ci';
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const expectedTools = ['get_decision', 'get_decision_context', 'list_superseded', 'search_decisions'];

function framesFor(era) {
  if (era === 'legacy') {
    return [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'container-smoke', version: '0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ];
  }

  const _meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'container-smoke', version: '0' },
  };
  return [
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta } },
  ];
}

async function smokeEra(era) {
  const process = spawn(
    runtime,
    [
      'run',
      '--rm',
      '--read-only',
      '--network',
      'none',
      '-i',
      '-v',
      `${repoRoot}:/workspace:ro`,
      image,
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const messages = new Map();
  let buffer = '';

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.kill('SIGTERM');
      reject(new Error(`Container MCP smoke timed out (${era} era)`));
    }, 20_000);

    process.on('error', reject);
    process.on('exit', (code) => {
      if (!messages.has(2)) {
        clearTimeout(timer);
        reject(new Error(`Container MCP exited ${code} before tools/list (${era} era)`));
      }
    });
    process.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.jsonrpc !== '2.0') {
          clearTimeout(timer);
          reject(new Error(`Container MCP emitted a non-JSON-RPC line (${era} era)`));
          return;
        }
        if (typeof message.id === 'number') messages.set(message.id, message);
        if (messages.has(1) && messages.has(2)) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    process.stdin.write(framesFor(era).map((frame) => `${JSON.stringify(frame)}\n`).join(''));
  });

  process.stdin.end();
  process.kill('SIGTERM');

  for (const id of [1, 2]) {
    const error = messages.get(id)?.error;
    if (error) {
      throw new Error(`Container MCP answered id ${id} with an error (${era} era): ${JSON.stringify(error)}`);
    }
  }

  const tools = (messages.get(2)?.result?.tools ?? []).map((tool) => tool.name);
  if (JSON.stringify(tools) !== JSON.stringify(expectedTools)) {
    throw new Error(`Container MCP listed unexpected tools (${era} era): ${JSON.stringify(tools)}`);
  }
  if (era === 'modern') {
    const discover = messages.get(1)?.result ?? {};
    if (!(discover.supportedVersions ?? []).includes('2026-07-28')) {
      throw new Error(`Container MCP did not advertise 2026-07-28: ${JSON.stringify(discover)}`);
    }
    if (messages.get(2)?.result?.resultType !== 'complete') {
      throw new Error('Container MCP omitted the modern tools/list resultType');
    }
  }
}

await smokeEra('legacy');
await smokeEra('modern');
console.log(`container-smoke: ${image} served both MCP protocol eras`);
