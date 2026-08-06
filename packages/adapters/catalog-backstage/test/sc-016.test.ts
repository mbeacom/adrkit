/**
 * T095 / SC-016 close-out — the evidence is a **denial**, not an absence of observed
 * calls.
 *
 * # The distinction this file exists to hold
 *
 * SC-016 is the one success criterion that can be satisfied by an artifact that proves
 * nothing. "We ran the generator and saw no network calls" is **consistent with a
 * networked path that simply was not taken** — a code path guarded by a credential that
 * happened to be unset, a fallback that happened not to trigger, a cache that happened to
 * be warm. An absence is evidence about the run; a denial is evidence about the
 * environment the run was confined to.
 *
 * Spike 009's `contracts/scale-and-security-measurement.md` §5 states the requirement in
 * those terms: network access must be "**actively denied** for the run's duration — never
 * merely 'no network calls happened to occur,' and never merely a documentation-only
 * review of the generator's own source."
 *
 * **That contract is cited at its original location and is not copied into this
 * feature's contracts** — T095's instruction, and `contracts/README.md` §2's adoption
 * model, under which spike 009's contracts are adopted by reference and are "a frozen
 * historical record … not edited by this feature".
 *
 * # What discharges SC-016, and what merely corroborates
 *
 * | Element | Status under §5 |
 * |---|---|
 * | A proved OS/process-level denial mechanism | **Qualifies** (mechanism 1 or 2) |
 * | The two-sided control that proves it denies *here* | What makes the above a denial |
 * | No credential/bearer variable set | Additional §5 requirement |
 * | Static review: no call site in generator source | **Corroborating only** — never sole |
 * | "No calls were observed" | **Does not qualify at all** |
 *
 * The rows are asserted below in that order, including the last one: this file checks
 * that the suite does **not** rest on an absence, because a close-out that merely
 * asserted the good rows would not notice a future change that quietly added the bad one.
 *
 * @see `specs/009-catalog-binding-viability/contracts/scale-and-security-measurement.md` §5
 * @see `packages/adapters/catalog-backstage/test/offline-run.test.ts` — the run itself
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTER_ROOT, REPO_ROOT, scanned, violations } from './source-scan.ts';

const OFFLINE_RUN = join(ADAPTER_ROOT, 'test', 'offline-run.test.ts');
const SPIKE_CONTRACT = join(
  REPO_ROOT,
  'specs',
  '009-catalog-binding-viability',
  'contracts',
  'scale-and-security-measurement.md',
);

async function offlineRunSource(): Promise<string> {
  return Bun.file(OFFLINE_RUN).text();
}

describe('T095 / SC-016 — the cited requirement is read at its original location', () => {
  test('spike 009 §5 exists where it is cited, and says what is attributed to it', async () => {
    // A citation nothing checks is a reference that can rot. This reads the file and
    // asserts the exact sentences the close-out relies on, so a moved or reworded §5
    // fails here rather than silently weakening every claim below.
    //
    // Whitespace is normalized before matching. The contract is hard-wrapped, so the
    // line breaks fall in the middle of the sentences being cited — matching literal
    // newlines would make this check fail on a reflow that changed no words, which is
    // brittleness rather than rigour. The words are what is being cited.
    const raw = await Bun.file(SPIKE_CONTRACT).text();
    const contract = raw.replaceAll(/\s+/gu, ' ');

    expect(raw).toContain('## 5. Security Evidence — Network Denial');
    expect(contract).toContain('never merely "no network calls happened to occur,"');
    expect(contract).toContain('two** qualifying mechanisms');
    expect(contract).toContain('OS-level network namespace or firewall block');
    expect(contract).toContain('Process-level sandbox that structurally denies network syscalls');
    // The non-qualifying construction, named by the contract itself.
    expect(contract).toContain(
      'stripping environment variables or removing networking tools from `PATH` does not prevent a Bun or Node process from making a raw socket or `fetch` call, and does not qualify on its own',
    );
    // The fail-closed constraint on the environment.
    expect(contract).toContain(
      'If neither qualifying mechanism is available in the execution environment, the run MUST NOT proceed',
    );
    // Static review is corroborating only.
    expect(contract).toContain('never as the sole claimed mechanism');
  });

  test('this feature did not copy §5 into its own contracts', async () => {
    // `contracts/README.md` §2 adopts spike 009's contracts by reference; copying §5
    // here would fork a frozen historical record and let the two drift.
    //
    // Read with `readdirSync` rather than a glob: `input-boundary.test.ts`'s T045 scan
    // forbids glob discovery in this package, and it is right to — descriptors are never
    // discovered by glob expansion. Using one here for markdown would have been a
    // technically-different-but-identically-shaped construct in a file whose whole
    // subject is not leaning on technicalities.
    const contractsDir = join(REPO_ROOT, 'specs', '010-catalog-backstage', 'contracts');
    const entries = readdirSync(contractsDir, { recursive: true })
      .map(String)
      .filter((entry) => entry.endsWith('.md'));

    expect(entries.length).toBeGreaterThan(0);
    for (const relative of entries) {
      const text = await Bun.file(join(contractsDir, relative)).text();
      expect(text).not.toContain('## 5. Security Evidence — Network Denial');
      expect(text).not.toContain('never merely "no network calls happened to occur,"');
    }
  });
});

describe('T095 / SC-016 — the evidence is a denial', () => {
  test('a qualifying mechanism is named, with its exact configuration', async () => {
    // §5: "Whichever mechanism is actually used MUST be named explicitly in the evidence
    // bundle (`NetworkDenialRecord.mechanismUsed`), along with its exact configuration."
    const source = await offlineRunSource();
    expect(source).toContain('mechanismUsed');
    expect(source).toContain('configuration');
    expect(source).toContain('qualifyingMechanism');
    expect(source).toContain("(version 1)(allow default)(deny network*)");
    expect(source).toContain('unshare --net');
  });

  test('the denial is PROVED by a two-sided control, not merely invoked', async () => {
    // The load-bearing assertion of this whole criterion. One-sided evidence — "the
    // probe failed under the sandbox" — is an absence wearing a denial's clothes: it is
    // equally consistent with nothing having been reachable. Both halves are required.
    const source = await offlineRunSource();
    expect(source).toContain("expect(controlUnsandboxed).toStartWith('CONNECTED')");
    expect(source).toContain("expect(controlSandboxed).toStartWith('DENIED')");
    // And the control is hermetic, so it does not itself depend on internet reachability.
    expect(source).toContain('Bun.serve({ port: 0, hostname: \u0027127.0.0.1\u0027');
  });

  test('the run is fail-closed: no mechanism means failure, never a skip', async () => {
    // §5 makes this a constraint on the execution environment, not an evidence nicety.
    // A `test.skipIf` here would convert an unsatisfied constraint into a green run.
    const source = await offlineRunSource();
    expect(source).toContain('fail-closed, never skipped');
    expect(source).not.toContain('test.skip');
    expect(source).not.toContain('.skipIf(');
    expect(source).not.toContain('it.skip');
  });

  test('no credential or bearer-token variable is set for the run', async () => {
    const source = await offlineRunSource();
    expect(source).toContain("env: { PATH: Bun.env['PATH'] ?? '', HOME: Bun.env['HOME'] ?? '' }");
  });
});

describe('T095 / SC-016 — what does NOT qualify is not being leaned on', () => {
  test('the mechanism is not an env-stripping or PATH convention', async () => {
    // §5 rejects these by name: "stripping environment variables or removing networking
    // tools from `PATH` does not prevent a Bun or Node process from making a raw socket
    // or `fetch` call, and does not qualify on its own."
    const source = await offlineRunSource();
    expect(source).not.toContain("['env', '-i'");
    expect(source).not.toContain('PATH: \u0027\u0027');
    // The candidates are all real sandboxes.
    for (const candidate of ['sandbox-exec', 'unshare']) {
      expect(source).toContain(candidate);
    }
  });

  test('the static source review is labelled corroborating, never the sole mechanism', async () => {
    // §5 permits it "only as a supplementary corroborating check … never as the sole
    // claimed mechanism for any FR-009 derivation run". The label is asserted so the
    // qualification cannot be dropped while the check stays.
    const source = await offlineRunSource();
    expect(source).toContain('Corroborating only');
    expect(source).toContain('never as the sole claimed mechanism');
    expect(source).toContain('the proved denial above is');
  });

  test('SC-016 is not claimed from an absence of observed calls anywhere in this package', () => {
    // The negative form, which is the one that would rot silently. If a future change
    // adds "we saw no network calls" as the *basis* of the claim, it lands here.
    const found = violations(scanned(ADAPTER_ROOT), [
      {
        id: 'absence-as-evidence',
        pattern: /no\s+network\s+calls\s+(?:were\s+)?(?:observed|made|seen)/iu,
        why:
          'spike 009 §5 forbids resting the claim on an absence of observed calls; ' +
          'the claim must rest on a proved denial',
      },
    ]);
    expect(found).toEqual([]);
  });
});

describe('T095 / SC-016 — standing honesty constraints', () => {
  test('the claim is scoped to a predicate return, not to Backstage as a system', async () => {
    const source = await offlineRunSource();
    // The offline run makes no Backstage claim at all; asserted so one is not added.
    expect(source).not.toContain('Backstage will');
    expect(source).not.toContain('Backstage does');
  });

  test('nothing here claims rung 2 or rung 3', async () => {
    // ADR-0014: this is maintainer-owned rung-1 evidence. The denial being real does not
    // make it reference-verified, and it is certainly not external.
    for (const path of [OFFLINE_RUN, join(ADAPTER_ROOT, 'test', 'sc-016.test.ts')]) {
      const text = await Bun.file(path).text();
      expect(text).not.toMatch(/\bis\s+(?:reference-verified|externally\s+validated)\b/iu);
      expect(text).not.toMatch(/\b(?:third-party|community)\s+validation\b/iu);
    }
  });
});
