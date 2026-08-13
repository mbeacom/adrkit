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
  BUN,
  CANDIDATES,
  PROBE_SOURCE,
  REJECTION,
  SENTINEL,
  checkAvailability,
  commandFromArgv,
  portOf,
  proveDenial,
  resolveCommand,
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

  test('no candidate names an executable by bare word, because sudo would not resolve it', () => {
    // The regression that cost five red CI runs. `sudo` replaces PATH with `secure_path`,
    // which does not contain `~/.bun/bin`, so a bare `bun` resolves outside the sandbox
    // and not inside it.
    for (const candidate of CANDIDATES) {
      expect(candidate.argv).not.toContain('bun');
      expect(candidate.configuration).not.toMatch(/(^|\s)bun(\s|$)/u);
    }
  });

  test('the sudo candidate drops privilege back, and only AFTER bringing loopback up', () => {
    const sudo = CANDIDATES.find((one) => one.argv[0] === 'sudo');
    expect(sudo).toBeDefined();

    const script = sudo?.argv.find((part) => part.includes('setpriv')) ?? '';
    expect(script).toContain(`--reuid=${process.getuid?.() ?? 0}`);
    expect(script).toContain(`--regid=${process.getgid?.() ?? 0}`);
    expect(script).toContain('--clear-groups');

    // Order is the property, not mere presence: `ip link set lo up` needs privilege inside
    // the namespace, and the command must NOT keep it. Dropping first breaks loopback;
    // never dropping runs `bun run build` as root and leaves root-owned output that breaks
    // the later un-sandboxed steps of the same job.
    expect(script.indexOf('ip link set lo up')).toBeLessThan(script.indexOf('setpriv'));
  });
});

describe('resolveCommand — the name must cross the sandbox boundary already resolved', () => {
  test('a bare name becomes an absolute path', () => {
    const resolved = resolveCommand(['bun', 'run', 'typecheck']);
    expect(resolved?.[0]).toStartWith('/');
    expect(resolved?.slice(1)).toEqual(['run', 'typecheck']);
  });

  test('an explicit path is passed through untouched', () => {
    expect(resolveCommand(['/usr/bin/env', '-0'])).toEqual(['/usr/bin/env', '-0']);
  });

  test('an unresolvable name is a usage error here, not a mechanism failure inside', () => {
    // Left unresolved, this failure happens *inside* the sandbox, where it is
    // indistinguishable from the mechanism being unavailable — the exact confusion.
    expect(resolveCommand(['adrkit-definitely-not-on-path'])).toBeUndefined();
  });

  test('an empty command resolves to nothing', () => {
    expect(resolveCommand([])).toBeUndefined();
  });

  test('BUN is this interpreter, by absolute path', () => {
    expect(BUN).toStartWith('/');
  });
});

describe('a broken payload is never laundered into "no mechanism is available"', () => {
  // The defect that shipped. `sudo -n unshare --net` succeeded on ubuntu-latest and
  // created the namespace; only the payload failed to resolve. Because availability was
  // inferred from the probe's own failure, the script reported "unavailable here" and
  // fail-closed — discarding a mechanism that worked, and making an unearned claim about
  // the environment. §5's whole subject is denial-versus-absence; this was the same
  // mistake one level up.

  /** Runs anything, except a payload whose second argument is a `.mjs` file. */
  const worksButBreaksTheProbe: DenialMechanism = {
    mechanismUsed: 'passthrough that breaks only the probe (fixture)',
    configuration: 'sh -c',
    qualifyingMechanism: 2,
    argv: [
      'sh',
      '-c',
      'case "$2" in *.mjs) echo "simulated payload failure" >&2; exit 127;; esac; exec "$@"',
      '--',
    ],
  };

  test('the sentinel proves the mechanism can execute, independent of any network question', async () => {
    const availability = await checkAvailability(worksButBreaksTheProbe);
    expect(availability.available).toBe(true);
  });

  test('a mechanism that cannot execute anything IS unavailable, and says so', async () => {
    const availability = await checkAvailability({
      mechanismUsed: 'a binary that does not exist',
      configuration: 'adrkit-no-such-sandbox',
      qualifyingMechanism: 2,
      argv: ['adrkit-no-such-sandbox-binary'],
    });
    expect(availability.available).toBe(false);
    expect(availability.why.length).toBeGreaterThan(0);
  });

  test('the working-mechanism/broken-payload case is reported as a payload failure', async () => {
    const outcome = await proveDenial(probePath, port, [worksButBreaksTheProbe]);

    expect(outcome.proven).toBeUndefined();
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.why).toStartWith(REJECTION.payloadFailed);
    // The assertion that would have caught the shipped bug: this is emphatically NOT a
    // statement that the environment has no mechanism.
    expect(outcome.rejected[0]?.why).not.toStartWith(REJECTION.unavailable);
  });

  test('the three rejection reasons are distinct, so they cannot collapse into each other', () => {
    const reasons = [REJECTION.unavailable, REJECTION.payloadFailed, REJECTION.didNotDeny];
    expect(new Set(reasons).size).toBe(3);
    for (const reason of reasons) {
      expect(reasons.filter((other) => other !== reason && other.startsWith(reason))).toEqual([]);
    }
  });

  test('the sentinel token cannot be produced by the probe, so the two proofs stay separate', () => {
    expect(PROBE_SOURCE).not.toContain(SENTINEL);
  });

  test('an unresolvable command exits 2 rather than failing inside a sandbox', async () => {
    const result = await run([
      'bun',
      join(REPO_ROOT, 'scripts', 'run-network-denied.ts'),
      '--',
      'adrkit-definitely-not-on-path',
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('cannot resolve');
  });
});
