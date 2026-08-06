/**
 * T093 / T094 — run a command with network access **actively denied**, or fail.
 *
 * `.github/workflows/ci.yml`'s `clean-clone-builds` job uses this to discharge FR-050's
 * second half: *network access is permitted **only** during `bun install
 * --frozen-lockfile`*. Everything after the install runs through here.
 *
 * # Why this is a script and not three lines of YAML
 *
 * A `run:` step that simply prefixes `unshare --net` would be untestable and, worse,
 * unfalsifiable: if the prefix silently stopped denying — a changed flag, a kernel that
 * refuses the namespace, a profile typo — the job would keep passing and the guarantee
 * would be gone with nothing to notice. Spike 009's
 * `contracts/scale-and-security-measurement.md` §5 is explicit that the evidence must be
 * a **denial** and never "no network calls happened to occur", so the denial has to be
 * *proved* at the moment it is used.
 *
 * This script therefore does three things in order, and refuses to run the command if any
 * of them fails:
 *
 * 1. Start a loopback listener, and confirm a probe **reaches it** without the sandbox.
 * 2. Run the same probe **under** the candidate mechanism, and confirm it is **denied**.
 * 3. Only then exec the real command under that same mechanism.
 *
 * Step 1 is what makes step 2 mean anything. Without it, a `DENIED` result is equally
 * consistent with an environment where nothing was reachable in the first place — the
 * same absence-versus-denial confusion one level up. The listener is on loopback
 * precisely so the control needs no internet and behaves identically on an air-gapped
 * runner.
 *
 * # Fail-closed
 *
 * §5: "If neither qualifying mechanism is available in the execution environment, the run
 * MUST NOT proceed — this is a fail-closed constraint on the execution environment
 * itself, not merely an evidence-recording nicety." So an environment with no provable
 * mechanism exits non-zero **without** running the command. It never degrades to running
 * it unprotected, and it never skips.
 *
 * Usage: `bun scripts/run-network-denied.ts -- <command> [args...]`
 *
 * @see `specs/009-catalog-binding-viability/contracts/scale-and-security-measurement.md` §5
 */

/** One of §5's two qualifying mechanisms, as an argv prefix. */
export interface DenialMechanism {
  /** §5's `NetworkDenialRecord.mechanismUsed`. */
  readonly mechanismUsed: string;
  /** §5's "exact configuration". */
  readonly configuration: string;
  /** Which of §5's two numbered mechanisms this is. */
  readonly qualifyingMechanism: 1 | 2;
  /** The argv prefix, into which the command is appended. */
  readonly argv: readonly string[];
}

/**
 * Candidates, in the order they are tried.
 *
 * `unshare --net` gives a namespace whose loopback interface is **down**, which would
 * break any command that binds or dials 127.0.0.1 for reasons unrelated to the denial.
 * The candidates that use it therefore bring `lo` up inside the namespace first — the
 * namespace still has no route off the host, which is the property being relied on.
 */
export const CANDIDATES: readonly DenialMechanism[] = [
  {
    mechanismUsed: 'unshare --net (empty network namespace, loopback up)',
    configuration: "unshare --net --map-root-user -- sh -c 'ip link set lo up || true; exec \"$@\"' --",
    qualifyingMechanism: 2,
    argv: [
      'unshare',
      '--net',
      '--map-root-user',
      '--',
      'sh',
      '-c',
      'ip link set lo up 2>/dev/null || true; exec "$@"',
      '--',
    ],
  },
  {
    mechanismUsed: 'unshare --net under sudo (empty network namespace, loopback up)',
    configuration: "sudo -n unshare --net -- sh -c 'ip link set lo up || true; exec \"$@\"' --",
    qualifyingMechanism: 2,
    argv: [
      'sudo',
      '-n',
      'unshare',
      '--net',
      '--',
      'sh',
      '-c',
      'ip link set lo up 2>/dev/null || true; exec "$@"',
      '--',
    ],
  },
  {
    mechanismUsed: 'sandbox-exec network-deny profile',
    configuration: "sandbox-exec -p '(version 1)(allow default)(deny network*)'",
    qualifyingMechanism: 2,
    argv: ['sandbox-exec', '-p', '(version 1)(allow default)(deny network*)'],
  },
];

/** The probe run on both sides of the control. Prints one line: `CONNECTED:*` or `DENIED:*`. */
export const PROBE_SOURCE = `
const port = process.argv[2];
try {
  const response = await fetch('http://127.0.0.1:' + port + '/', { signal: AbortSignal.timeout(4000) });
  console.log('CONNECTED:' + response.status);
} catch (error) {
  console.log('DENIED:' + (error?.message ?? error?.name ?? 'unknown'));
}
`;

/**
 * A loopback listener's port, refusing to proceed without one.
 *
 * `Bun.serve().port` is typed `number | undefined`. A non-null assertion here would be a
 * lie in exactly the case that matters: without a port the control cannot run, and a
 * control that silently did not run is the absence-shaped failure this whole file exists
 * to prevent. So it throws instead.
 */
export function portOf(server: { readonly port?: number | undefined }): number {
  if (typeof server.port !== 'number') {
    throw new Error('the loopback control listener reported no port; the denial cannot be proved');
  }
  return server.port;
}

export interface Ran {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn and collect, treating a missing executable as a rejected candidate.
 *
 * `Bun.spawn` throws `ENOENT` rather than returning a non-zero exit, and letting that
 * propagate turns "this mechanism is not installed here" into a crash whose message says
 * nothing about mechanisms. Observed while exercising the negative case for
 * `test/offline-run.test.ts`; the same shape applies here.
 */
export async function run(argv: readonly string[], env?: Record<string, string>): Promise<Ran> {
  let proc;
  try {
    proc = Bun.spawn([...argv], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: env ?? (Bun.env as unknown as Record<string, string>),
    });
  } catch (error) {
    return { stdout: '', stderr: (error as Error).message, exitCode: 127 };
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

export interface ProofOutcome {
  readonly proven: DenialMechanism | undefined;
  /** The unsandboxed half. Must start `CONNECTED` for any denial below to mean anything. */
  readonly controlUnsandboxed: string;
  /** The sandboxed half, when a mechanism was proved. */
  readonly controlSandboxed: string;
  readonly rejected: readonly { readonly mechanism: string; readonly why: string }[];
}

/**
 * Prove that some candidate denies **in this environment**, by the two-sided control.
 *
 * `probePath` is a file containing {@link PROBE_SOURCE}; `port` is a listener the caller
 * has already started on loopback.
 */
export async function proveDenial(
  probePath: string,
  port: number,
  candidates: readonly DenialMechanism[] = CANDIDATES,
): Promise<ProofOutcome> {
  const rejected: { mechanism: string; why: string }[] = [];

  const unsandboxed = await run(['bun', probePath, String(port)]);
  const controlUnsandboxed = unsandboxed.stdout.trim();

  // Half one. If the probe cannot reach the listener even unsandboxed, nothing below is
  // interpretable, and reporting a denial anyway would be the error §5 is about.
  if (!controlUnsandboxed.startsWith('CONNECTED')) {
    return { proven: undefined, controlUnsandboxed, controlSandboxed: '', rejected };
  }

  for (const candidate of candidates) {
    const attempt = await run([...candidate.argv, 'bun', probePath, String(port)]);
    const line = attempt.stdout.trim();

    if (line === '' && attempt.exitCode !== 0) {
      rejected.push({
        mechanism: candidate.mechanismUsed,
        why: `unavailable here: ${attempt.stderr.trim().split('\n')[0] ?? `exit ${attempt.exitCode}`}`,
      });
      continue;
    }
    if (line.startsWith('DENIED')) {
      return { proven: candidate, controlUnsandboxed, controlSandboxed: line, rejected };
    }
    rejected.push({ mechanism: candidate.mechanismUsed, why: `did not deny: ${line}` });
  }

  return { proven: undefined, controlUnsandboxed, controlSandboxed: '', rejected };
}

/**
 * The command to run: everything after a literal `--`, or all of `argv` when there is
 * none.
 *
 * Both forms are accepted because **Bun removes the `--` before the script sees it**.
 * Invoked as `bun scripts/run-network-denied.ts -- bun test`, `process.argv.slice(2)` is
 * `['bun', 'test']`, not `['--', 'bun', 'test']`. Requiring the separator would therefore
 * reject the documented invocation, which is how this was found. The separator is still
 * honoured when present so the script behaves the same if run under a launcher that
 * preserves it.
 */
export function commandFromArgv(argv: readonly string[]): readonly string[] {
  const separator = argv.indexOf('--');
  return separator === -1 ? [...argv] : argv.slice(separator + 1);
}

async function main(): Promise<number> {
  const command = commandFromArgv(process.argv.slice(2));
  if (command.length === 0) {
    console.error('usage: bun scripts/run-network-denied.ts -- <command> [args...]');
    return 2;
  }

  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const workspace = await mkdtemp(join(tmpdir(), 'adrkit-deny-'));
  const probePath = join(workspace, 'probe.mjs');
  await writeFile(probePath, PROBE_SOURCE, 'utf8');

  const listener = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') });

  try {
    const proof = await proveDenial(probePath, portOf(listener));

    if (proof.proven === undefined) {
      console.error('run-network-denied: FAIL-CLOSED — no qualifying denial mechanism could be proved here.');
      console.error(`  control (unsandboxed): ${proof.controlUnsandboxed || '(no output)'}`);
      for (const entry of proof.rejected) console.error(`  rejected: ${entry.mechanism} — ${entry.why}`);
      console.error(
        '  scale-and-security-measurement.md §5: "If neither qualifying mechanism is available in the ' +
          'execution environment, the run MUST NOT proceed." Refusing to run the command unprotected.',
      );
      return 1;
    }

    console.log(`run-network-denied: mechanism = ${proof.proven.mechanismUsed}`);
    console.log(`run-network-denied: configuration = ${proof.proven.configuration}`);
    console.log(`run-network-denied: control unsandboxed = ${proof.controlUnsandboxed}`);
    console.log(`run-network-denied: control sandboxed  = ${proof.controlSandboxed}`);
    console.log(`run-network-denied: running: ${command.join(' ')}`);

    const proc = Bun.spawn([...proof.proven.argv, ...command], {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    });
    return await proc.exited;
  } finally {
    listener.stop(true);
    await rm(workspace, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await main());
