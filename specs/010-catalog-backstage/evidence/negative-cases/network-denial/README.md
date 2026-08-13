# Negative case: network denial, proved rather than assumed

**Tasks**: T094 (FR-052), T095 (SC-016) · **Observed**: 2026-08-05, Phase G
**Tools**: Bun 1.3.14, TypeScript 6.0.3, macOS (Darwin) `sandbox-exec`
**Command for both cases**: `bun test test/offline-run.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated cases**: `test/offline-run.test.ts`, `test/sc-016.test.ts`

Spike 009's
[`contracts/scale-and-security-measurement.md` §5](../../../../009-catalog-binding-viability/contracts/scale-and-security-measurement.md)
— cited at its original location, never copied into this feature's contracts — requires
network access be **actively denied**, "never merely 'no network calls happened to
occur'". It names two qualifying mechanisms and names, explicitly, what does not qualify:
an `env -i`/restricted-`PATH` convention.

## The mechanism used

| Field (§5's `NetworkDenialRecord` terms) | Value |
|---|---|
| `mechanismUsed` | `sandbox-exec` network-deny profile |
| Exact configuration | `sandbox-exec -p '(version 1)(allow default)(deny network*)'` |
| Which §5 mechanism | 2 — process-level sandbox denying network syscalls |
| Fallbacks, in order | `unshare --net --map-root-user`, then `sudo -n unshare --net` |

The candidate list is ordered and each candidate is **proved** before use. On Linux CI the
first candidate is unavailable and one of the `unshare` forms is selected instead; on macOS
`sandbox-exec` is selected. Neither the selection nor the proof is recorded by hand.

## The control is two-sided, and hermetic

A mechanism that is merely *invoked* proves nothing. The control runs the same probe twice
against a **loopback listener started by the test**:

- unsandboxed — MUST report `CONNECTED`;
- under the mechanism — MUST report `DENIED`.

The listener is why the control needs no internet. The obvious control — fetch a public URL
and expect failure — repeats §5's own error one level up: on a machine with no internet the
sandboxed probe fails for a reason unrelated to the sandbox, and the test would again be
reporting an absence.

**Loopback denial was verified directly** before the test was written: under
`(deny network*)` a `fetch` to `http://127.0.0.1:<port>/` returns
`DENIED:Was there a typo in the url or port?`, while the same fetch unsandboxed returns
`CONNECTED:200`.

---

## Case 1 — the sandbox is real, but permits network

Input: [`case-1-permissive-sandbox.patch`](./case-1-permissive-sandbox.patch) ·
Output: [`case-1-permissive-sandbox.observed.txt`](./case-1-permissive-sandbox.observed.txt)

The profile was changed from `(allow default)(deny network*)` to `(allow default)` — still
a real sandbox, still `sandbox-exec`, still not an environment convention. Only the denial
was removed. This is the mutation a one-sided control cannot see.

```
(fail) T094 — … > a qualifying mechanism is available — fail-closed, never skipped
-   "proven": Any<String>
+   "proven": undefined,
+       "why": "did not deny: CONNECTED:200"

(fail) T094 — … > the same probe is DENIED under the mechanism
(fail) T094 — … > the mechanism is not an environment or PATH convention
```

Three tests fail; five still pass, including the generation itself. The failure message
carries the discriminating fact — `did not deny: CONNECTED:200` — rather than a bare
assertion mismatch.

### A defect this observation found and fixed

On the first run the suite did not fail this way. It **crashed**, with a single unnamed
failure:

```
error: Executable not found in $PATH: "unshare"
(fail) (unnamed)
```

`Bun.spawn` throws `ENOENT` for a missing executable rather than returning a non-zero exit,
so once `sandbox-exec` stopped denying, the fall-through to the Linux candidates aborted
`beforeAll` on a macOS host. §5's fail-closed requirement was technically met — nothing
proceeded — but the operator was told the wrong thing, and "no qualifying mechanism is
available" is exactly the message that must stay legible. `run()` now catches the spawn
failure and records the candidate as rejected with its reason.

This is the case for observing checks failing rather than reasoning about them: the crash
was on the path that only a failing observation ever executes.

Restored: 8 pass, 0 fail.

---

## Case 2 — a network call site appears in generator source

Input: [`case-2-fetch-call-site.patch`](./case-2-fetch-call-site.patch) ·
Output: [`case-2-fetch-call-site.observed.txt`](./case-2-fetch-call-site.observed.txt)

A `fetch` call site was added to `src/descriptor/read.ts`.

```
(fail) T094 — the generator has no network call site to degrade to > no source module opens a socket, fetches, or resolves a host
+     "ruleId": "fetch-call",
```

**This check is corroborating only, and is labelled so in the test.** §5 permits a static
source review "only as a supplementary corroborating check … never as the sole claimed
mechanism". It is retained because it explains *why* the denied run and the networked run
produce identical bytes, not because it evidences the denial.

Restored: 8 pass, 0 fail.

---

## What the two runs compare

FR-052's second half — "it does not degrade to a networked path when one happens to be
available" — is discharged by running the identical request twice: once under the proved
denial, once with the loopback listener demonstrably reachable, and comparing the envelope
**bytes**. They are equal. SC-001's determinism guarantee is what makes byte equality the
right comparison rather than a coincidence.

## The probe is a separate program, and why that is not evasion

When `offline-run.test.ts` was first written the probe was a template literal inside it.
Two of this package's own scanners then fired, correctly:

```
(fail) T045 — the package’s own sources contain none of the forbidden constructs
+     "matched": "fetch(",
+     "path": "packages/adapters/catalog-backstage/test/offline-run.test.ts",
+     "why": "FR-018 offline constraint: a generation run makes no network call of any kind."

(fail) FR-002 — no dynamic loader anywhere in the adapter source
+     "matched": "import(",
```

Both scans read comment-stripped source with string literals preserved, so a `fetch(`
inside a template literal is indistinguishable to them from a generator calling out. They
are right to be unable to tell — that is precisely the distinction a scanner cannot make.

Three responses were available, and the choice matters:

1. **Add `offline-run.test.ts` to `EXCLUDED_FROM_SCAN`.** Legitimate — it is the
   documented relief valve (`package-boundary.md` §4). Rejected because it would also
   remove the file from `sc-016.test.ts`'s absence-as-evidence scan, which is a guard that
   *should* see it. An exclusion is all-or-nothing.
2. **Break up the literal so `fetch(` does not appear contiguously.** Rejected outright:
   that is "renaming around the scanner", which the exclusion list's own documentation
   names as the wrong fix, and it leaves the trap armed for the next writer.
3. **Move the probe to `test/fixtures/net-probe.mjs`** — chosen. The probe *is* a separate
   program, spawned as its own `bun` process; representing it as one is more accurate than
   embedding it. The `fetch(` call is kept verbatim, `offline-run.test.ts` stays fully
   scannable, and `EXCLUDED_FROM_SCAN` does not grow. It remains empty of Phase G entries.

The `import(` hits were unrelated and were plain defects: `await import('./source-scan.ts')`
resolves a static path and had no reason to be dynamic. Both became static imports.

`sc-016.test.ts` had a third, smaller version of the same problem — a `Bun.Glob` walking
the contracts directory, which `input-boundary.test.ts` flags because descriptors are never
discovered by glob expansion. It reads with `readdirSync` instead. Using a glob for markdown
would have been a technically-different-but-identically-shaped construct, in a file whose
entire subject is not leaning on technicalities.

## Standing constraints

ADR-0014 **rung 1 only**. A proved denial is a stronger claim than an absence of observed
calls; it is not a claim about rung 2 or rung 3, and it is maintainer-owned throughout.

No claim is made about Backstage as a running system.

---

# Part 2 — the mechanism that was rejected while it was working

**Tasks**: T093 (FR-050), T094 (FR-052) · **Observed**: 2026-08-12, Phase G
**Command for cases 3–5**: `bun test scripts/run-network-denied.test.ts`
**Permanent automated cases**: `scripts/run-network-denied.test.ts`

Part 1 records that the denial is proved rather than assumed. This part records that the
proof itself was wrong in a way the tests above could not see, because every one of them
ran on a host where the *first* candidate succeeds.

`clean-clone-builds` failed on **every run of this branch**, five for five, from
2026-08-08 to 2026-08-12 — always at its first denied step, always reporting:

```
run-network-denied: FAIL-CLOSED — no qualifying denial mechanism could be proved here.
  rejected: unshare --net (…) — unavailable here: unshare: write failed /proc/self/uid_map: Operation not permitted
  rejected: unshare --net under sudo (…) — unavailable here: --: 1: exec: bun: not found
  rejected: sandbox-exec network-deny profile — unavailable here: Executable not found in $PATH: "sandbox-exec"
```

That report was false. `--: 1:` is the *inner* `sh` speaking, not `unshare`: `sudo -n
unshare --net` had already succeeded and the namespace existed. Only the payload could not
be resolved, because `sudo` replaces `PATH` with `secure_path`, which does not contain
`/home/runner/.bun/bin` where `setup-bun` installs Bun. **A qualifying mechanism was
available on that runner the whole time, and was discarded on the strength of a broken
payload.**

This is the file's own subject matter turned on itself. §5 distinguishes a denial from an
absence; "no qualifying mechanism is available in this environment" is an absence claim,
and it was being made without being earned.

## Why the existing cases could not catch it

Case 1 and case 2 were observed on macOS, where `sandbox-exec` is selected first and the
`unshare` candidates are never reached. The task's own verification
(`clean-clone-offline/clean-clone-verification.observed.txt`) records `Host: Darwin arm64`
honestly — but a macOS-only observation cannot exercise a Linux-only fallback, and the CI
job that would have is the one that never ran.

## Reproduced before it was fixed

`ubuntu:24.04`, non-root user with passwordless sudo, payload installed off `secure_path`,
loopback control listener — the runner's shape:

| Step | Result | Meaning |
|---|---|---|
| control, unsandboxed | `CONNECTED:200` | the two-sided control is valid here |
| candidate 2 **as shipped**, bare-name payload | `--: 1: exec: probe: not found` | reproduces CI character-for-character |
| candidate 2, **absolute-path** payload | `DENIED:URLError` | the mechanism qualifies and denies |
| identity inside the above | `root` | defect 3, below |
| plus `setpriv` back to the invoking uid | `runner`, `DENIED:URLError` | denies **and** keeps the user |
| control re-run | `CONNECTED:200` | the listener had not simply died |

## The three defects, and the cases that hold them

### Case 3 — the command keeps root

Input: [`case-3-privilege-not-dropped.patch`](./case-3-privilege-not-dropped.patch) ·
Output: [`case-3-privilege-not-dropped.observed.txt`](./case-3-privilege-not-dropped.observed.txt)

`sudo unshare` runs the command as **root**. `bun run build` would then leave root-owned
output in the workspace, and the *un-sandboxed* steps later in the same job — `git diff
--exit-code packages/ci/dist`, `bun test` — would fail on files they could not touch. The
denial would still be real; the job would break for a reason having nothing to do with it.

`setpriv` hands the invoking uid/gid back. The **order** is the property, not the presence:
`ip link set lo up` needs privilege *inside* the namespace, so it must run first.

```
(fail) … > the sudo candidate drops privilege back, and only AFTER bringing loopback up
(fail) … > the sudo candidate RESTORES PATH rather than restricting it
```

Two tests fail, not one, and that is worth stating plainly: the PATH assertion anchors its
ordering check on `setpriv`, so deleting `setpriv` also removes the anchor. The coupling is
recorded rather than tidied away, because a reader comparing case 3 against case 4 would
otherwise wonder why the same assertion appears in both.

### Case 4 — `PATH` is not restored

Input: [`case-4-path-not-restored.patch`](./case-4-path-not-restored.patch) ·
Output: [`case-4-path-not-restored.observed.txt`](./case-4-path-not-restored.observed.txt)

Resolving the command to an absolute path is necessary and **not sufficient**. `bun run
build` execs its package scripts through `bash`, and those scripts say `bun` — so the
*children* need `PATH` even where the parent did not:

```
$ bun run --filter='*' build
/usr/bin/bash: line 1: bun: command not found
error: script "build" exited with code 127
```

In the same Linux run, `typecheck` **passed**, because its script is `tsc` and Bun resolves
that from `node_modules/.bin` itself. A fix verified only against the step that first
failed would have looked complete and died on the next one — which is what happened, and
why the whole job is now reproduced locally rather than one step at a time.

**Restoring `PATH` is not the `env -i`/restricted-`PATH` convention §5 rejects. It is its
opposite.** §5 rejects a *stripped* environment as a claimed denial *mechanism*; here the
denial comes from the network namespace and from nothing else, and putting `PATH` back is
what makes the sandboxed run the same run as the unsandboxed one. The test asserts the
restored value equals the caller's real `PATH` — a subset would be the thing §5 forbids.

### Case 5 — availability inferred from the probe's own failure

Input: [`case-5-availability-inferred-from-the-probe.patch`](./case-5-availability-inferred-from-the-probe.patch) ·
Output: [`case-5-availability-inferred-from-the-probe.observed.txt`](./case-5-availability-inferred-from-the-probe.observed.txt)

The original defect, and the reason the other two hid behind it. A candidate was only ever
tried by running the probe under it, so *any* failure of that command was attributed to the
mechanism — "my payload is broken" and "this environment cannot deny" were the same
observation, and the second was reported.

Availability is now established by a sentinel that touches no network and only has to
*run*; a probe that fails under a demonstrably-working mechanism is reported as a payload
failure. The three reasons are additionally asserted mutually non-prefixing, so they cannot
quietly collapse back into one.

```
(fail) … > the working-mechanism/broken-payload case is reported as a payload failure
```

Restored: [`restored.observed.txt`](./restored.observed.txt) — 29 pass, 0 fail.

## The same three defects existed twice

`packages/adapters/catalog-backstage/test/offline-run.test.ts` carried its own copy of the
candidate list, with all three. Fixing the script left the adapter suite failing three
tests on Linux; both had to be fixed. No test in that package reaches outside it and this
was not going to be the first, so the duplication stays and the invariants are asserted on
both sides instead. `sc-016.test.ts` additionally reads the script's source, which is why
the two are cross-checked at all.

## What was verified, and where

The whole `clean-clone-builds` job was run from a genuine clean clone in `ubuntu:24.04`,
with the runner's AppArmor restriction reproduced by its observable behaviour so that
candidate 1 is refused and the sudo candidate is the one selected — the path CI takes. All
fifteen steps pass, `bun test` reports 2367 pass / 0 fail, and no root-owned path exists
anywhere in the tree afterwards.

Two container-only artifacts were found and are recorded so they are not mistaken for
repository defects: the spec-kit harness requires `node` on `PATH`, and its ESM-in-`.js`
fixture requires Node ≥ 22. A first attempt with Node 18 and no Node at all produced 20
and 1 failures respectively, none of which occur on a GitHub-hosted runner.

**This is local reproduction, not the run of record.** It constrains the claim rather than
establishing it: the run of record is the CI job itself, on the real runner.
