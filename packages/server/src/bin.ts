/**
 * `adrkit-server`: the entry point of the image's `server` selector
 * ([ADR-0055](../../../docs/adr/0055-serve-a-read-only-rest-api-over-the-sdk-in-the-oci-image-and-reach-mcp-clients-t.md)
 * clauses 12 to 14).
 *
 * **This server authenticates no one.** It binds `127.0.0.1` unless `ADRKIT_SERVER_HOST`
 * says otherwise, and on any non-loopback bind it prints one fixed warning saying so.
 */

import { CONFIG_MESSAGES, ConfigError, isLoopbackHost, loadServerConfig } from './config.ts';
import { NON_LOOPBACK_WARNING, USAGE } from './messages.ts';
import { createAdrkitServer } from './server.ts';

async function main(argv: readonly string[]): Promise<void> {
  if (argv.length > 0) {
    const help = argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h');
    (help ? process.stdout : process.stderr).write(USAGE);
    process.exitCode = help ? 0 : 2;
    return;
  }

  let config;
  try {
    config = await loadServerConfig(process.env, process.cwd());
  } catch (error) {
    process.stderr.write(`adrkit-server: ${error instanceof ConfigError ? error.message : CONFIG_MESSAGES['corpora-malformed']}\n`);
    process.exitCode = 2;
    return;
  }

  const server = createAdrkitServer({ config });
  server.on('error', () => {
    process.stderr.write('adrkit-server: could not listen on the configured host and port.\n');
    process.exit(1);
  });

  // As PID 1 in a container, Node ignores SIGTERM and SIGINT unless it handles them.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      server.closeAllConnections();
      setTimeout(() => process.exit(0), 5_000).unref();
    });
  }

  // `[::1]` is how an IPv6 address is written in a URL; Node's listen wants it bare.
  const bindHost = config.host.startsWith('[') && config.host.endsWith(']') ? config.host.slice(1, -1) : config.host;
  server.listen(config.port, bindHost, () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : config.port;
    const host = config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host;
    process.stdout.write(`adrkit-server: listening on http://${host}:${port} (${config.corpora.length} ${config.corpora.length === 1 ? 'corpus' : 'corpora'})\n`);
    if (!isLoopbackHost(config.host)) process.stderr.write(`${NON_LOOPBACK_WARNING}\n`);
  });
}

await main(process.argv.slice(2));
