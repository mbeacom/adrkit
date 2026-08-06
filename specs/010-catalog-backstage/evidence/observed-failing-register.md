# Observed-failing register

**Task**: T099 · **Discharges**: FR-059 · **Barrier side**: BEHIND
**Compiled**: 2026-08-05, Phase G · **Tools**: Bun 1.3.14, TypeScript 6.0.3

[ADR-0016](../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
requires every check to be **observed failing** before it counts as coverage. This file is
the repository-wide close-out of that requirement for feature 010: it enumerates every
check the feature introduced and, for each, names where the failing observation was
recorded and where the permanent negative case is retained.

**A check appearing only in the passing column is a coverage gap**, and is reported as one
in [§4](#4-gaps-reported-rather-than-closed) rather than omitted.

This file is **machine-checked**. `scripts/check-observed-failing-register.test.ts`
asserts the mapping below against the filesystem in both directions — every row names a
directory that exists, and every directory has a row. A register that drifted from the
tree would otherwise be worse than none, because it would read as an audit.

---

## 1. What counts as a retained negative case

`negative-cases/README.md` fixes the convention: a README, the failing input, the captured
output, and the restored pass. **Three** shapes satisfy it, and all three are present:

| Shape | Retained input | Restored |
|---|---|---|
| **Patch** — a mutation of live source | `*.patch` | `restored.observed.txt` |
| **Isolated artifact** — a whole broken copy | a committed directory, `.json`, or `.txt` | *not applicable* — the live artifact was never mutated |
| **Code constant** — the mutation lives in source | a named constant the suite drives | `restored.observed.txt` |

The second shape has no `restored.observed.txt` **and should not**. `freeze-drift/`,
`oracle-input-order/` and `audit-integrity-only/` each retain a deliberately-broken copy of
a frozen artifact; nothing was ever mutated in place, so there is nothing to restore. The
checker encodes that distinction rather than demanding a file that would have to be
fabricated.

The third shape has exactly one member. `comparison-mismatch/` retains its mutation as
`T089_MUTATION` in `scripts/compare-accept-corpus.ts` — a line of code the test suite
drives on every run. That is **stronger** retention than a patch, not weaker: a patch can
rot silently against source that moved on, while a constant the suite exercises cannot.
The checker asserts the symbol is really there, so "retained in code" cannot become a way
of retaining nothing.

---

## 2. The register — every check, and where it was observed failing

Ordered by task. "Reason string" is the discriminating text the failing run emitted,
quoted from the recorded output rather than transcribed from memory.

### Phase A — package boundaries

| Task | Check | Negative case | Observed reason string |
|---|---|---|---|
| T009 | `check:deps` — core/CLI/schema may not depend on an adapter | `dep-core-to-adapter/` | `non-adapter workspace depends on an adapter package` |
| T010 | `check:deps` — consumer may not depend on the adapter | `dep-consumer-to-adapter/` | `non-adapter workspace depends on an adapter package` |
| T011 | `check:deps` — adapter may not depend on the consumer | `dep-adapter-to-consumer/` | `declares a dependency outside its allowed public surface` |
| T012 | `check:deps` — every new package has an allowlist entry | `dep-allowlist-present/` | `declares a dependency outside its allowed public surface` |

T012 is the one that closes `package-boundary.md` §4's trap: a package with **no**
allowlist entry passes `check:deps` no matter what it declares, so a green check there is
not evidence of anything.

### Phase B — the freeze and its audit (Barrier B)

| Task | Check | Negative case | Observed reason string |
|---|---|---|---|
| T020 | `audit-oracle-freeze` — `derivedPathPatterns` ordering | `oracle-input-order/` | recorded verbatim in that README |
| T021 | `audit-oracle-freeze` — integrity without adequacy is FAIL | `audit-integrity-only/` | recorded verbatim in that README |
| T023 | `check:freeze-hashes` — drift on any frozen artifact | `freeze-drift/` | recorded verbatim in that README |

### Phase C — the consumer

| Task | Check | Negative case | Observed reason string |
|---|---|---|---|
| T026 | core surface pin | `consumer-core-surface-pin/` | recorded in that README |
| T029 | the five ordered validation steps | `consumer-steps/` | one per step, recorded in that README |
| T031 | digest mismatch on a mutated payload | `consumer-digest/` | recorded in that README |
| T032 | staleness on an exact revision inequality | `consumer-staleness/` | recorded in that README |
| T033 | a foreign-repository envelope is refused | `consumer-repository-identity/` | recorded in that README |
| T035 | integrity is not correctness | `consumer-correctness-claim/` | recorded in that README |
| T037 | the consumer never imports the adapter | `consumer-adapter-import/` | recorded in that README |

### Phase D — admissibility, ownership, globs, manifest

| Task | Check | Negative case | Observed reason string |
|---|---|---|---|
| T040 | manifest version / capability rejection | `manifest-version/` | recorded in that README |
| T042 | repository identity mismatch | `repository-mismatch/` | recorded in that README |
| T043 | incomplete required source | `incomplete-required-source/` | `incomplete-required-source` |
| T044 | both stages of path validation | `path-validation/` | recorded in that README |
| T047 | YAML read failures | `yaml-read/` | recorded in that README |
| T049 | the four admissibility validators, separately attributed | `admissibility-validators/` | recorded in that README |
| T054 | inadmissible **and** canonically unique → `inadmissible-descriptor` | `inadmissible-and-unique/` | `inadmissible-descriptor` |
| T058 | the three rejecting annotation decode steps | `annotation-decode/` cases 1–3 | `annotation-value-not-a-string`, `parse-error`, `wrong-shape` |
| T059 | step 2 runs on the raw node, before `JSON.parse` | `annotation-sequence-coercion/` | `annotation-value-not-a-string` |
| **T062** | the five-step **ordering**, with every reason preserved | `annotation-decode/` **case 4** | `Expected: "annotation-value-not-a-string" / Received: "parse-error"` |
| T065 | glob rules 1–14 | `glob-rules/` | recorded in that README |

**T062 is a Phase G addition.** Cases 1–3 each *disable* a step, so each is caught by a
reason that stops being emitted; none of them demonstrates that a **reordering which
preserved every reason** is still caught. Case 4 is that construction, and it is hostile:
the diagnostics record was left reporting the old ordering so that every assertion reading
it still passed. 16 of 17 tests passed under it; one did not.

### Phase E — the assembled generator

| Task | Check | Negative case | Observed reason string |
|---|---|---|---|
| T070 | envelope invariants | `envelope-invariants/` | recorded in that README |
| T071 | whole-operation atomicity | `whole-operation-atomicity/` | recorded in that README |
| T074 | the fifteen trigger classes | `triggers/` cases 1–5 | one per case, recorded in that README |
| **T078** | `duplicate-canonical-ref` is unreachable **by construction** | `triggers/` **case 6** | `Expected: ["component:default/billing"] / Received: [..., "component:default/billing-legacy"]` |
| T083 | byte-identical output across runs | `determinism/` | recorded in that README |
| **T086** | SC-009 limb 2 over the frozen accept corpus | `sc-009-limb-2/` | `Expected: "PASS" / Received: "FAIL"`; `Expected: >= 4 / Received: 0` |

**T078 and T086 are Phase G additions.** Both tasks were left honestly unchecked by earlier
phases and were closed here on their merits; see §3.

### Phase F — clause-5 step (b)

| Task | Check | Negative case | Observed reason string |
|---|---|---|---|
| T089 | the comparison gate, on a mutated corpus-side input | `comparison-mismatch/` | recorded in that README |

### Phase G — clean clone, offline, clause 8

| Task | Check | Negative case | Observed reason string |
|---|---|---|---|
| T093 | `run-network-denied` fails closed with no provable mechanism | `clean-clone-offline/` case 1 | `FAIL-CLOSED — no qualifying denial mechanism could be proved here.` |
| T093 | `check:clean-clone` — a package invisible to the build | `clean-clone-offline/` case 2 | `declares no "build" script, so the root --filter='*' run would skip it silently` |
| T093 | wrapping the whole suite in total denial is self-contradictory | `clean-clone-offline/` case 3 | `Failed to start server. Is port 0 in use?` / `EADDRINUSE` |
| T094 | the denial mechanism must actually deny | `network-denial/` case 1 | `did not deny: CONNECTED:200` |
| T094 | no network call site in generator source (corroborating) | `network-denial/` case 2 | `"ruleId": "fetch-call"` |
| T095 | the control must be two-sided | `sc-016-denial-not-absence/` case 1 | `Expected to contain: "expect(controlUnsandboxed).toStartWith('CONNECTED')"` |
| T095 | an absence may not be offered as the basis of the claim | `sc-016-denial-not-absence/` case 2 | `"ruleId": "absence-as-evidence"` |
| T097 | no option-B descriptor-parent heuristic | `spike-heuristic/` case 1 | `[option B] derivation-receives-a-path: matched "sourcePath"` |
| T097 | no option-C repository-root heuristic | `spike-heuristic/` case 2 | `[option C] repository-root-fallback: matched "['**']"` |
| T098 | clause 5: zero false positives / zero false negatives | `clause8-gate/` case 1 | `step (b) records falseNegatives = 2` |
| T098 | clause 9: no release prepared | `clause8-gate/` case 2 | `declares version 0.1.0; clause 9 defers release` |
| T098 | clause 5: two distinct steps, neither inheriting | `clause8-gate/` case 3 | `step (b) does not record \`inheritsFromStepA: false\`` |
| T099 | the register maps to the tree — a case with no row | `observed-failing-register/` case 1 | `+ ["observed-failing-register", "spike-heuristic"]` |
| T099 | the register maps to the tree — a row with no case | `observed-failing-register/` case 2 | `every directory the register names exists on disk` |
| T100 | the honesty check fires on a real claim | `honesty-close-out/` case 1 | `"ruleId": "rung-2-claim"`, `"ruleId": "release-claim"` |
| T100 | the honesty check stays green on the same terms as denials | `honesty-close-out/` case 2 | 35 pass, 0 fail — the vocabulary is identical to case 1 |

---

## 3. Seven defects this phase found — four by observation, three by review

Recorded because they are the argument for ADR-0016 rather than illustrations of it. In the
first four, the defect lived on a path that **only a failing run ever executes**, so no
amount of green runs would have surfaced it.

1. **`run()` crashed instead of rejecting a candidate.** `Bun.spawn` throws `ENOENT` for a
   missing executable rather than returning a non-zero exit. On the first negative run of
   `offline-run.test.ts` — where `sandbox-exec` deliberately stopped denying, so the Linux
   candidates were reached on a macOS host — the suite died with a single unnamed failure
   reading `Executable not found in $PATH: "unshare"`. Fail-closed technically held, but
   the operator was told the wrong thing. `run()` now records the candidate as rejected
   with its reason.

2. **T086's citation pin was a bare `toContain` and did not discriminate.** Under a gutted
   SC-011 block it **passed** — 14 pass, 0 fail — because the same call appears elsewhere
   in the same file. It now slices the SC-011 block out and counts live calls within it.
   Had it only ever run against a healthy harness it would have been recorded as coverage
   and been worth nothing.

3. **`commandFromArgv` rejected its own documented invocation.** Bun strips `--` before the
   script sees it, so `bun scripts/run-network-denied.ts -- bun test` arrived without the
   separator and the script exited 2 with a usage error. Found by running it, not by
   reading it.

4. **Wrapping the whole test suite in total denial denied the control that proves the
   denial.** The `clean-clone-builds` job originally ran
   `bun scripts/run-network-denied.ts -- bun test`. Against a genuinely fresh clone that
   fails three tests with `Failed to start server. Is port 0 in use?` — all three being
   `Bun.serve` calls in the two files whose job is to *prove* network denial. The conflict
   is structural, not a bug: a two-sided control has to touch the network boundary. The job
   no longer wraps `bun test`; the consequence for FR-050's wording is recorded at
   §4.5 and at `negative-cases/clean-clone-offline/` case 3.

   This one was found only because T093's clean-clone verification was actually performed
   against a fresh clone rather than assumed from the working tree, where `node_modules`
   and prior state would have masked nothing but the arrangement was never exercised.

5. **`commandFromArgv` discarded the command whenever the command itself contained `--`.**
   Bun strips only the **first** `--`, so scanning the whole argv for a separator mistook
   the command's own arguments for it. The CI step
   `run-network-denied.ts -- bun run release:pack -- --skip-build --skip-smoke-install`
   reduced to `['--skip-build','--skip-smoke-install']`: `bun run release:pack` never ran,
   and the tarball verification the step exists for was silently replaced. Not a
   fail-open — denial was still proved first — but the step's stated work did not happen.
   Only a leading separator is honoured now, and an inner one is a covered case.

6. **Three silent-absence holes in the clause-8 gate**, each of the shape the gate was
   written to close:

   | Field | Absent / empty behaviour before | Now |
   |---|---|---|
   | `recomputedFrozenHashes` | `Object.entries(undefined ?? {})` iterates zero times → requirement satisfied | absent, `{}`, an array, or a missing artifact is a finding |
   | `requirement3_adequacyFinding` | `{}` is a defined object and is not literally `FAIL` → satisfied | an affirmative `ADEQUATE` verdict is required |
   | `corpusRef` on **both** sides | `undefined !== undefined` is `false` → the two "agree" | the freeze must record a non-empty repository and commit |

   Each was reachable only by mutating the evidence tree in a way the original test suite
   did not cover, and each is now a named case in `check-clause8-gate.test.ts`.

7. **A self-satisfying assertion.** `offline-run.test.ts` read its own source and asserted
   it contained the env literal `{ PATH: …, HOME: … }` — a needle that appeared in the
   assertion line itself, so the match could never fail and a credential added to the env
   would not have been caught. The property is genuinely bound from `sc-016.test.ts`, which
   reads the file from outside it; the in-file assertion now inspects every `env:` literal
   for credential-shaped names instead of searching for its own text.

Findings 5–7 came from an independent adversarial review of this phase's diff rather than
from running the checks, which is why they are listed separately from 1–4 above: the first
four were found by observing failures, these three by someone reading for them.

---

## 4. Gaps, reported rather than closed

### 4.1 T096 has no negative-case directory, and this is stated rather than papered over

`scripts/cross-package-envelope.test.ts` has **no** entry in the table above. Its failing
observation is embedded in the suite itself: *"a byte the consumer did not expect is
refused"* mutates the generator's envelope and asserts the consumer refuses it at the
digest stage. That is a permanent negative case in test form, and it runs on every
`bun test`.

What it does **not** have is a retained artifact directory. T096's `Files` list names only
the test, and T096 discharges no FR or SC of its own — it supports FR-044, whose boundary
half is discharged by T037 and carries `consumer-adapter-import/`. Recorded here so a
reader counting directories against tasks does not conclude one was lost.

### 4.2 The Linux denial candidates have not been observed running on Linux

`scripts/run-network-denied.ts` carries three candidates. Only `sandbox-exec` was proved by
this session, because this session ran on macOS. The two `unshare` forms are exercised by
the same code path and are rejected-with-reason when unavailable — that behaviour *was*
observed — but **neither has been watched succeeding on a Linux host**.

Consequence, stated plainly: if neither proves on the CI runner, `clean-clone-builds` fails
closed. That is the designed behaviour and would appear as a red build immediately. It is
not a silent degradation. But the claim "network is denied in CI" is, as of this writing,
**designed and unit-tested rather than observed in CI**, and the first CI run is what will
settle it.

### 4.3 ADR-0012 gate 3: recorded as observed, never claimed in advance

Gate 3 requires *"a maintainer-authored reference oracle — synthetic explicit annotations
over pinned public corpora under independent adversarial review — validating real entity
and path outcomes."*

**What was observed**, at `evidence/comparison/step-b-record.json`: the re-frozen oracle
(T017) was independently audited (T019, verdict `PASS`, with an explicit adequacy finding),
and the post-output comparison over the frozen accept corpus returned verdict `PASS` with
**0 false positives and 0 false negatives** across 24 expected entities in a 25-entity
envelope.

That is the outcome, recorded after the fact. This register does **not** declare gate 3
closed: gate 3 is ADR-0012's to close, on a record of its own, and `plan.md` is explicit
that a pass here is *"a **possible outcome** for ADR-0012 gate 3, never a claim made in
advance."* What is recorded is what ran and what it returned.

### 4.4 ADR-0012 gate 4: unmet, and not yet testable

Gate 4 is *"clean-clone / offline / adapter-boundary / **release** evidence passing."*

Three of its four components are produced by this phase:

| Component | Status |
|---|---|
| clean-clone | produced — `check:clean-clone`, `clean-clone-builds` |
| offline | produced — proved denial, `network-denial/`, `sc-016-denial-not-absence/` |
| adapter-boundary | produced — `check:deps`, `envelope-shape-locality`, T096 |
| **release** | **not produced, and not producible here** |

The release component carries a `[NEEDS CLARIFICATION]` marker that has been **carried
forward unresolved** from `research.md` R9:427 and `spec.md`:1290, through `plan.md`, to
T099. What "release evidence" requires is undefined given that **ADR-0020 clause 9 defers
both the release vehicle and the decision to release at all** to a later record.

It is **not resolved by guess here.** The consequence `plan.md` fixes and this register
records: **gate 4 remains unmet and not yet testable regardless of this feature's outcome,
and is recorded as unmet — never as passed, and never as failed.** Failed would imply it
was tested; it was not, because it cannot yet be.

### 4.5 FR-050's second half is met in a weaker form than its wording implies

FR-050 asks that network access be permitted **only** during
`bun install --frozen-lockfile`. Every step of `clean-clone-builds` is wrapped in
`scripts/run-network-denied.ts` **except `bun test`**, which is not.

The reason is structural and is recorded at `negative-cases/clean-clone-offline/` case 3:
the suite contains the tests that *prove* network denial, and their two-sided control needs
a loopback listener that a total-denial sandbox correctly refuses. Wrapping the suite
denies the control that establishes the denial, and it was observed doing exactly that —
three failures, all `Bun.serve`, on a genuinely fresh clone.

So the honest statement of what holds is: **no step requires network beyond the install,
and every step that can run under a proved denial does.** The one unwrapped step is the one
whose own content proves the generator never reaches the network
(`offline-run.test.ts` sandboxes its own generation run). That is weaker than "every step
runs under ambient denial", and it is recorded here rather than left for a reader to infer
from the workflow file.

---

## 5. Standing honesty constraints

- **ADR-0014 rung 1 only.** Everything enumerated above is unit / contract / conformance
  evidence. None of it is rung 2 (`reference-verified`) and none of it is rung 3
  (`externally validated`). Those two states are **not** claimed anywhere in this feature —
  which is asserted mechanically at `honesty-close-out.md` (T100).
- **No release is scheduled, implied, or prepared.** Both packages are at version `0.0.0`,
  neither is in `RELEASE_PACKAGES`, and `check:clause8` fails the build if either changes.
- **Only corpus *data* is third-party.** The overlay, the expected paths, the audit, the
  comparison and every check above are maintainer-authored. The validation never is.
- **No claim is made about Backstage as a running system.** Every admissibility claim is
  scoped to what the four pinned validator predicates return at commit
  `1121a4facd9e321179d0402c3f355e4a649e84d9`.
