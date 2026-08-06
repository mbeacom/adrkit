/**
 * T093 — checks on `scripts/run-network-denied.ts`.
 *
 * The script's job is to make the clean-clone job's "network only during install"
 * guarantee **falsifiable**. A guard that cannot fail is not a guard, so what is checked
 * here is the failing behaviour, not the passing one:
 *
 * - a mechanism that does not deny is **rejected**, not used;
 * - a control whose unsandboxed half does not connect proves nothing, and yields no
 *   mechanism at all;
 * - with no provable mechanism the script **fails closed** and does not run the command.
 *
 * The last is the one that matters. If `proveDenial` returned `undefined` and the script
 * ran the command anyway, every CI run would still be green and the guarantee would be
 * gone with nothing to notice.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CANDIDATES,
  PROBE_SOURCE,
  commandFromArgv,
  portOf,
  proveDenial,
  run,
  type DenialMechanism,
} from './run-network-denied.ts';

const REPO_ROOT = join(import.meta.dir, '..');

let workspace: string;
let probePath: string;
let listener: ReturnType<typeof Bun.serve>;
let port: number;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'adrkit-deny-test-'));
  probePath = join(workspace, 'probe.mjs');
  await writeFile(probePath, PROBE_SOURCE, 'utf8');
  listener = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') });
  port = portOf(listener);
});

afterAll(async () => {
  listener.stop(true);
  await rm(workspace, { recursive: true, force: true });
});

describe('commandFromArgv', () => {
  test('takes everything after a literal separator', () => {
    expect(commandFromArgv(['--', 'bun', 'test'])).toEqual(['bun', 'test']);
  });

  test('takes everything when there is no separator, because Bun strips it', () => {
    // The invocation `bun scripts/run-network-denied.ts -- bun test` reaches the script
    // as `['bun', 'test']`. Requiring the separator rejected the documented usage.
    expect(commandFromArgv(['bun', 'test'])).toEqual(['bun', 'test']);
  });

  test('an INNER separator belongs to the command and is passed through', () => {
    // Bun strips only the *first* `--`. Scanning the whole array for one mistakes the
    // command's own arguments for the separator: this exact CI invocation would have
    // been reduced to `['--skip-build', '--skip-smoke-install']`, silently dropping
    // `bun run release:pack` and replacing the tarball verification with garbage.
    expect(
      commandFromArgv(['bun', 'run', 'release:pack', '--', '--skip-build', '--skip-smoke-install']),
    ).toEqual(['bun', 'run', 'release:pack', '--', '--skip-build', '--skip-smoke-install']);
  });

  test('a leading separator is consumed, but a later one still is not', () => {
    expect(commandFromArgv(['--', 'bun', 'run', 'x', '--', '--flag'])).toEqual([
      'bun',
      'run',
      'x',
      '--',
      '--flag',
    ]);
  });

  test('an empty argv yields an empty command, which main() treats as a usage error', () => {
    expect(commandFromArgv([])).toEqual([]);
  });
});

describe('proveDenial — the two-sided control', () => {
  test('a real mechanism is proved, and both halves of the control are recorded', async () => {
    const outcome = await proveDenial(probePath, port);

    expect(outcome.proven).toBeDefined();
    expect(outcome.controlUnsandboxed).toStartWith('CONNECTED');
    expect(outcome.controlSandboxed).toStartWith('DENIED');
    expect(outcome.proven?.qualifyingMechanism).toBe(2);
  });

  test('a mechanism that does NOT deny is rejected, with the reason recorded', async () => {
    // The mutation a one-sided control cannot see: still a real sandbox, still the same
    // binary, only the denial removed.
    const permissive: DenialMechanism = {
      mechanismUsed: 'permissive sandbox (control fixture)',
      configuration: "sandbox-exec -p '(version 1)(allow default)'",
      qualifyingMechanism: 2,
      argv: ['sandbox-exec', '-p', '(version 1)(allow default)'],
    };

    const outcome = await proveDenial(probePath, port, [permissive]);

    expect(outcome.proven).toBeUndefined();
    expect(outcome.rejected).toHaveLength(1);
    // Either it ran and connected, or the binary is absent on this platform. Both are
    // rejections; neither is a mechanism.
    expect(outcome.rejected[0]?.why).toMatch(/^(did not deny: CONNECTED|unavailable here:)/u);
  });

  test('a mechanism that is not installed is rejected rather than crashing the run', async () => {
    const missing: DenialMechanism = {
      mechanismUsed: 'a binary that does not exist',
      configuration: 'adrkit-no-such-sandbox',
      qualifyingMechanism: 2,
      argv: ['adrkit-no-such-sandbox-binary'],
    };

    const outcome = await proveDenial(probePath, port, [missing]);
    expect(outcome.proven).toBeUndefined();
    expect(outcome.rejected[0]?.why).toStartWith('unavailable here:');
  });

  test('an unreachable control yields NO mechanism, however well the sandbox denies', async () => {
    // Half one, isolated. Pointed at a port nothing is listening on, the unsandboxed
    // probe cannot connect — so a `DENIED` under any sandbox would be uninterpretable.
    // The function must return no mechanism rather than one it cannot vouch for.
    const deadPort = port === 65535 ? 65534 : port + 1;
    const outcome = await proveDenial(probePath, deadPort);

    expect(outcome.proven).toBeUndefined();
    expect(outcome.controlUnsandboxed).not.toStartWith('CONNECTED');
    // And it did not even try the candidates: there was nothing to conclude from them.
    expect(outcome.rejected).toEqual([]);
  });
});

describe('the script fails closed, and does not run the command unprotected', () => {
  test('a usage error exits 2 without running anything', async () => {
    const result = await run(['bun', join(REPO_ROOT, 'scripts', 'run-network-denied.ts')]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('usage:');
  });

  test('the command runs under the mechanism, and network is denied inside it', async () => {
    const result = await run([
      'bun',
      join(REPO_ROOT, 'scripts', 'run-network-denied.ts'),
      '--',
      'bun',
      probePath,
      String(port),
    ]);

    expect(result.exitCode).toBe(0);
    // The proof lines, then the command's own output showing it could not reach the
    // listener the control had just reached.
    expect(result.stdout).toContain('run-network-denied: mechanism =');
    expect(result.stdout).toContain('control unsandboxed = CONNECTED');
    expect(result.stdout).toContain('control sandboxed  = DENIED');
    expect(result.stdout.trimEnd().split('\n').at(-1)).toStartWith('DENIED');
  });

  test('the command\u2019s exit code is propagated, so a failure inside is a failure outside', async () => {
    const result = await run([
      'bun',
      join(REPO_ROOT, 'scripts', 'run-network-denied.ts'),
      '--',
      'bun',
      '-e',
      'process.exit(37)',
    ]);
    expect(result.exitCode).toBe(37);
  });
});

describe('the candidate list stays within §5\u2019s qualifying mechanisms', () => {
  test('every candidate is a sandbox or namespace, never an environment convention', () => {
    // §5 rejects `env -i`/restricted-PATH by name. Asserted so a future "simplification"
    // is a test failure rather than a silent downgrade of the claim.
    for (const candidate of CANDIDATES) {
      expect(candidate.argv[0]).toMatch(/^(unshare|sudo|sandbox-exec)$/u);
      expect(candidate.qualifyingMechanism).toBe(2);
      expect(candidate.argv).not.toContain('env');
      expect(candidate.mechanismUsed.length).toBeGreaterThan(0);
      expect(candidate.configuration.length).toBeGreaterThan(0);
    }
  });

  test('the namespace candidates bring loopback up, so a denied run is not also a broken one', () => {
    // `unshare --net` leaves `lo` down. A command that binds 127.0.0.1 would then fail
    // for a reason unrelated to the denial, and the failure would be misattributed.
    for (const candidate of CANDIDATES.filter((one) => one.argv.includes('unshare'))) {
      expect(candidate.argv.join(' ')).toContain('ip link set lo up');
    }
  });
});
