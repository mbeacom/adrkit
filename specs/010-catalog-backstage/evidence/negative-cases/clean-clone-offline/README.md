# Negative case: the clean clone, and its offline guarantee

**Task**: T093 · **Discharges**: FR-050 · **Observed**: 2026-08-05, Phase G
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Commands**: `bun run check:clean-clone` · `bun scripts/run-network-denied.ts -- <cmd>`
**Permanent automated case**: `scripts/run-network-denied.test.ts` (12 tests)

FR-050 has two halves, and they fail in different ways:

1. a clean clone is green **with both feature-010 packages present**;
2. network access is permitted **only** during `bun install --frozen-lockfile`.

Each half has a case below, because each half has a way of being silently untrue.

---

## Case 1 — no denial mechanism can be proved

Input: [`case-1-no-provable-mechanism.patch`](./case-1-no-provable-mechanism.patch) ·
Output: [`case-1-no-provable-mechanism.observed.txt`](./case-1-no-provable-mechanism.observed.txt)

`CANDIDATES` in `scripts/run-network-denied.ts` was emptied, simulating an environment
where neither of spike 009 §5's qualifying mechanisms is available.

```
run-network-denied: FAIL-CLOSED — no qualifying denial mechanism could be proved here.
  control (unsandboxed): CONNECTED:200
  scale-and-security-measurement.md §5: "If neither qualifying mechanism is available in the execution environment, the run MUST NOT proceed." Refusing to run the command unprotected.
exit=1
```

**The command did not run.** That is the whole point: the alternative behaviour — running
it unprotected and reporting green — would leave every CI run passing with the guarantee
gone and nothing to notice. §5 makes this a constraint on the execution environment, not an
evidence-recording nicety, so the script exits 1 without executing anything.

Note the control line: `CONNECTED:200`. The unsandboxed half still worked, so the failure
is "no mechanism denied" and not "nothing was reachable". Those are different failures and
the output distinguishes them.

---

## Case 2 — a package becomes invisible to the build

Input: [`case-2-package-invisible-to-the-build.patch`](./case-2-package-invisible-to-the-build.patch) ·
Output: [`case-2-package-invisible-to-the-build.observed.txt`](./case-2-package-invisible-to-the-build.observed.txt)

`@adrkit/catalog-envelope`'s `build` script was removed.

```
check-clean-clone: FAIL — FR-050 requires both feature-010 packages present.
  @adrkit/catalog-envelope: declares no "build" script, so the root --filter='*' run would skip it silently
exit=1
```

**And `bun run build` stayed green**, having quietly built three packages instead of four:

```
@adrkit/cli build: Exited with code 0
@adrkit/spec-kit build: Exited with code 0
@adrkit/catalog-backstage build: Exited with code 0
```

That pairing is the case. FR-050's claim is not "a clean clone is green" — a clone missing
a package is green too, there is simply less to do. The claim is that it is green **with
both packages present**, and nothing but this check tests the second half.

It is the same defect `package-boundary.md` §4 documents for `check:deps`, where a package
with no allowlist entry is silently unconstrained: an absent rule and a satisfied rule
produce identical output. Both are closed the same way — assert the thing exists before
concluding anything from its passing.

---

## Restored

[`restored.observed.txt`](./restored.observed.txt) — `check-clean-clone: ok` for both
packages, and the denial runner proving `CONNECTED` → `DENIED` and executing its command.

---

## Case 3 — wrapping the whole suite in total denial is self-contradictory

Output: [`case-3-suite-wrapped-in-total-denial.observed.txt`](./case-3-suite-wrapped-in-total-denial.observed.txt)

This one has no patch, because it was not a deliberate mutation. It is what happened when
the clean-clone verification actually ran `bun scripts/run-network-denied.ts -- bun test`
against a fresh clone — the arrangement the CI job originally used.

```
error: Failed to start server. Is port 0 in use?
    code: "EADDRINUSE"
(fail) (unnamed)
 2116 pass
 3 fail
```

All three failures are `Bun.serve({ port: 0, hostname: '127.0.0.1' })` — in
`scripts/run-network-denied.test.ts` and `offline-run.test.ts`, **the two files whose job
is to prove the denial**. Their two-sided control needs a loopback listener, and a
total-denial sandbox correctly refuses to bind one.

The conflict is real rather than incidental. A control that proves denial has to touch the
network boundary; running it inside an ambient denial denies the control that establishes
the denial. Three responses were possible:

1. **Skip those tests under denial.** Rejected — §5 makes fail-closed a constraint on the
   environment, and a skip converts an unsatisfied constraint into a green run. It is also
   what `sc-016.test.ts` asserts the suite does not do.
2. **Loosen the profile to permit loopback while denying egress.** This is what
   `unshare --net` with `lo` up already gives on Linux, and it is the semantically correct
   reading of "network denied" — no route off the host. But the two-sided control then
   needs an *external* endpoint to prove egress is denied, which reintroduces the internet
   dependency the loopback control was designed to remove. Rejected for the macOS profile;
   the Linux candidates keep this shape because there the isolation is structural.
3. **Do not wrap `bun test`** — chosen. Every other step is wrapped; `bun test` is not, and
   the offline claim for the **generator** is discharged *inside* the suite by
   `offline-run.test.ts`, which sandboxes its own generation run and proves the mechanism
   denies before using it.

**What that costs, stated plainly.** FR-050's second half is met in the form "no step
requires network beyond `bun install --frozen-lockfile`, and every step that *can* run
under a proved denial does" — rather than "every step runs under ambient denial". The one
unwrapped step is the one whose own content proves the generator never reaches the network.
That is a weaker statement than the original wording implies, and it is recorded here
rather than left for a reader to discover from the workflow file.

---## What the CI job does with this

`.github/workflows/ci.yml`'s `clean-clone-builds` runs `check:clean-clone` immediately
after the install, then routes **every** subsequent step through
`scripts/run-network-denied.ts`. `bun install --frozen-lockfile` is the only step permitted
to use the network.

A bare `unshare --net` prefix was considered and rejected: if it silently stopped denying —
a changed flag, a kernel refusing the namespace, a profile typo — the job would keep
passing and the guarantee would be gone with nothing to notice. Case 1 above is that
scenario, made observable.

**Honest limit, stated rather than left to inference.** The two cases above were observed
on macOS (Darwin), where `sandbox-exec` is the mechanism that proves. The Linux candidates
(`unshare --net --map-root-user`, then `sudo -n unshare --net`) are exercised by the same
code path but **have not been observed running on a Linux host by this session**. If
neither proves on the CI runner, the job fails closed — which is the designed behaviour and
would be visible immediately as a red build, not as a silent downgrade.

## Standing constraints

ADR-0014 **rung 1 only**. A clean clone building green is unit/contract/conformance
evidence; it is not reference verification and it is not external validation.
