# Reference-repository artifact — the comment Action's rung-2 run

[ADR-0014](../../../../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
rung 2 asks for maintainer-owned isolated reference-repository validation that is
**reproducible, self-verifying, fail-closed, and reviewed**.
[ADR-0028](../../../../docs/adr/0028-give-the-comment-posting-action-an-end-to-end-signal-on-both-rungs.md)
places the comment path's end-to-end evidence on **both** rungs: rung 1 continuously,
inside this repository's own CI (`action-dogfood` in `.github/workflows/ci.yml`), and
rung 2 here, against a published-shaped consumer.

`comment-idempotence.yml` in this directory is that rung-2 run, shipped as a runnable
file. [ADR-0016](../../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
clause 4 is explicit that deferring work means handing over the failing case, not the
instruction to construct one — "an instruction to observe a failure, with no failure
attached, is a check that cannot fail dressed as a handoff."

## What it covers that rung 1 cannot

| Scenario | rung 1 (`action-dogfood`) | rung 2 (this file) |
|---|---|---|
| Two dispatches leave one comment | yes | yes, against a pinned immutable ref |
| Runs as a *consumer* — `uses: mbeacom/adrkit/packages/ci@<sha>` | no, `uses: ./packages/ci` | yes |
| Fail-closed: invalid corpus dir writes nothing | no | yes, byte-for-byte snapshot compare |
| FR-014 degrade on a read-only token | **no — structurally impossible** | yes |

The third row is the reason both rungs exist rather than one. `action-dogfood` skips
fork pull requests precisely because their token is read-only, so the repository's own
CI can never exercise the degrade path it skips over. A reference repository can grant
`pull-requests: read` deliberately and assert the Action stays green and writes
nothing.

## Running it

1. Copy `comment-idempotence.yml` into `.github/workflows/` of
   [`mbeacom/adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood).
2. Replace every `0000000000000000000000000000000000000000` — the `ADRKIT_REF` env and
   the four `uses:` refs — with the 40-character adrkit commit under test. A tag or a
   branch is not acceptable here: ADR-0016 records a stale read by ref that returned
   HTTP 200 and coherent content while being behind the branch head.
3. Commit a **plain file** at `fixtures/fail-closed-invalid-corpus-dir` (any content).
   It must be a file, not a directory — that is what makes `readdir()` throw `ENOTDIR`
   inside adrkit's corpus loader, before any GitHub write is attempted.
4. Open a pull request in that repository and let the three jobs run in order.
5. Record the observed values, run URLs, and content hashes in
   [`../../checklists/reference-verification-evidence.md`](../../checklists/reference-verification-evidence.md).

## Why it does not live in adrkit's own CI

The reference repository is a **consumer**: it pins an immutable adrkit ref and calls
the Action the way `site/src/content/docs/ci.mdx` tells adopters to. Running these
three scenarios here instead would test the monorepo's working tree against itself,
which is a different claim — and the `pull-requests: read` job in particular would be
asserting a degrade path using a token this repository grants itself, rather than one a
consumer was handed.
