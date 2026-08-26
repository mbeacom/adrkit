# Contributing to adrkit

## Toolchain

Install Bun 1.3.14, then run:

```bash
bun install --frozen-lockfile
```

Bun is a **development** dependency only. Published artifacts are smoke-tested
under Node and do not require Bun at runtime.

`bunfig.toml` sets `linker = "isolated"`. Do not change it. The hoisted linker
permits phantom dependencies, which would let core surfaces import adapters
without the dependency boundary catching it.

## Good first contributions

You do not need to start with the hardest surface.

Two areas have the steepest on-ramp:

- **The CI Action bundle** (`packages/ci/dist`) must be rebuilt under
  `linux/amd64`, or the byte-for-byte diff gate fails on a Mac-built bundle.
- **The schema parity gate** requires the Zod source
  (`packages/core/src/schema/adr.schema.ts`) and the generated
  `schema/adr.schema.json` to stay in lockstep.

Good first PRs usually start here instead:

- **Docs** - package READMEs, root docs, and site content.
- **Fixtures** - add corpus fixtures for edge cases the current tests miss.
- **Tests** - cover an untested branch and prove the new check really fires.

Open an [issue](https://github.com/mbeacom/adrkit/issues/new/choose) or a
[Discussion](https://github.com/mbeacom/adrkit/discussions) if you want help
finding a starting point.

## Sign-off is required

All commits require a [DCO](https://developercertificate.org/) sign-off. There
is no CLA.

```bash
git commit -s -m "your message"
```

The `dco` job checks every commit in the pull request. If you forgot to sign
off earlier commits, re-sign the branch and force-push:

```bash
git rebase --signoff origin/main
git push --force-with-lease
```

The trailer must name you exactly:
`Signed-off-by: Your Name <your@email>`.

GitHub's web editor does not add a sign-off. For browser edits, clone the
branch locally, run the rebase above, and force-push.

## Quality bar

These rules are enforced in CI. If a pull request violates them, fix the code,
not the check.

### 1. A clean clone gets one narrow network exception

```bash
git clone <repo> && cd adrkit
bun install --frozen-lockfile
bun run typecheck && bun run build && bun test && bun run lint
```

The frozen install is the only step that may use the network, and it may
contact only the unauthenticated public package registry. It must use the
committed `bun.lock` and repository `bunfig.toml`, including the isolated
linker and `minimumReleaseAge`.

After installation, build, typecheck, test, lint, packaging, smoke tests, and
runtime behavior must require no credentials, no services, and no network
access. Do not add private registries, authenticated APIs, network-dependent
tests, or anything that requires a managed device.

### 2. Core surfaces do not depend on adapters

`packages/core`, `packages/cli`, and `schema/` must not import from
`packages/adapters/*`.

Integrations are optional and separately versioned. The core and CLI are not.

### 3. A new check should fail before you trust it

When you add or tighten an assertion, lint rule, or CI gate, build an input it
is supposed to reject and confirm it actually fails on that input. "The suite
still passes" only proves the check does not crash.

Keep the failing input as a permanent negative case. That is the artifact that
shows the check works.

Prefer asserting a specific observed value over a count or an absence. `0`,
`[]`, and "no X found" can mean either "looked and found nothing" or "never
looked at all." Where a count or absence really is the right assertion, the
negative case is mandatory.

This applies beyond tests. If you are claiming "X is not there," make sure you
checked the only place it could be.

## What to expect from CI on your PR

This repository runs its own governing-decisions Action against pull requests.

- **Your pull request gets a bot comment** listing the decisions that govern the
  changed files. It is updated in place on each push; it should not re-post as a
  second comment.
- **Fork pull requests skip that job.** A fork's `GITHUB_TOKEN` is read-only, so
  the Action correctly declines to comment. Dependabot pull requests skip it for
  the same reason.

If `action-dogfood` fails and you did not touch `packages/ci`,
`scripts/check-ci-comment.ts`, or `.github/workflows/ci.yml`, call that out on
the pull request instead of changing unrelated code.

## Changing a decision

This project governs itself. If your change contradicts an accepted record in
`docs/adr/`, the PR should include a superseding ADR with the argument, not
just a status flip.

To add a new decision:

```bash
adr new "Use X for Y"
```

Before you create a new record, run `adr explain` on the paths you would place
in `affects`. If an accepted record already governs them, extending that record
or completing work it already called for may be the better fit.

When you do write a new record, describe the alternatives honestly. See
[docs/EVALUATOR_RUBRIC.md](docs/EVALUATOR_RUBRIC.md) for the scoring rubric the
project uses when reviewing proposals.

## Changing the schema

The Zod source of truth lives at `packages/core/src/schema/adr.schema.ts`.
`schema/adr.schema.ts` is a compatibility re-export, and
`schema/adr.schema.json` is generated.

Run:

```bash
bun run schema:emit
```

Then commit the source change and the generated JSON. CI fails if they diverge.

Breaking schema changes require a major version and a migration path. Additive
changes are minor.

## Changing the evaluator rubric

Rubric changes are decisions, not casual wording tweaks. Update the rubric with
the same care as an ADR, and keep its stated shipped-vs-design-target boundary
accurate.

## Changing the CI Action (`packages/ci`)

The `@adrkit/ci` Action ships a committed, self-contained bundle at
`packages/ci/dist/index.js`, and CI enforces that it matches source with a
`git diff --exit-code packages/ci/dist` gate.

**Rebuild the bundle under `linux/amd64` Bun 1.3.14**, not on a Mac. Bun's
CommonJS interop output differs across host targets, so a Mac-built bundle
drifts and fails the gate. Use the pinned container:

```bash
docker run --rm --platform linux/amd64 -v "$PWD":/work -w /work oven/bun:1.3.14 \
  bash -c "bun install --frozen-lockfile && bun run --filter='@adrkit/ci' build"
bun install --frozen-lockfile   # restore your local (host) install afterward
```

Then commit `packages/ci/dist`. Any change to `packages/ci/src` **or**
`@adrkit/core` (which is bundled in) requires regenerating it.

## Architecture and governance links

- [README.md](README.md) - product overview and installation paths
- [docs/adr/](docs/adr/) - governing decisions
- [docs/EVALUATOR_RUBRIC.md](docs/EVALUATOR_RUBRIC.md) - proposal review rubric
- [docs/RELEASING.md](docs/RELEASING.md) - release procedures
