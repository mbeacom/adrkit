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
