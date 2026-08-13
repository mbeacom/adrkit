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
 * This script therefore does four things in order, and refuses to run the command if any
 * of them fails:
 *
 * 1. Start a loopback listener, and confirm a probe **reaches it** without the sandbox.
 * 2. Confirm the candidate mechanism can execute a payload **at all**, with a sentinel
 *    that touches no network.
 * 3. Run the same probe **under** the mechanism, and confirm it is **denied**.
 * 4. Only then exec the real command under that same mechanism.
 *
 * Step 1 is what makes step 3 mean anything. Without it, a `DENIED` result is equally
 * consistent with an environment where nothing was reachable in the first place — the
 * same absence-versus-denial confusion one level up. The listener is on loopback
 * precisely so the control needs no internet and behaves identically on an air-gapped
 * runner.
 *
 * Step 2 exists because of a defect that shipped and cost this job five red CI runs. A
 * mechanism is only ever tried by *running the probe under it*, so any failure of that
 * command was attributed to the mechanism. On `ubuntu-latest`, `sudo -n unshare --net`
 * succeeded and created the namespace, and only the **payload** failed to resolve — sudo's
 * `secure_path` does not contain `/home/runner/.bun/bin`, so the bare name `bun` was not
 * found. The inner shell said `exec: bun: not found`; the script reported "unavailable
 * here" and fail-closed, having discarded a mechanism that worked.
 *
 * That is this file's own subject matter turned on itself: a broken payload was laundered
 * into a claim about the environment's capabilities. §5's distinction is between a denial
 * and an absence, and "no mechanism is available here" is an absence claim that must be
 * earned. So availability is now established by a sentinel that only has to *run*, and a
 * probe that fails under a demonstrably-working mechanism is reported as a payload
 * failure — never as a missing mechanism.
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
 * This Bun binary, by absolute path.
 *
 * Never the bare name `bun`. `sudo` replaces `PATH` with `secure_path`, which does not
 * contain `~/.bun/bin`, so a bare name is unresolvable inside the sudo'd candidates — the
 * exact defect described in this file's header. `process.execPath` is the interpreter
 * already running, so it cannot disagree with the one that was invoked.
 */
export const BUN = process.execPath;

/** The invoking user, preserved across the `sudo` candidate so nothing runs as root. */
const UID = process.getuid?.() ?? 0;
const GID = process.getgid?.() ?? 0;

/** Single-quote for `sh`, so an interpolated value cannot be reinterpreted as syntax. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * Restore the caller's `PATH` inside the `sudo` candidate.
 *
 * **This is not the mechanism, and it is not an `env -i` convention.** §5 rejects a
 * restricted `PATH` as a *denial* mechanism; the denial here comes entirely from the
 * network namespace. This does the opposite of restricting: `sudo` replaces `PATH` with
 * `secure_path`, and without putting it back the sandboxed run is not the same run as the
 * unsandboxed one.
 *
 * Resolving the command to an absolute path is not sufficient on its own, which is how
 * this was found. `bun run build` execs its package scripts through `bash`, and those
 * scripts say `bun` — so the *children* need `PATH` even when the parent did not:
 *
 *     $ bun run --filter='*' build
 *     /usr/bin/bash: line 1: bun: command not found
 *
 * `typecheck` passed at the same moment, because its script is `tsc` and Bun resolves that
 * from `node_modules/.bin` itself. A fix verified only against `typecheck` would have
 * looked complete and failed on the next step.
 */
const PATH_RESTORE = `export PATH=${shellQuote(process.env['PATH'] ?? '')}; `;

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
    // `--map-root-user` is unavailable on GitHub-hosted `ubuntu-latest`, where AppArmor
    // restricts unprivileged user namespaces (`write failed /proc/self/uid_map: Operation
    // not permitted`). `sudo` supplies the privilege the namespace itself requires.
    //
    // The order inside is load-bearing and was got wrong once. `ip link set lo up` needs
    // privilege *inside* the namespace, so it must run before the drop; the command must
    // run after it, or `bun run build` executes as **root** and leaves root-owned output
    // that then breaks the later un-sandboxed steps of the same job (`git diff
    // --exit-code packages/ci/dist`, `bun test`). So: root brings `lo` up, `setpriv` hands
    // the original uid/gid back, and only then does the command exec.
    //
    // `setpriv` ships in util-linux, the same package as `unshare`; where one exists so
    // does the other. If it is absent the sentinel fails and this candidate is rejected,
    // which is the correct outcome — falling back to running as root would trade a
    // provable denial for a silent side effect.
    mechanismUsed: 'unshare --net under sudo, dropped back to the invoking user (loopback up)',
    configuration:
      "sudo -n unshare --net -- sh -c 'ip link set lo up || true; <restore PATH>; " +
      `exec setpriv --reuid=${UID} --regid=${GID} --clear-groups "$@"' --`,
    qualifyingMechanism: 2,
    argv: [
      'sudo',
      '-n',
      'unshare',
      '--net',
      '--',
      'sh',
      '-c',
      'ip link set lo up 2>/dev/null || true; ' +
        PATH_RESTORE +
        `exec setpriv --reuid=${UID} --regid=${GID} --clear-groups "$@"`,
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

/**
 * Printed by the availability sentinel. Deliberately not a word the probe can emit, so
 * "the mechanism can run something" and "the mechanism denied the network" can never be
 * satisfied by the same output.
 */
export const SENTINEL = 'ADRKIT_MECHANISM_CAN_EXEC';

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

/** Why a candidate was not used. The three are **not** interchangeable — see {@link proveDenial}. */
export const REJECTION = {
  /** The mechanism could not execute anything here. The only one that is a claim about the environment. */
  unavailable: 'unavailable here: ',
  /** The mechanism ran, but the payload under it did not. Never evidence about the environment. */
  payloadFailed: 'mechanism works, but the probe payload failed under it: ',
  /** The mechanism ran the probe, and the probe reached the network. */
  didNotDeny: 'did not deny: ',
} as const;

/**
 * Can this candidate execute a payload at all, independent of any network question?
 *
 * Separating this from the denial probe is the whole point. Previously the two were one
 * step, so a payload that failed to resolve was indistinguishable from a mechanism that
 * did not exist — and the script reported the latter, which is a claim about the
 * environment it had not earned. The sentinel touches no network, so it cannot be denied;
 * it can only fail if the mechanism genuinely cannot run something.
 */
export async function checkAvailability(
  candidate: DenialMechanism,
): Promise<{ readonly available: boolean; readonly why: string }> {
  const attempt = await run([...candidate.argv, BUN, '-e', `console.log(${JSON.stringify(SENTINEL)})`]);
  if (attempt.stdout.includes(SENTINEL)) return { available: true, why: '' };
  const detail = attempt.stderr.trim().split('\n')[0] ?? `exit ${attempt.exitCode}`;
  return { available: false, why: detail };
}

/**
 * Prove that some candidate denies **in this environment**, by the two-sided control.
 *
 * `probePath` is a file containing {@link PROBE_SOURCE}; `port` is a listener the caller
 * has already started on loopback.
 *
 * A candidate is only rejected as {@link REJECTION.unavailable} when the sentinel could
 * not run. If the sentinel ran and the probe then produced nothing, the mechanism is
 * working and the *payload* is broken — reported as such, and never as an absence of
 * mechanisms, because those two facts call for opposite responses from whoever reads it.
 */
export async function proveDenial(
  probePath: string,
  port: number,
  candidates: readonly DenialMechanism[] = CANDIDATES,
): Promise<ProofOutcome> {
  const rejected: { mechanism: string; why: string }[] = [];

  const unsandboxed = await run([BUN, probePath, String(port)]);
  const controlUnsandboxed = unsandboxed.stdout.trim();

  // Half one. If the probe cannot reach the listener even unsandboxed, nothing below is
  // interpretable, and reporting a denial anyway would be the error §5 is about.
  if (!controlUnsandboxed.startsWith('CONNECTED')) {
    return { proven: undefined, controlUnsandboxed, controlSandboxed: '', rejected };
  }

  for (const candidate of candidates) {
    const availability = await checkAvailability(candidate);
    if (!availability.available) {
      rejected.push({ mechanism: candidate.mechanismUsed, why: REJECTION.unavailable + availability.why });
      continue;
    }

    const attempt = await run([...candidate.argv, BUN, probePath, String(port)]);
    const line = attempt.stdout.trim();

    if (line.startsWith('DENIED')) {
      return { proven: candidate, controlUnsandboxed, controlSandboxed: line, rejected };
    }
    if (line.startsWith('CONNECTED')) {
      rejected.push({ mechanism: candidate.mechanismUsed, why: REJECTION.didNotDeny + line });
      continue;
    }

    rejected.push({
      mechanism: candidate.mechanismUsed,
      why: REJECTION.payloadFailed + (attempt.stderr.trim().split('\n')[0] ?? `exit ${attempt.exitCode}`),
    });
  }

  return { proven: undefined, controlUnsandboxed, controlSandboxed: '', rejected };
}

/**
 * The command to run: everything after a **leading** `--`, or all of `argv`.
 *
 * Both forms are accepted because **Bun removes the first `--` before the script sees
 * it**. Invoked as `bun scripts/run-network-denied.ts -- bun test`, `process.argv.slice(2)`
 * is `['bun', 'test']`, not `['--', 'bun', 'test']`. Requiring the separator would
 * therefore reject the documented invocation, which is how that was found.
 *
 * **Only a leading separator counts.** Bun strips the *first* `--` and passes any later
 * one through, so scanning the whole array for a separator mistakes the command's own
 * arguments for it. `bun scripts/run-network-denied.ts -- bun run release:pack --
 * --skip-build` arrives as `['bun','run','release:pack','--','--skip-build']`, and an
 * `indexOf` would return `['--skip-build']` — silently discarding `bun run release:pack`
 * and running garbage in its place. That is exactly the CI invocation at
 * `.github/workflows/ci.yml`, so the bug would have replaced the tarball verification with
 * a no-op that still exited non-zero for an unrelated reason.
 */
export function commandFromArgv(argv: readonly string[]): readonly string[] {
  return argv[0] === '--' ? argv.slice(1) : [...argv];
}

/**
 * The command, with its executable resolved to an absolute path.
 *
 * The mechanisms run the command through `sudo`, which replaces `PATH` with `secure_path`.
 * A command named by bare word is therefore resolvable *outside* the sandbox and not
 * inside it, which is how the shipped defect presented: `bun run typecheck` became
 * `exec: bun: not found`. Resolution happens here, against the caller's real `PATH`,
 * before the name ever crosses the boundary.
 *
 * A name that cannot be resolved is a usage error, not a mechanism problem — returning it
 * unresolved would push the failure inside the sandbox where it gets misread as one.
 */
export function resolveCommand(command: readonly string[]): readonly string[] | undefined {
  const [executable, ...rest] = command;
  if (executable === undefined) return undefined;
  if (executable.includes('/')) return [executable, ...rest];
  const resolved = Bun.which(executable);
  return resolved === null ? undefined : [resolved, ...rest];
}

async function main(): Promise<number> {
  const command = commandFromArgv(process.argv.slice(2));
  if (command.length === 0) {
    console.error('usage: bun scripts/run-network-denied.ts -- <command> [args...]');
    return 2;
  }

  const resolved = resolveCommand(command);
  if (resolved === undefined) {
    console.error(`run-network-denied: cannot resolve "${command[0]}" on PATH; refusing to run.`);
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
    console.log(`run-network-denied: running: ${resolved.join(' ')}`);

    const proc = Bun.spawn([...proof.proven.argv, ...resolved], {
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
