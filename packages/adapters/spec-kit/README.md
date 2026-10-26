# @adrkit/spec-kit

The [Spec Kit](https://github.com/github/spec-kit) extension for
[adrkit](https://adrkit.dev) — decision memory for the spec-driven plan loop.

This checkout is the `3pepe3/adrkit` compatibility fork of upstream
`d94698cf4142133a166d4af4d33d06a660c2579f` (v0.20.0). It retains the upstream
adapter/package version 0.1.5 and Apache-2.0 notices; the fork commit identifies
the compatibility patch. No replacement npm or upstream release is claimed.

Spec Kit takes you from `specify` to `plan` to `tasks` to `implement`. What it
does not do is check the plan it just produced against the decisions your
organization already made, or record the new decisions the plan contains. Every
feature starts from an empty context and re-litigates settled questions.

This extension closes that loop, without leaving git.

## What it adds

| Command | What it does | Writes |
|---|---|---|
| `/speckit.adrkit.context` | Pulls the decisions governing the paths you're about to touch — including superseded and rejected ones — into context before you plan | no |
| `/speckit.adrkit.check` | Checks a produced plan against the decisions that govern it, and routes it through the deterministic evaluator when a snapshot bundle is configured | no |
| `/speckit.adrkit.draft` | Scaffolds a draft ADR from the current plan artifact for you to fill in | one new record |

Plus one hook: `after_plan` offers to run `/speckit.adrkit.check`. It is
**optional** — it asks, it does not seize the plan loop.

## Requirements

- Spec Kit `>=0.13.0,<1.3.0`. Upstream compatibility was tested against 0.13.0, 0.14.4,
  0.15.1, 0.16.5, 1.0.0, 1.0.4–1.0.6, 1.0.13, and 1.1.0–1.1.3.
- This fork additionally verifies 1.2.1 with Codex native skills, feature-pointer
  selection and @adrkit/cli 0.20.0. Other 1.2 integrations and native Windows
  execution have not been measured. See the dated verification addendum.
- A reviewed fork `adr` runtime at the project's executable `.specify/bin/adr`,
  a standalone project-local/PATH installation, or `ADRKIT_CLI` pointing at its
  entry point. For an offline standalone installation, use an already reviewed
  local fork artifact: `pnpm add --offline /path/to/reviewed-fork-cli.tgz`.
- An ADR corpus. Defaults to `docs/adr`.

## Install

For Spec Kit 1.2.1, install this fork's adapter from a checkout pinned to the
reviewed compatibility commit:

```sh
specify extension add --dev /path/to/adrkit/packages/adapters/spec-kit
```

Use a real CLI entrypoint from the fixture's current directory when verifying
another project. A repository wrapper that changes directories always targets
that repository, regardless of the caller's working directory.

The upstream release below remains the unpatched 0.1.5 artifact and deliberately
rejects Spec Kit 1.2. It is suitable only for the upstream-supported range.

Install from the release archive, which carries the version in its URL:

```sh
specify extension add adrkit \
  --from https://github.com/mbeacom/adrkit/releases/download/spec-kit-v0.1.5/adrkit.zip
```

Spec Kit asks before installing from a URL (`⚠ Untrusted Source` …
`Continue with installation? [y/N]`). There is no `--yes`, and `--force` does
not skip the question; with no answer on stdin the install aborts with exit 1.
To answer it non-interactively, pipe the answer in:

```sh
printf 'y\n' | specify extension add adrkit \
  --from https://github.com/mbeacom/adrkit/releases/download/spec-kit-v0.1.5/adrkit.zip
```

adrkit is listed in the
[Spec Kit community catalog](https://github.com/github/spec-kit/blob/main/extensions/catalog.community.json),
but that catalog is discovery-only: `specify extension add adrkit` finds the
entry and refuses to install from it.

Or straight from a checkout:

```sh
specify extension add --dev path/to/packages/adapters/spec-kit
```

Then the commands below are available in your agent, and Spec Kit's plan
command offers the `after_plan` hook.

### Command names in your agent

The extension declares dotted command ids (`speckit.adrkit.check`). What you
type depends on how Spec Kit registers commands for your agent:

| Integration | What Spec Kit writes | You type |
|---|---|---|
| Claude Code, every Spec Kit version measured (0.13.0 to 1.1.3) | `.claude/skills/speckit-adrkit-*/` | `/speckit-adrkit-check`, `/speckit-plan` |
| GitHub Copilot, Spec Kit 0.16.5 and later | `.github/skills/speckit-adrkit-*/` | `/speckit-adrkit-check`, `/speckit-plan` |
| GitHub Copilot, Spec Kit 0.13.0 to 0.15.1 | `.github/prompts/speckit.adrkit.*.prompt.md` | `/speckit.adrkit.check`, `/speckit.plan` |

This README uses the dotted ids. Where your agent uses skills, read each dot
as a hyphen. The `after_plan` hook works under both: Spec Kit records it as
`speckit.adrkit.check`, and its generated plan skill tells the agent to replace
dots with hyphens when it offers the hook.

The package is also published on npm as `@adrkit/spec-kit` for programmatic or
pinned installs.

## Use it in the plan loop

1. Run `/speckit.adrkit.context` before planning.
2. Run `/speckit.plan`, then accept the optional check or run
   `/speckit.adrkit.check` directly.
3. Run `/speckit.adrkit.draft` when the plan introduces a decision worth
   recording.

## Configuration

The extension works without additional configuration. Override its defaults
with environment variables when needed.

| Variable | Default | Meaning |
|---|---|---|
| `ADRKIT_DIR` | `docs/adr` | ADR corpus directory |
| `ADRKIT_CLI` | resolved | Explicit path to the `adr` entry point |
| `ADRKIT_FEATURE_DIR` | resolved | Override Spec Kit's own feature resolution |
| `ADRKIT_SNAPSHOT` | unset | Snapshot bundle enabling the deterministic evaluator |
| `ADRKIT_AS_OF` | today, UTC | Evaluation date |

The CLI is resolved from the project working directory in a fixed order:

1. Explicit `ADRKIT_CLI`, retaining the existing JavaScript-entrypoint support.
2. Executable project wrapper `./.specify/bin/adr`.
3. Only for a standalone project without `.specify/native-lock.json`,
   `./node_modules/.bin/adr`, then `adr` on `PATH`.

A managed project whose wrapper is missing or not executable stops before either
fallback. Restore its locked runtime through the project's reviewed offline setup;
an unrelated local or PATH executable cannot replace it. An explicit `ADRKIT_CLI`
still takes precedence. No resolution branch downloads or installs a package, and
the missing-CLI diagnostic recommends only a reviewed local fork artifact with
`pnpm --offline`, never an automatic or upstream installation.

## Runtime guarantees

- **Hooks never write.** `draft` is the only command that writes, and it is
  unreachable from any hook. A plan-phase hook creating records unprompted would
  manufacture decision memory rather than record it.
- **The hook is never mandatory.** `optional: false` renders as an automatic hook
  that fires without consent.
- **Failures name what is missing.** No command exits 0 having found nothing
  because it was looking in the wrong place. "0 decisions govern this" and "I
  could not see the corpus" must never render as the same string.
- **`check` mutates nothing.**
- **Nothing development-only reaches your repo.** `specify extension add --dev`
  copies this directory verbatim, so `.extensionignore` keeps the test suite,
  `tsconfig.json`, and `package.json` out of your `.specify/extensions/`. The
  package declares no dependencies at all, so there is never a `node_modules/`
  to copy — a workspace symlink in one aborts the install partway through.

## Compatibility and support

The extension is tested against Spec Kit 0.13.0, 0.14.4, 0.15.1, 0.16.5, 1.0.0,
1.0.4–1.0.6, 1.0.13, and 1.1.0–1.1.3. Report
compatibility issues in the
[adrkit issue tracker](https://github.com/mbeacom/adrkit/issues). Maintainers can
find the detailed verification record in
[`docs/reference-verification-spec-kit-extension.md`](../../../docs/reference-verification-spec-kit-extension.md).

Run the explicit, isolated compatibility check with already-installed tools:

```sh
bun run packages/adapters/spec-kit/test/verify-live.ts /path/to/specify /path/to/adr [extension.zip]
```

It initializes only a temporary project, installs this adapter, requires all
three `.agents/skills/speckit-adrkit-*/SKILL.md` commands, resolves the selected
feature through `.specify/feature.json`, proves context/check leave the fixture
unchanged, and proves draft creates exactly one ADR. The optional archive mode
serves the supplied archive over ephemeral loopback HTTP to exercise the real
URL installer, then stops the server. It installs no tools and needs no public
release or external endpoint. The supplied CLI executables retain responsibility
for their own behavior.

## License

Apache-2.0.
