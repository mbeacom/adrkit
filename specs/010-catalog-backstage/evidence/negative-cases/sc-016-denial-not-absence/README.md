# Negative case: SC-016 is a denial, not an absence

**Task**: T095 · **Discharges**: SC-016 · **Observed**: 2026-08-05, Phase G
**Tools**: Bun 1.3.14, TypeScript 6.0.3
**Command for both cases**: `bun test test/sc-016.test.ts`, run from
`packages/adapters/catalog-backstage/`
**Permanent automated case**: `packages/adapters/catalog-backstage/test/sc-016.test.ts`

SC-016 is the criterion most easily satisfied by an artifact that proves nothing. "We ran
the generator and saw no network calls" is **consistent with a networked path that simply
was not taken** — a branch guarded by an unset credential, a fallback that did not trigger,
a cache that was warm. An absence is evidence about the run. A denial is evidence about the
environment the run was confined to.

The mechanism, its configuration, and its two-sided proof are recorded at
[`../network-denial/`](../network-denial/). This directory records the two cases that show
SC-016's *close-out* discriminates, rather than restating them.

---

## Case 1 — the control loses one side

Input: [`case-1-one-sided-control.patch`](./case-1-one-sided-control.patch) ·
Output: [`case-1-one-sided-control.observed.txt`](./case-1-one-sided-control.observed.txt)

The unsandboxed half of the control — the assertion that the probe **connects** when the
sandbox is removed — was replaced with a vacuous length check. The sandboxed half was left
untouched, so the suite still asserts that the probe is denied.

```
(fail) T095 / SC-016 — the evidence is a denial > the denial is PROVED by a two-sided control, not merely invoked

Expected to contain: "expect(controlUnsandboxed).toStartWith('CONNECTED')"
```

This is the case that matters. With one side gone, `offline-run.test.ts` **still passes** —
its remaining assertions are all satisfied by an environment with no network at all. Only
the SC-016 close-out notices, because only it asserts that *both* halves are present. A
one-sided control is an absence wearing a denial's clothes, and this is the check that
tells them apart.

10 pass, 1 fail. Restored: 11 pass, 0 fail.

---

## Case 2 — an absence is offered as the basis of the claim

Input: [`case-2-absence-as-evidence.patch`](./case-2-absence-as-evidence.patch) ·
Output: [`case-2-absence-as-evidence.observed.txt`](./case-2-absence-as-evidence.observed.txt)

The phrasing §5 forbids was introduced into the package — "No network calls were observed
during the run" — as the stated basis of the claim.

```
(fail) T095 / SC-016 — what does NOT qualify is not being leaned on > SC-016 is not claimed from an absence of observed calls anywhere in this package
+     "ruleId": "absence-as-evidence",
```

The scan runs over comment-stripped source, so *describing* the forbidden reasoning in a
doc comment does not trip it — which is deliberate, and is the same rule the honesty
close-out at T100 follows. What trips it is the phrasing surviving into a test name or
string, where it functions as a claim rather than as an explanation.

10 pass, 1 fail. Restored: 11 pass, 0 fail.

---

## What is asserted, and under which §5 status

| Element | Status under §5 | Asserted at |
|---|---|---|
| A proved OS/process-level denial mechanism | **Qualifies** (mechanism 1 or 2) | `a qualifying mechanism is named, with its exact configuration` |
| The two-sided control proving it denies *here* | What makes the above a denial | `the denial is PROVED by a two-sided control` |
| Fail-closed when no mechanism is available | §5 constraint on the environment | `the run is fail-closed: no mechanism means failure, never a skip` |
| No credential/bearer variable set | Additional §5 requirement | `no credential or bearer-token variable is set for the run` |
| Static review of generator source | **Corroborating only** — never sole | `the static source review is labelled corroborating` |
| "No calls were observed" | **Does not qualify at all** | Case 2 above |

The citation itself is also asserted: `spike 009 §5 exists where it is cited, and says what
is attributed to it` reads the contract and matches the sentences relied on, with whitespace
normalized so a reflow that changes no words does not fail the check. A separate assertion
confirms this feature did **not** copy §5 into its own contracts, per `contracts/README.md`
§2's adopt-by-reference model.

## Standing constraints

ADR-0014 **rung 1 only**. A proved denial is not reference verification and is not external,
third-party, or community validation. Only corpus **data** is third-party; the validation
never is.
