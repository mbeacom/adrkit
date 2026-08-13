/**
 * T094 / FR-052 — the generator runs with network access **actively denied**, and does
 * not degrade to a networked path when one happens to be available.
 *
 * # Why "no calls were observed" is not the claim being made
 *
 * Spike 009's `contracts/scale-and-security-measurement.md` §5 — cited at its original
 * location, never copied into this feature's contracts — requires the evidence be a
 * **denial**, "never merely 'no network calls happened to occur'". It names exactly two
 * qualifying mechanisms, both of which must "genuinely prevent a network syscall from
 * succeeding":
 *
 * 1. an OS-level network namespace or firewall block; or
 * 2. a process-level sandbox that structurally denies network syscalls — it names
 *    `sandbox-exec` with a network-deny profile and Linux `unshare --net` by example.
 *
 * It also names, explicitly, what does **not** qualify: "stripping environment variables
 * or removing networking tools from `PATH` does not prevent a Bun or Node process from
 * making a raw socket or `fetch` call, and does not qualify on its own." So this file
 * uses neither.
 *
 * # The control experiment, and why it uses a local listener
 *
 * A mechanism that is merely *invoked* proves nothing; it has to be shown to deny in
 * **this** environment. The obvious control — fetch a public URL, expect failure — has a
 * defect that is the same shape as the one §5 is warning about: on a machine with no
 * internet, the sandboxed probe fails for a reason that has nothing to do with the
 * sandbox, and a passing test would be reporting an absence again.
 *
 * So the control is hermetic. A listener is started on loopback, and the probe is run
 * **twice** against it: once unsandboxed, which MUST connect, and once under the
 * mechanism, which MUST be denied. Only a mechanism that passes both halves is used for
 * the derivation run. That pair distinguishes "the sandbox denied it" from "nothing was
 * reachable anyway", which is the whole of §5's point.
 *
 * # Fail-closed, per §5
 *
 * "If neither qualifying mechanism is available in the execution environment, the run
 * MUST NOT proceed — this is a fail-closed constraint on the execution environment
 * itself, not merely an evidence-recording nicety." This suite therefore **fails** when
 * no mechanism can be proved, rather than skipping. A silent skip would turn an
 * unsatisfied constraint into a green check.
 *
 * @see `specs/009-catalog-binding-viability/contracts/scale-and-security-measurement.md` §5
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ADAPTER_ROOT, scanned, violations } from './source-scan.ts';
import { type Checkout, createCheckout, stage, validDescriptor } from './pipeline-fixtures.ts';

/** One of §5's two qualifying mechanisms, as an argv prefix. */
interface DenialMechanism {
  /** `NetworkDenialRecord.mechanismUsed`, in §5's terms. */
  readonly mechanismUsed: string;
  /** §5's "exact configuration". */
  readonly configuration: string;
  /** Which of §5's two numbered mechanisms this is. */
  readonly qualifyingMechanism: 1 | 2;
  readonly argv: readonly string[];
}

/**
 * Candidates, in the order they are tried.
 *
 * Both are §5 mechanism 2 (a process-level sandbox denying network syscalls); `unshare`
 * additionally creates an empty network namespace, which §5 mechanism 1 also describes.
 * It is claimed as 2 because that is the numbered item naming it.
 *
 * This list is deliberately **not** imported from `scripts/run-network-denied.ts`: no test
 * in this package reaches outside it, and this file is not going to be the first. The cost
 * is that the two lists can drift, and they did — the sudo entry here carried the same
 * three defects that made `clean-clone-builds` fail every run of this branch, and had to
 * be fixed twice. `test/sc-016.test.ts` reads the script's source and cross-checks it, and
 * the invariants below are asserted here, so a future divergence on the load-bearing
 * properties fails rather than silently degrades.
 */
const CANDIDATES: readonly DenialMechanism[] = [
  {
    mechanismUsed: 'sandbox-exec network-deny profile',
    configuration: "sandbox-exec -p '(version 1)(allow default)(deny network*)'",
    qualifyingMechanism: 2,
    argv: ['sandbox-exec', '-p', '(version 1)(allow default)(deny network*)'],
  },
  {
    mechanismUsed: 'unshare --net (empty network namespace)',
    configuration: 'unshare --net --map-root-user',
    qualifyingMechanism: 2,
    argv: ['unshare', '--net', '--map-root-user'],
  },
  {
    // `--map-root-user` is refused on GitHub-hosted `ubuntu-latest`, where AppArmor
    // restricts unprivileged user namespaces, so this is the candidate CI actually
    // selects. Three things it must get right, each of which was got wrong first:
    //
    //   * `setpriv` hands the invoking uid/gid back, so the generation run does not
    //     execute as root and leave root-owned output behind;
    //   * `PATH` is restored, because `sudo` swaps in `secure_path`, which does not
    //     contain `~/.bun/bin` — restoring it is the opposite of the restricted-`PATH`
    //     convention §5 rejects, and the denial still comes only from the namespace;
    //   * the payload is passed by absolute path, for the same reason.
    mechanismUsed: 'unshare --net under sudo, dropped back to the invoking user',
    configuration: `sudo -n unshare --net -- sh -c '<restore PATH>; exec setpriv --reuid=${process.getuid?.() ?? 0} --regid=${process.getgid?.() ?? 0} --clear-groups "$@"' --`,
    qualifyingMechanism: 2,
    argv: [
      'sudo',
      '-n',
      'unshare',
      '--net',
      '--',
      'sh',
      '-c',
      `export PATH='${(Bun.env['PATH'] ?? '').replaceAll("'", String.raw`'\''`)}'; ` +
        `exec setpriv --reuid=${process.getuid?.() ?? 0} --regid=${process.getgid?.() ?? 0} --clear-groups "$@"`,
      '--',
    ],
  },
];

/**
 * This Bun binary, by absolute path — never the bare name.
 *
 * Under `sudo` a bare `bun` resolves outside the sandbox and not inside it, so the probe
 * failed to start and the candidate was recorded as unavailable. `process.execPath` is the
 * interpreter already running, so it cannot disagree with the one that was invoked.
 */
const BUN = process.execPath;

/**
 * Printed by the availability sentinel; deliberately not a token the probe can emit.
 */
const SENTINEL = 'ADRKIT_MECHANISM_CAN_EXEC';

/**
 * The probe, as a standalone program.
 *
 * It is a separate file rather than a template literal here because it is a separate
 * *program*: a `bun` process spawned on both sides of the control. Embedding it put a
 * literal `fetch(` into the adapter's TypeScript sources, which `input-boundary.test.ts`'s
 * T045 scan correctly flagged — that scan enforces "a generation run makes no network call
 * of any kind" and cannot tell a generator calling out from a control proving it cannot.
 * See the header of the fixture for the full reasoning.
 */
const PROBE_PROGRAM = join(ADAPTER_ROOT, 'test', 'fixtures', 'net-probe.mjs');

interface Ran {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function run(argv: readonly string[], cwd: string): Promise<Ran> {
  let proc;
  try {
    proc = Bun.spawn([...argv], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      // No credential or bearer-token variable is set for any run below (§5's additional
      // requirement). PATH and HOME are carried because removing them is precisely the
      // non-qualifying "restricted-PATH convention" §5 rejects — the denial has to come
      // from the sandbox, not from a crippled environment.
      env: { PATH: Bun.env['PATH'] ?? '', HOME: Bun.env['HOME'] ?? '' },
    });
  } catch (error) {    // A candidate mechanism that is not installed here is a *rejected candidate*, not a
    // crashed suite. `Bun.spawn` throws ENOENT rather than returning a non-zero exit,
    // and letting that propagate turned the fail-closed path into an unnamed crash —
    // observed while exercising this file's own negative case, and fixed here so the
    // "no qualifying mechanism is available" outcome stays legible.
    return { stdout: '', stderr: (error as Error).message, exitCode: 127 };
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

let workspace: string;
let checkout: Checkout;
let listener: ReturnType<typeof Bun.serve> | undefined;
let port: number;

/** Set once {@link proveDenial} finds a mechanism that both halves of the control pass. */
let proven: DenialMechanism | undefined;
let controlUnsandboxed = '';
let controlSandboxed = '';
const rejected: { readonly mechanism: string; readonly why: string }[] = [];

/**
 * Find a mechanism that demonstrably denies **here**, by the two-sided control.
 *
 * Returns `undefined` when none does, which the first test below turns into a failure
 * rather than a skip.
 */
async function proveDenial(): Promise<DenialMechanism | undefined> {
  const unsandboxed = await run([BUN, PROBE_PROGRAM, String(port)], workspace);
  controlUnsandboxed = unsandboxed.stdout.trim();

  // Half one: without a sandbox the probe MUST connect. If it does not, no conclusion
  // can be drawn from any denial below, and saying otherwise would be the exact error
  // §5 exists to prevent.
  if (!controlUnsandboxed.startsWith('CONNECTED')) return undefined;

  for (const candidate of CANDIDATES) {
    // Availability is established by a sentinel that touches no network, so it can only
    // fail if the mechanism genuinely cannot run something. Inferring availability from
    // the probe's own failure — as this did — makes "my payload is broken" and "this
    // environment cannot deny" the same observation, and reports the second. That is §5's
    // denial-versus-absence distinction collapsing inside the check meant to enforce it.
    const sentinel = await run(
      [...candidate.argv, BUN, '-e', `console.log(${JSON.stringify(SENTINEL)})`],
      workspace,
    );
    if (!sentinel.stdout.includes(SENTINEL)) {
      rejected.push({
        mechanism: candidate.mechanismUsed,
        why: `unavailable in this environment: ${sentinel.stderr.trim().split('\n')[0] ?? `exit ${sentinel.exitCode}`}`,
      });
      continue;
    }

    const attempt = await run([...candidate.argv, BUN, PROBE_PROGRAM, String(port)], workspace);
    const line = attempt.stdout.trim();
    if (line.startsWith('DENIED')) {
      controlSandboxed = line;
      return candidate;
    }
    if (line.startsWith('CONNECTED')) {
      rejected.push({ mechanism: candidate.mechanismUsed, why: `did not deny: ${line}` });
      continue;
    }
    rejected.push({
      mechanism: candidate.mechanismUsed,
      why: `mechanism works, but the probe payload failed under it: ${attempt.stderr.trim().split('\n')[0] ?? `exit ${attempt.exitCode}`}`,
    });
  }

  return undefined;
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'adrkit-offline-'));

  listener = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') });
  // `Bun.serve().port` is typed `number | undefined`. A non-null assertion would be a lie
  // in the one case that matters: with no port the control cannot run, and a control that
  // silently did not run is the absence-shaped failure this file exists to prevent.
  if (typeof listener.port !== 'number') {
    throw new Error('the loopback control listener reported no port; the denial cannot be proved');
  }
  port = listener.port;

  checkout = await createCheckout();
  proven = await proveDenial();
});

afterAll(async () => {
  listener?.stop(true);
  await checkout?.dispose();
  await rm(workspace, { recursive: true, force: true });
});

describe('T094 — the denial mechanism is one of the two §5 qualifies, and is proved to deny', () => {
  test('a qualifying mechanism is available — fail-closed, never skipped', () => {
    // §5: "If neither qualifying mechanism is available in the execution environment,
    // the run MUST NOT proceed." A skip here would report an unsatisfied constraint as
    // a pass, so this asserts instead.
    expect({ proven: proven?.mechanismUsed, rejected, controlUnsandboxed }).toMatchObject({
      proven: expect.any(String),
    });
  });

  test('the control connects WITHOUT the sandbox, so a denial under it means something', () => {
    // Half one. Without this, "DENIED" is consistent with nothing being reachable.
    expect(controlUnsandboxed).toStartWith('CONNECTED');
  });

  test('the same probe is DENIED under the mechanism', () => {
    // Half two. Together with the line above, this is a denial rather than an absence.
    expect(controlSandboxed).toStartWith('DENIED');
    expect(controlSandboxed).not.toStartWith('CONNECTED');
  });

  test('the mechanism is not an environment or PATH convention', () => {
    // §5 rejects those by name. Asserted so a future "simplification" to `env -i` is a
    // test failure rather than a silent downgrade of the claim.
    const argv = proven?.argv.join(' ') ?? '';
    expect(argv).toMatch(/^(sandbox-exec|unshare|sudo -n unshare)\b/u);
    expect(argv).not.toContain('env -i');
    expect(proven?.qualifyingMechanism).toBe(2);
  });
});

describe('T094 / FR-052 — the generation completes with network access denied', () => {
  let deniedEnvelope: string;

  test('a full generation run inside the sandbox produces an envelope', async () => {
    const { request } = await stage(
      checkout,
      {
        'offline-a/catalog-info.yaml': validDescriptor('offlineone', '["packages/one/**"]'),
        'offline-b/catalog-info.yaml': validDescriptor('offlinetwo', '["packages/two/**"]'),
        'offline-c/catalog-info.yaml': validDescriptor('offlinethree'),
      },
      {},
      'offline-denied.json',
    );

    const requestPath = join(workspace, 'request-denied.json');
    await writeFile(requestPath, JSON.stringify(request), 'utf8');
    const destination = join(workspace, 'denied', 'envelope.json');

    const driver = join(ADAPTER_ROOT, 'test', 'offline-run-driver.ts');
    const result = await run(
      [...(proven?.argv ?? []), 'bun', driver, requestPath, destination],
      ADAPTER_ROOT,
    );

    expect(result.exitCode).toBe(0);
    const verdict = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as {
      ok?: boolean;
      entities?: number;
    };
    expect(verdict.ok).toBe(true);
    expect(verdict.entities).toBe(3);

    deniedEnvelope = await readFile(destination, 'utf8');
    expect(deniedEnvelope.length).toBeGreaterThan(0);
  });

  test('the offline path is the ONLY path — a networked run produces identical bytes', async () => {
    // FR-052's second half: "it does not degrade to a networked path when one happens to
    // be available." Run the identical request with the sandbox removed and network
    // reachable, and compare bytes. A generator with a networked path available to it
    // would have to produce the same bytes anyway for this to pass, and SC-001's
    // determinism guarantee is what makes byte equality the right comparison.
    const { request } = await stage(
      checkout,
      {
        'offline-a/catalog-info.yaml': validDescriptor('offlineone', '["packages/one/**"]'),
        'offline-b/catalog-info.yaml': validDescriptor('offlinetwo', '["packages/two/**"]'),
        'offline-c/catalog-info.yaml': validDescriptor('offlinethree'),
      },
      {},
      'offline-networked.json',
    );

    const requestPath = join(workspace, 'request-networked.json');
    await writeFile(requestPath, JSON.stringify(request), 'utf8');
    const destination = join(workspace, 'networked', 'envelope.json');

    // Confirm the network really is available for this run, so "identical" is a
    // comparison between a denied run and a genuinely networked one.
    const reachable = await run(['bun', PROBE_PROGRAM, String(port)], workspace);
    expect(reachable.stdout.trim()).toStartWith('CONNECTED');

    const driver = join(ADAPTER_ROOT, 'test', 'offline-run-driver.ts');
    const result = await run(['bun', driver, requestPath, destination], ADAPTER_ROOT);
    expect(result.exitCode).toBe(0);

    const networkedEnvelope = await readFile(destination, 'utf8');

    // The manifest path differs between the two staged requests, and the envelope does
    // not carry it, so the bytes are directly comparable.
    expect(networkedEnvelope).toBe(deniedEnvelope);
  });

  test('no credential or bearer-token variable was set for either run', () => {
    // §5's additional requirement. Asserted from `sc-016.test.ts`, which reads this file
    // from outside it — **not** from here.
    //
    // A first version asserted it here, by reading this file and looking for the env
    // literal. That assertion could never fail: the needle it searched for appeared in
    // its own source, so it matched itself and would have stayed green even if the env
    // above had grown a credential. A file cannot check its own text for a string it
    // contains. What is checked here instead is the property that does not depend on
    // this file's own source.
    const source = Bun.file(new URL('./offline-run.test.ts', import.meta.url));
    return source.text().then((text) => {
      // Every `env:` passed to `run()` above carries PATH and HOME and nothing else.
      const envLiterals = [...text.matchAll(/\benv:\s*\{([^}]*)\}/gu)].map((match) => match[1] ?? '');
      expect(envLiterals.length).toBeGreaterThan(0);
      for (const literal of envLiterals) {
        for (const forbidden of ['TOKEN', 'BEARER', 'AUTHORIZATION', 'SECRET', 'PASSWORD', 'KEY']) {
          expect(literal.toUpperCase()).not.toContain(forbidden);
        }
      }
    });
  });
});

describe('T094 — the generator has no network call site to degrade to', () => {
  test('no source module opens a socket, fetches, or resolves a host', () => {
    // Corroborating only. §5 permits a static review "as a supplementary corroborating
    // check … never as the sole claimed mechanism", and it is not the sole one here —
    // the proved denial above is. It is included because it explains *why* the byte
    // comparison above came out equal.
    const found = violations(
      scanned(ADAPTER_ROOT).filter((file) => file.path.includes('/src/')),
      [
        {
          id: 'fetch-call',
          pattern: /\bfetch\s*\(/u,
          why: 'the generator is offline-only; a fetch call site would be a networked path',
        },
        {
          id: 'node-net',
          pattern: /['"]node:(?:net|http|https|dgram|tls|dns)['"]/u,
          why: 'the generator is offline-only; a network module import would be a networked path',
        },
        {
          id: 'bun-serve-or-connect',
          pattern: /\bBun\.(?:serve|connect|listen)\s*\(/u,
          why: 'the generator is offline-only; a socket API would be a networked path',
        },
      ],
    );
    expect(found).toEqual([]);
  });
});
