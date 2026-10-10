# Spec Kit extension — rung-2 reference-verification evidence index

**Purpose**: The tracked, sanitized evidence index that satisfies the ADR-0014
**rung-2** gate for `@adrkit/spec-kit` — maintainer-owned isolated
reference-repository validation. It mirrors the discipline
[`specs/007-arb-queue/checklists/reference-verification-evidence.md`](../specs/007-arb-queue/checklists/reference-verification-evidence.md)
established for Phase 6: immutable refs, run links, content hashes, tool
versions, expected-vs-observed rows, limitations, and a reviewer verdict.

This is **rung-2 reference verification, not rung-3 external / community
validation**. The reference repository is maintainer-owned and isolated — not an
external team, not a third-party adopter.

Extension maturity per the [ADR-0014](../docs/adr/0014-stage-phase-landing-evidence-across-a-three-rung-validation-ladder.md)
vocabulary: **implemented → reference-verified → landed**. It is **not**
`released` at the time of writing and **not** `externally validated`.

**Created**: 2026-08-02
**Decision**: [ADR-0019](../docs/adr/0019-ship-the-spec-kit-extension-treating-the-spike-no-go-as-a-measurement-artifact.md)
**Reviewer verdict**: PASS. All four rung-2 criteria — reproducible,
self-verifying, fail-closed, reviewed — are met by the artifacts below.

> **Currency, as of 2026-08-08.** Everything recorded below describes runs that
> actually happened, and none of it is edited when a new adrkit version ships.
> The reference workflow pins `ADRKIT_CLI_VERSION: "0.3.0"`, so as of the v0.4.0
> release this gate exercises the extension against a **superseded** CLI. It is
> green rather than stale-and-red — the pin is deliberate and `PIN-3` still
> matches — but the rung-2 evidence for `@adrkit/spec-kit` is not evidence about
> the current release. Bumping the pin and recording a fresh run is tracked
> separately; until that lands, read the verdict below as scoped to
> `@adrkit/cli@0.3.0`.

## Reference repository (maintainer-owned, isolated)

[`mbeacom/adrkit-t018-dogfood`](https://github.com/mbeacom/adrkit-t018-dogfood) —
a separate, public repository the maintainer owns and operates, already used for
the Phase 6 rung-2 evidence. It is **not** this monorepo.

| Change | Immutable SHA |
|---|---|
| PR [#9](https://github.com/mbeacom/adrkit-t018-dogfood/pull/9) — add rung-2 reference validation for the Spec Kit extension | merge `b559d32c48b0098510e0dae8d4fb994afd6f8053` |

## Tool versions / environment

| Component | Version / ref |
|---|---|
| adrkit under test (pinned, immutable) | commit `61f591086085e1d6fcd4d8636d3364a9a949ddd6` |
| `extension.yml` at that ref | SHA-256 `bd81e05fbc43327b82dc43f2319c18a936418b510a822fa2d61ae7cba30e7416` |
| `.extensionignore` at that ref | SHA-256 `f1a39b110fcc888ed32c9cfcdea50971caf4caef292350e0dfddf29482f26c0c` |
| Validation script | `scripts/validate-spec-kit-extension.sh`, SHA-256 `c0bde9297f3fc7b535974b1c489f3be1ad4a985dc2b4d4c27883bd771b56082f` |
| Validation workflow | `.github/workflows/spec-kit-extension.yml`, SHA-256 `5c2af3fc5d0e139d3445962f3a1bb98a232cac0750ff1a3edab3f9587a487a2a` |
| Spec Kit versions exercised | `0.13.0`, `0.14.4`, `0.15.1` — the endpoints and midpoint of the range the manifest declared *at the time of this run*, `>=0.13.0,<0.16.0`. The manifest has since widened to `>=0.13.0,<1.2.0`; this workflow leg has not, and the gap is recorded in the addenda below. |
| `adr` CLI under test | published `@adrkit/cli@0.3.0` from npm — the surface a real consumer installs, not a workspace build |
| Runner / runtimes | `ubuntu-latest`; Node 22; Python 3.12 |
| Workflow permissions | `contents: read` only. No PAT, no repository secret, no write scope. |

## Runs

| Run | Head | Result |
|---|---|---|
| [30779430843](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/30779430843) — PR #9, final | PR head | **3/3 legs pass**, 41 assertions each |
| [30779576194](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/30779576194) — `main` after merge | `b559d32` | **3/3 legs pass** |
| [30779240521](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/30779240521) — deliberate divergence | probe commit `d5f540d` | **3/3 legs fail** — see [Self-verification](#self-verification) |

## Rung-2 criteria

### Reproducible

Every run pins an immutable adrkit commit SHA (`61f5910`), a fixed Spec Kit
version per matrix leg, and a fixed published `@adrkit/cli` version. Inputs are
committed: the reference repository's own `docs/adr` corpus is the fixture, and
the extension is installed from the pinned checkout with
`specify extension add --dev`.

### Self-verifying

The workflow asserts its own expected outcomes and fails on divergence; it never
asks a human to read a log and decide. Each leg prints `assertions: 41,
failures: 0` and exits non-zero the moment any row diverges.

**This was demonstrated, not assumed.** A deliberate divergence commit repointed
`ADRKIT_REF` at `07658e4` — the extension's first commit, before
`.extensionignore` existed and while the manifest still pinned spec-kit
`<0.14.0`. All three legs went red, catching exactly the defects that version
really had:

| Assertion | What it caught |
|---|---|
| `INS-2` | The `<0.14.0` pin genuinely rejects 0.14.4 and 0.15.1 — the extension does not install |
| `PKG-package.json`, `PKG-test`, `PKG-tsconfig.json` | That version shipped development-only files into the consumer's project |
| `HOOK-*`, `BEH-*`, `FC-*` | Cascaded from the failed install |

A gate only ever seen green is a gate nobody has watched work. Run
[30779240521](https://github.com/mbeacom/adrkit-t018-dogfood/actions/runs/30779240521);
reverted in the same PR.

### Fail-closed

Four consumer-facing failure scenarios run in every leg. Each proves a non-zero
exit, a message naming the missing dependency, and — for the only command that
writes — that **no record was written before failing**.

| Assertion | Scenario | Proves |
|---|---|---|
| `FC-1a/1b` | `adr` CLI absent from a scrubbed `PATH` | non-zero; stderr names `adrkit's CLI is not installed` |
| `FC-2a/2b` | No ADR corpus | non-zero; stderr names the directory searched |
| `FC-3a/3b/3c` | `draft` with no title | exit **2** (usage), names what is missing, corpus hash **unchanged** |
| `FC-4a/4b/4c` | `draft` with no plan | non-zero, names the missing plan, corpus hash **unchanged** |

`MUT-1` additionally byte-compares the entire consuming project before and after
`check` and `context` — the hook can fire `check` unattended, so it must touch
nothing. `MUT-2` asserts the reference repository itself is unmodified.

### Reviewed

This document. Reviewer verdict **PASS** (maintainer `@mbeacom`).

## Expected vs observed (representative rows)

Full per-run tables are uploaded as workflow artifacts
(`spec-kit-extension-evidence-<version>`). Representative rows, identical across
all three legs:

| id | Expectation | Observed |
|---|---|---|
| `PIN-1` | adrkit checkout is at `61f5910` | match |
| `PIN-3` | `adr --version` is `0.3.0` | match |
| `HOOK-3` | hook is `optional: true` | match |
| `HOOK-4` | count of hooks targeting `speckit.adrkit.draft` is `0` | `0` |
| `PKG-node_modules` | `node_modules` absent from the installed extension | absent |
| `BEH-2` | `context src/payments/api.ts` names `"recordId": "0001"` | present |
| `BEH-3` | `context src/orders/ledger.ts` names `"recordId": "0015"` | present |
| `MUT-1` | project tree hash unchanged across `check` + `context` | unchanged |
| `FC-3c` | corpus hash unchanged after `draft` with no title | unchanged |

`BEH-*` assert specific record ids rather than counts deliberately. Per
[ADR-0016](../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md),
"0 decisions govern this" and "I could not see the corpus" render as the same
string, so a count-based assertion would pass in exactly the case worth catching.

## Limitations (honest scope of this evidence)

- **Rung 2, not rung 3.** The reference repository is maintainer-owned. No party
  other than the maintainer has verified this extension in their own repository.
  Rung-3 external / community validation is **absent**.
- **The agent-facing surface is verified structurally, not conversationally.**
  The workflow asserts that commands render, that the hook is registered
  `optional: true`, and that the scripts behave correctly when invoked. It does
  **not** drive a live agent session through `/speckit.plan` and observe the
  hook prompt being offered and accepted — that path was exercised by hand and by
  spike 008, not by this CI gate.
- **Three versions, not every version.** `0.14.0`–`0.14.3` and `0.15.0` are
  inside the declared range but are not individually exercised. The endpoints and
  midpoint are.
- **The corpus is a fixture.** The reference repository's 15 records exercise the
  routing tiers and path matchers, but they are a constructed corpus, not an
  organization's real accumulated decisions.
- This evidence says nothing about Phase 6's status, which is governed
  independently and unchanged.

## 2026-09-09: pin-widening re-verification (`>=0.13.0,<1.1.0`)

The runs above are untouched. This section records the maintainer-session
re-verification that widened the manifest pin across the `0.16` and `1.0`
upstream lines (ADR-0019, addendum dated 2026-09-09). It is deliberately
**not** claimed as a rung-2 matrix extension: these were real installs against
real upstream releases, executed by the maintainer, with no tracked
reference-repository workflow leg yet.

| Evidence | Result |
|---|---|
| `EXTENSION-API-REFERENCE.md` at frozen `9a30db48` (0.13.0) vs `v0.16.5` vs `v1.0.4` | additive only; `v0.16.5` vs `v1.0.4` byte-identical (896 lines, empty diff) |
| Loader `src/specify_cli/extensions/__init__.py` across `v0.15.1` → `v0.16.5` → `v1.0.4` | additive or refactor; `.extensionignore` handling and `SpecifierSet` version parsing unchanged |
| `specify extension add --dev` on `0.16.5` (PyPI), `1.0.0` (git tag), `1.0.4` (PyPI), Python 3.12 | exit 0 on all three; `after_plan` hook registered `optional: true`; installed tree carries only `LICENSE`, `NOTICE`, `README.md`, `commands/`, `extension.yml`, `scripts/` |
| Negative control: previous pin `<0.16.0` on `1.0.4` | compatibility error naming both specifiers, exit 1 |

Recorded rendering change: on 1.0.x with the Copilot integration, extension
commands render as agent skills under `.github/skills/speckit-adrkit-*` — the
same surface upstream's own commands use — rather than `.github/agents/` and
`.github/prompts/` files. Registration and hook semantics are unchanged.

**Limitation**: the dogfood workflow's three legs still exercise
`0.13.0`/`0.14.4`/`0.15.1`. Extending the matrix to `0.16.5`/`1.0.0`/`1.0.4`
is the follow-up that brings the widened range under the weekly self-verifying
gate.

## 2026-09-12: closing the `1.0` line's upper edge (`1.0.5`, `1.0.6`)

The sections above are untouched. When the pin widened to `<1.1.0` on
2026-09-09, upstream's newest release was `1.0.5` and the evidence reached only
`1.0.4` — so the bound admitted a released, unverified patch. `1.0.6` shipped
after that. This section records the maintainer-session re-verification that
closes the gap, on the same terms as the addendum above: real installs against
real upstream releases, **not** a rung-2 matrix extension.

| Evidence | Result |
|---|---|
| `extensions/EXTENSION-API-REFERENCE.md` at `v1.0.4` vs `v1.0.5` vs `v1.0.6` | **byte-identical across all three** — 896 lines, SHA-256 `cb037d69fe62c7d8…` at every tag. The extension-facing contract did not move inside the `1.0` line. |
| Loader `src/specify_cli/extensions/__init__.py`, `v1.0.4` → `v1.0.5` | one hunk: the `__SPECKIT_COMMAND_*__` placeholder pattern widens from `[A-Z][A-Z0-9_]*` to `[A-Z][A-Z0-9_-]*`. Strictly more permissive — it admits hyphenated placeholders and rejects nothing that previously matched. |
| Loader `v1.0.5` → `v1.0.6` | three call sites additionally pass `author=manifest.data["extension"].get("author")` into skill generation. Read via `.get()`, so a manifest without an author is unaffected; adrkit declares one. |
| `.extensionignore` handling and `SpecifierSet` version parsing, `v1.0.4` → `v1.0.6` | unchanged — neither diff touches either path. |
| `specify extension add --dev` on `1.0.5` (PyPI) and `1.0.6` (PyPI), Python 3.12, `--integration copilot` | exit 0 on both; all three commands registered; three agent skills auto-registered; `extension list` and `extension info adrkit` exit 0 and report `v0.1.4` |
| `after_plan` hook registration on both | `.specify/extensions.yml` records `optional: true` alongside `enabled: true` — the consent-preserving rendering, not the seizing one |
| Installed tree on both | `LICENSE`, `NOTICE`, `README.md`, `commands/`, `extension.yml`, `scripts/`, plus the loader's own `.specify-dev/extension-skills/` staging directory. **No** `test/`, `tsconfig.json`, `package.json`, or `node_modules/` — `.extensionignore` still honored. |

Two observations worth recording precisely, because both are easy to misread:

- **`.specify-dev/` is not a leak, and it is not new.** A `--dev` install has
  generated it since at least `1.0.4`, where the 2026-09-09 addendum's
  "carries only …" phrasing did not mention it. It holds the skill sources the
  loader stages for registration — upstream's own output, not development files
  escaping `.extensionignore`. The exclusion list is doing its job; the earlier
  row was simply less complete than it sounded.
- **`1.0.6` changes generated skill attribution.** On `1.0.4` the rendered
  `.github/skills/speckit-adrkit-*/SKILL.md` carried
  `metadata.author: github-spec-kit`; on `1.0.6` it carries
  `metadata.author: Mark Beacom (@mbeacom)`, read from `extension.author`. This
  is the observable effect of the loader hunk above, it credits the extension
  author rather than the host, and no adrkit change was needed to obtain it.

**Sampling doctrine** (so the next upstream patch does not reopen this): the
bound is declared and verified at **minor** granularity — endpoints and samples
of each admitted line, not every patch. `<1.1.0` asserts "verified through the
`1.0` line". A new `1.0.x` patch does not invalidate it; `1.1.0` is where the
fail-loud gate fires and the evidence list must be extended again.

**Limitation (unchanged)**: the dogfood workflow's three legs still exercise
`0.13.0`/`0.14.4`/`0.15.1`. Bringing `0.16.5`, `1.0.0`, and `1.0.4`–`1.0.6`
under the weekly self-verifying gate remains the open follow-up; these runs are
maintainer-session evidence, and the SSL trust store on the session host also
prevented the catalog lookup inside `extension info` from resolving, which that
command degraded past with exit 0.

## 2026-10-09: install channel and command names, re-measured

The sections above are untouched. Building a demo repository against Spec Kit
1.0.5 found two documentation errors: the documented
`specify extension add adrkit` failed, and the Copilot agent saw the commands
as `/speckit-adrkit-check` and `/speckit-plan`, not the dotted names the docs
used. This section records the maintainer-session measurement that settled
both. Like the two addenda above, it is real installs against real upstream
releases, and **not** a rung-2 matrix extension.

Method: `uvx --from specify-cli==<version> specify …` on macOS, in throwaway
projects made by `specify init <name> --integration <copilot|claude>
--ignore-agent-tools --script sh` (plus `--non-interactive` on 1.0.x), with
`NO_COLOR=1` and `GIT_CONFIG_GLOBAL=/dev/null`. The full matrix ran on `1.0.5`,
`1.0.6`, and `1.0.13` (the newest release inside `<1.1.0`; PyPI's newest is
`1.1.3`, outside the pin) for both integrations. `0.13.0`, `0.15.1`, and
`0.16.5` were sampled for the catalog form, `--dev`, and what each integration
writes; `0.13.0` and `0.16.5` (Copilot) also for `--from`. The archive is
`https://github.com/mbeacom/adrkit/releases/download/spec-kit-v0.1.4/adrkit.zip`.

| Evidence | Result |
|---|---|
| `specify extension add adrkit`, `0.16.5`, `1.0.5`, `1.0.6`, `1.0.13`, both integrations | exit 1: `Error: 'adrkit' was found in the 'community' catalog, which is discovery-only — a search surface, not an install source.` The message suggests `specify extension add adrkit --from <archive-url>`. |
| `specify extension add adrkit`, `0.13.0` and `0.15.1`, both integrations | exit 1: `Error: 'adrkit' is available in the 'community' catalog but installation is not allowed from that catalog.` |
| `specify extension add adrkit --from <archive>`, stdin `/dev/null` | an `⚠ Untrusted Source` panel ("You are installing an extension directly from an external URL, bypassing your trusted (install-allowed) extension catalogs."), then `Continue with installation? [y/N]: Aborted.`, exit 1. Same on every version tried. |
| the same with `--force` | still prompts and aborts, exit 1. `extension add --help` lists only `--dev`, `--from`, `--force`, `--priority`; there is no `--yes`. |
| `printf 'y\n' \| specify extension add adrkit --from <archive>` | exit 0, `✓ Extension installed successfully!`, `v0.1.4`, three commands listed, on `0.13.0`, `0.16.5`, `1.0.5`, `1.0.6`, `1.0.13` |
| `specify init <name> --extension <archive> --trust-extension-urls --non-interactive` | exit 0 with `.specify/extensions/adrkit/` installed, on `1.0.5`, `1.0.6`, `1.0.13`. A prompt-free route for a new project only. |
| `specify extension add --dev packages/adapters/spec-kit` | exit 0 on every version tried |
| `https://github.com/mbeacom/adrkit/releases/latest/download/adrkit.zip` | `302` to `releases/download/v0.18.0/adrkit.zip`, then `404`. "Latest" follows the lockstep release, so there is no durable unversioned URL for the `spec-kit-v*` series. |

What each integration writes for the three commands:

| Integration and versions | Files | Name the agent sees |
|---|---|---|
| `claude`, `0.13.0`, `0.15.1`, `0.16.5`, `1.0.5`, `1.0.6`, `1.0.13` | `.claude/skills/speckit-adrkit-{context,check,draft}/SKILL.md` | `/speckit-adrkit-check` |
| `copilot`, `0.16.5`, `1.0.5`, `1.0.6`, `1.0.13` | `.github/skills/speckit-adrkit-{context,check,draft}/SKILL.md` | `/speckit-adrkit-check` |
| `copilot`, `0.13.0`, `0.15.1` | `.github/agents/speckit.adrkit.*.agent.md` and `.github/prompts/speckit.adrkit.*.prompt.md` | `/speckit.adrkit.check` |

So the demo's report and the 2026-09-12 row ("all three commands registered")
are both right: the commands register, as hyphenated skills. That row did not
record names. The 2026-09-09 note says the skills rendering starts on
"1.0.x"; it starts at `0.16.5` at the latest, the earliest skills-mode version
sampled here.

**The `after_plan` hook still resolves.** `.specify/extensions.yml` records
`command: speckit.adrkit.check`, `optional: true`, `enabled: true` on every
version. In skills mode, the generated `speckit-plan/SKILL.md` (both
integrations, every skills-mode version sampled) tells the agent: "When
constructing command invocations from hook command names, replace dots (`.`)
with hyphens (`-`). For example, `speckit.git.commit` → `/speckit-git-commit`."
So the offer names `/speckit-adrkit-check`, which exists. Nothing is
functionally broken, and `extension.yml` and `commands/` are unchanged; the
docs now give the install command that works and a per-integration name
table. No live agent session drove `/speckit-plan` to watch the offer render,
so that last step rests on the generated instruction, not on an observed run.

## 2026-10-09: widening to the `1.1` line (`>=0.13.0,<1.2.0`)

The sections above are untouched. Spec Kit 1.1.0 shipped on 2026-10-02 and
1.1.3 is now PyPI's newest, so the `<1.1.0` gate fired as designed. This
section records the maintainer-session re-verification that widened the pin to
`<1.2.0` and moved `@adrkit/spec-kit` to 0.1.5. Like the addenda above, it is
real installs against real upstream releases, and **not** a rung-2 matrix
extension. No 1.2 release or tag exists as of this run.

Method: the same as the section above, with `uvx` on Python 3.13. `1.1.0` is a
GitHub release that never reached PyPI (PyPI goes from `1.0.13` to `1.1.1`), so
it ran as `uvx --from git+https://github.com/github/spec-kit.git@v1.1.0
specify`, as `1.0.0` did on 2026-09-09. `1.1.1`, `1.1.2`, and `1.1.3` ran from
PyPI, except the 0.1.4 refusal runs on `1.1.3`, which used its git tag. The archive under test is the 0.1.5 `adrkit.zip` that
`release:pack -- --only @adrkit/spec-kit --tag spec-kit-v0.1.5` and
`scripts/pack-extension-zip.ts` produce, served from `http://127.0.0.1`,
because the `spec-kit-v0.1.5` release asset does not exist until the tag is
pushed. The scripts ran against a four-record fixture corpus with the published
`@adrkit/cli` 0.18.0 as `ADRKIT_CLI`.

| Evidence | Result |
|---|---|
| 0.1.4 on `1.1.0` and `1.1.3`, both integrations: `printf 'y\n' \| specify extension add adrkit --from …/spec-kit-v0.1.4/adrkit.zip`, and `extension add --dev` of the unchanged tree | exit 1 on all eight: `Compatibility Error: Extension requires spec-kit >=0.13.0,<1.1.0, but 1.1.3 is installed.` (`1.1.0` on that version), then `Upgrade spec-kit with: uv tool install specify-cli --force --from git+https://github.com/github/spec-kit.git`. The fail-loud gate works on both install routes. |
| `extensions/EXTENSION-API-REFERENCE.md`, `v0.16.5` → `v1.1.3` | byte-identical (SHA-256 `cb037d69fe62c7d8…`, 896 lines) at `v0.16.5`, `v1.0.4`, `v1.0.6`, `v1.0.13`, `v1.1.0`, `v1.1.1`, `v1.1.2`. `v1.1.3` (`a54e2239e1fd4de6…`, 907 lines) adds one block listing the bundled `bug` extension's `before_/after_bug_{assess,fix,test}` events. Additive. |
| Loader, `v1.0.13` → `v1.1.3` (`extensions/__init__.py`, `command_add.py`, `agents.py`) | three feature commits: generic-integration command and skill registration (#4785), exact catalog release selection (#4726), and catalog-installed external agent adapters (#4862), plus install rollback that unregisters hooks if a later step fails. `SpecifierSet` version parsing and `.extensionignore` handling are untouched. The one new refusal, an archive whose id or version disagrees with the catalog entry it was selected from, applies only to catalog installs, which the community catalog does not allow. |
| `specify extension add --dev` (0.1.5 tree), `1.1.0` and `1.1.3` × `copilot` and `claude`; `1.1.1` and `1.1.2` × `copilot` | exit 0 on all six. `extension list` reports `v0.1.5`. Installed tree: `LICENSE`, `NOTICE`, `README.md`, `commands/`, `extension.yml`, `scripts/`, plus the loader's `.specify-dev/`. No `test/`, `tsconfig.json`, `package.json`, or `node_modules/`. |
| `printf 'y\n' \| specify extension add adrkit --from <0.1.5 archive>`, same six | exit 0, `✓ Extension installed successfully!`, `v0.1.5`, three commands listed. The `⚠ Untrusted Source` question is unchanged. |
| `specify init <name> --extension <0.1.5 archive> --trust-extension-urls --non-interactive`, same six | exit 0, `.specify/extensions/adrkit/` installed |
| `specify extension add adrkit` (catalog form), `1.1.0` and `1.1.3` | exit 1, the same discovery-only error as `0.16.5`–`1.0.13`. `extension search adrkit` lists `v0.1.4`: the 0.1.4 catalog update ([github/spec-kit#4571](https://github.com/github/spec-kit/issues/4571)) was applied 2026-09-15. |
| Commands registered | `.github/skills/speckit-adrkit-{context,check,draft}/` under Copilot and `.claude/skills/speckit-adrkit-{context,check,draft}/` under Claude, on every 1.1.x run. You type `/speckit-adrkit-check`, as on `1.0.x`. Skill metadata credits `author: Mark Beacom (@mbeacom)`. Its `source` field is `extension:adrkit` under Copilot and `adrkit:commands/check.md` under Claude, the same split as on `1.0.13`. |
| `after_plan` hook | `.specify/extensions.yml` records `command: speckit.adrkit.check`, `enabled: true`, `optional: true`, `priority: 10` on every run. The generated `speckit-plan/SKILL.md` still says "replace dots (`.`) with hyphens (`-`)". On `1.1.2` and `1.1.3`, `extension info adrkit --json` (new in 1.1.2) reports `hooks: [{trigger: after_plan, targetCommand: speckit.adrkit.check, optional: true}]` and the three commands. `1.1.0` and `1.1.1` reject `--json` with exit 2. |
| Scripts from `.specify/extensions/adrkit/scripts/`, every 1.1.x run | `context.sh` with no paths: exit 0, a QueueReport v1 JSON document. `context.sh src/net/client.ts`: exit 0, governed by `0001`, `0002`, `0003`. `check.sh src/net/client.ts`: exit 0, the `==> adrkit:check` section, and on stderr the stated omission of routing because `ADRKIT_SNAPSHOT` is unset. |
| Extension test suite | No test drives Spec Kit itself. The version-dependent assertion is the pin in `test/manifest.test.ts`, which failed on `<1.2.0` before its expectation moved. The two version-agreement tests (`package.json` vs `extension.yml`, and the README and site archive URL vs `extension.yml`) failed when only `extension.yml` moved to 0.1.5. |

Nothing in `commands/` or `scripts/` changed; 1.1.x needed only the pin.

**The README URL points at an asset that does not exist yet.** The guard
from 2026-10-09 ties the README and site URL to `extension.yml`'s version, so
both now name `spec-kit-v0.1.5/adrkit.zip`, which returns 404 until the tag is
pushed. Merge and tag together.

**Limitation (unchanged)**: the dogfood workflow's three legs still exercise
`0.13.0`/`0.14.4`/`0.15.1`. No live agent session drove `/speckit-plan` on
1.1.x to watch the hook offer render; that rests on the generated instruction
and the recorded hook, as on 1.0.x.
