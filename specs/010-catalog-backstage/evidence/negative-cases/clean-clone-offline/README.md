# Negative case: the clean clone, and its offline guarantee

**Task**: T093 · **Discharges**: FR-050 · **Observed**: 2026-08-05, Phase G
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Commands**: `bun run check:clean-clone` · `bun scripts/run-network-denied.ts -- <cmd>`
**Permanent automated case**: `scripts/run-network-denied.test.ts` (29 tests)

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

## The verification itself

Output: [`clean-clone-verification.observed.txt`](./clean-clone-verification.observed.txt)

Performed 2026-08-05 against a **genuinely fresh `git clone`** into `/tmp` with no
`node_modules` — not against the working tree, where prior state would have masked whether
the arrangement worked at all. That distinction is what turned up case 3 below.

| Step | Network | Result |
|---|---|---|
| `bun install --frozen-lockfile` | **permitted** — the only step | ok |
| `check:clean-clone` | **not denied in this run** | both packages present, 31+51 and 7+11 modules |
| `typecheck` | denied | clean |
| `build` | denied | both new packages built, exit 0 |
| `bun test` | not denied — see case 3 | **2136 pass, 0 fail** |
| `compare-accept-corpus` | denied | **PASS — 24 expected, 0 FP, 0 FN** |
| `adr lint` | denied | 20 records, 0 errors, 0 warnings |

**Those are the seven commands the capture contains, and no others.** An earlier version of
this table also listed `lint`, `check:deps`, `check:freeze-hashes`, `check:clause8` and
`check:no-spike-heuristics` as `denied / all ok`, and marked `check:clean-clone` as denied.
None of that is in the cited file: those five commands were never run in this session, and
`check:clean-clone` ran unwrapped here (it is wrapped now, but was not on 2026-08-05).

A table that reports results its own capture does not contain is the failure this evidence
family exists to make impossible, so the rows are cut to the capture rather than the
capture being described more generously. The full set of steps is covered by the CI run of
record below, which is the authority for what the job does today.

Every step marked `denied` above printed its proof first — `control unsandboxed =
CONNECTED:200`, `control sandboxed = DENIED` — so none of those greens rests on an
unverified sandbox. The two marked otherwise printed no such lines, which is how the
overstatement was caught.

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
3. **Do not wrap `bun test`** — chosen. The offline claim for the **generator** is
   discharged *inside* the suite by `offline-run.test.ts`, which sandboxes its own
   generation run and proves the mechanism denies before using it.

**What that costs, stated plainly.** FR-050's second half is met in the form "no step
requires network beyond `bun install --frozen-lockfile`, and every step that *can* run
under a proved denial does" — rather than "every step runs under ambient denial".

**One** post-install step is unwrapped: `bun test`, for the structural reason below.

Three were unwrapped when this section was first written and it said one. The other two —
`check:clean-clone`, and the `git diff --exit-code` verifications for the Action bundle and
the emitted schema — were incidental rather than structural and are now wrapped; the schema
step's `&& git diff` in particular ran outside the wrapper under a step whose *name* said
network denied. The history is kept rather than tidied away, because a ledger that quietly
becomes correct teaches a reader nothing about how far to trust it.

That is still weaker than "every step runs under ambient denial", and it is recorded here
rather than left for a reader to discover from the workflow file.
`observed-failing-register.md` §4.6 says the same, and T093 is unchecked on account of it.

---

## What the CI job does with this

`.github/workflows/ci.yml`'s `clean-clone-builds` routes every post-install step through
`scripts/run-network-denied.ts` **except one**, and the exception is named here rather than
left to be discovered from the workflow file: `bun test`.

`check:clean-clone` and the two `git diff --exit-code` verifications were a second and
third exception until they were wrapped. They ran unwrapped only because of where they sat
in the job, while this paragraph claimed every subsequent step was routed — the claim was
wrong, and it is recorded as having been wrong rather than quietly corrected.

## The image is pinned, and why only this job

`runs-on: ubuntu-24.04`, not `ubuntu-latest`. This job's viability depends on three
properties of the runner image rather than on anything in this repository: AppArmor's
unprivileged-user-namespace restriction (which is why candidate 1 is refused and the sudo
candidate is selected), passwordless `sudo -n` with a `secure_path` that excludes
`~/.bun/bin`, and `unshare`/`setpriv` from util-linux. The 22.04 → 24.04 migration is what
introduced the first of those.

Because the gate is fail-closed by design, an ambient image bump would turn this job red on
every PR and push simultaneously, and the fix would live in a workflow file — needing a
`workflow`-scoped token while branch protection built on this job blocks everything else.

**Break-glass**, recorded so it does not have to be reconstructed under that pressure:

| Symptom | What it means | Action |
|---|---|---|
| `unavailable here: … /proc/self/uid_map: Operation not permitted` on candidate 1 **and** the sudo candidate proves | normal on `ubuntu-24.04` | none; this is the expected path |
| every candidate `unavailable here:` | the image lost `sudo -n`, `unshare`, or `setpriv` | revert `runs-on` to `ubuntu-24.04` image `20260810.271.1` behaviour by pinning the older label, or add a candidate for the new image — **do not** remove the wrapper |
| `the loopback control never connected` | fault in this script or a proxy routing 127.0.0.1 off-host | check `HTTP(S)_PROXY`/`NO_PROXY`; no candidate was tried |
| `every candidate MECHANISM RAN, and the probe payload failed` | our payload, not the environment | check the probe file and `PATH` handling |

Verified green on the pinned `ubuntu-24.04` image, run
[31761606849](https://github.com/mbeacom/adrkit/actions/runs/31761606849/job/94648969631)
— the first run after pinning, which records `Image: ubuntu-24.04` rather than resolving
`ubuntu-latest`. The other jobs
stay on `ubuntu-latest` deliberately: none depends on image internals, so pinning them
would add bumps to review without covering a risk.

## Why `bun test` cannot be wrapped, on either platform

The suite contains the two-sided controls that *prove* the denial, and a control cannot
establish a denial from inside one. Observed on both, failing differently, which is what
makes it structural rather than a macOS quirk:

| Platform | Mechanism | Result of wrapping |
|---|---|---|
| macOS | `sandbox-exec` (denies loopback outright) | 3 failures, `Failed to start server. Is port 0 in use?` |
| Linux | `unshare --net` (brings `lo` **up**) | that failure does **not** occur — and 11 tests still fail, because the denial-proving tests must nest a sandbox inside the one wrapping them |

Case 3 records the macOS observation; [`case-3b-linux-wrapped-suite.observed.txt`](./case-3b-linux-wrapped-suite.observed.txt)
records the Linux one. The Linux result is the more informative of the two: it rules out
the obvious reading of case 3, which is that loopback denial was the whole problem and a
kinder sandbox would fix it.

Narrowing the exemption to just the two denial-proving files was considered and rejected.
`bun test` has no exclusion filter, so it would mean an explicit allowlist of paths to run
denied — and a stale entry in that list means tests silently not running, which is the
defect `check:clean-clone` exists to catch. Trading a disclosed exemption for an
undisclosed coverage hole is not an improvement.

**T093 is left unchecked on account of this**, rather than claimed with a footnote: its
second conjunct — network "permitted **only** during `bun install`" — is false as written.
Closing it needs an ADR rescoping FR-050, or a split of the task, not more code.

A bare `unshare --net` prefix was considered and rejected: if it silently stopped denying —
a changed flag, a kernel refusing the namespace, a profile typo — the job would keep
passing and the guarantee would be gone with nothing to notice. Case 1 above is that
scenario, made observable.

**Honest limit, and how it resolved.** The two cases above were observed on macOS (Darwin),
where `sandbox-exec` is the mechanism that proves; this section previously recorded that
the Linux candidates "have not been observed running on a Linux host by this session", and
that if neither proved the job would fail closed — "visible immediately as a red build, not
a silent downgrade".

Both halves turned out to matter. The job did fail closed, five runs running, exactly as
predicted and never silently. But the reason it gave was **wrong**: a qualifying mechanism
was available on the runner the whole time and was being discarded because the payload
could not be resolved under `sudo`'s `secure_path`. See
[`../network-denial/`](../network-denial/) Part 2 for the three defects and their cases.

Now observed: `sudo -n unshare --net` with the invoking user restored, proving on the CI
runner itself, in
[run 31656503096](https://github.com/mbeacom/adrkit/actions/runs/31656503096/job/94312031698).

## Standing constraints

ADR-0014 **rung 1 only**. A clean clone building green is unit/contract/conformance
evidence; it is not reference verification and it is not external validation.
