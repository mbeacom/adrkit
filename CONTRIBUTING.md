# Contributing to adrkit

## Toolchain

Bun 1.3.14 (see [ADR-0010](docs/adr/0010-bun-toolchain.md)). Install it, then
run `bun install --frozen-lockfile`. Bun is a **development** dependency only —
nothing published by this project requires it, and every published artifact is
smoke-tested under Node.

`bunfig.toml` sets `linker = "isolated"`. Do not change it: the hoisted linker
permits phantom dependencies, which would let the core import an adapter while
CI's dependency check still passed.

## Your first PR

Welcome. The rest of this document is the full rigor — but you do not have to
start at the hardest surface. Two areas have the steepest on-ramp and are worth
avoiding for a first contribution:

- **The CI Action bundle** (`packages/ci/dist`) must be rebuilt under
  linux/amd64, or the byte-for-byte diff gate fails on a Mac-built bundle (see
  "Changing the CI Action" below).
- **The schema emit-parity gate** requires the Zod source
  (`packages/core/src/schema/adr.schema.ts` — the single source of truth) and the
  generated `schema/adr.schema.json` to stay in lockstep. The root
  `schema/adr.schema.ts` is only a one-line compatibility re-export and is not
  where you make the change (see "Changing the schema").

Good first PRs steer clear of both and still matter a great deal:

- **Docs** — fix or extend anything under `site/` or the package READMEs. If a
  documented command behaves differently than described, that is a real bug.
- **Fixtures** — add a corpus fixture that exercises a case the current tests
  miss (a supersession cycle, an odd MADR variant, an `affects` edge case).
- **Tests** — cover an untested branch. Per
  [ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md),
  watch each new test **fail first** against unfixed code, then pass — a check
  that never failed is not coverage.

Everything runs from a clean clone with `bun install --frozen-lockfile` and no
credentials ([ADR-0007](docs/adr/0007-adapter-isolation-and-public-surface-build.md)).
Open an [issue](https://github.com/mbeacom/adrkit/issues/new/choose) or a
[Discussion](https://github.com/mbeacom/adrkit/discussions) if you would like a
pointer to a good starting spot.

## Sign-off is required

All commits require a [DCO](https://developercertificate.org/) sign-off. There is
no CLA — see [ADR-0006](docs/adr/0006-license-apache-2-and-single-monorepo.md) for
why.

```
git commit -s -m "your message"
```

**This is enforced.** The `dco` job checks every commit your pull request adds and
is a required status check, so an unsigned commit cannot merge. If you forgot, sign
the whole branch at once and force-push:

```
git rebase --signoff origin/main
git push --force-with-lease
```

The trailer must name you: `Signed-off-by: Your Name <your@email>`, matching the
commit's author or committer exactly. Merge commits are exempt — the commits they
merge carry the certification. Bot accounts are exempt from the address half only,
because they sign from a service address; their trailer must still name them.

**Editing in the browser?** A commit made through the GitHub web editor carries no
sign-off, and you cannot add one from the browser. Clone the branch, run the rebase
above, and force-push — or make the change locally with `git commit -s` to begin
with. This catches docs-only contributions in particular, so it is worth knowing
before you start rather than after the check goes red.

## Two hard rules

These are enforced in CI. A PR that violates either will fail, and the fix is to
change the code, not the check.

**1. A clean clone has one narrow network exception for dependency install.**

```
git clone <repo> && cd adrkit
bun install --frozen-lockfile
bun run typecheck && bun run build && bun test && bun run lint
```

The frozen install is the only step that may use the network, and it may contact
only the unauthenticated public package registry. It must use Bun 1.3.14, the
committed `bun.lock`, and the repository's `bunfig.toml` settings, including the
isolated linker and `minimumReleaseAge`.

After installation, build, typecheck, test, lint, packaging, smoke tests, and
runtime behavior must require no credentials, no services, and no network
access. Contributions may not use private or authenticated registries, registry
tokens or other credentials, authenticated APIs, non-public dependency surfaces,
network-dependent tests or runtime behavior, or anything requiring a managed
device. See
[ADR-0007](docs/adr/0007-adapter-isolation-and-public-surface-build.md).

**2. The core depends on no adapter.**

`packages/core`, `packages/cli`, and `schema/` import nothing from
`packages/adapters/*`. Integrations are optional, separately versioned, and
allowed to break on upstream churn. The core is not.

**3. A check does not count as coverage until you have watched it fail.**

When you add or tighten an assertion, lint rule, or CI gate, build an input it is
supposed to reject and confirm it actually fails on that input. "The suite still
passes" only establishes that your assertion does not crash. Keep the failing
input as a permanent negative case — the artifact that proves a check works is
the case that makes it fail.

Prefer asserting a specific observed value over a count or an absence. `0`, `[]`,
and "no X found" render identically whether the tool looked and found nothing or
could not look at all, which is why a green check can mean "I am blind" and be
trusted anyway. Where a count or absence really is the right assertion, the
negative case is mandatory rather than advisory.

This extends past assertions to any claim of the form "X is not there." One
negative observation of a default configuration is not evidence a capability is
missing — check whether you looked in the only place it could be.

If you defer the work, hand over the failing case, not the instruction. "Please
verify this fires" transfers the whole cost of constructing the input and leaves
the recipient unable to tell whether you ever built one.

Aimed at checks guarding a corpus or an input the tool must not silently skip;
applying it to every trivial equality assertion is cargo cult. See
[ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md).

## Changing a decision

This project governs itself. If your change contradicts an accepted record in
`docs/adr/`, the PR must include a record that supersedes it — with the argument,
not just the status flip. Silently contradicting an accepted decision is the one
review comment guaranteed to block a merge.

Adding a decision:

```
adr new "Use X for Y"
```

Fill in the alternatives honestly. An alternative no competent engineer would
choose is a straw man and scores zero — see
[the rubric](docs/EVALUATOR_RUBRIC.md).

## Changing the schema

`schema/adr.schema.ts` is the source of truth; `schema/adr.schema.json` is
generated. Run `bun run schema:emit` and commit both. CI fails if they diverge.

Breaking schema changes require a major version and a migration. Additive
changes are minor. See
[ADR-0002](docs/adr/0002-typed-frontmatter-as-madr-superset.md).

## Changing the evaluator rubric

Rubric changes are decisions, not tweaks. They ship as an ADR with calibration
deltas attached — see [ADR-0005](docs/adr/0005-deterministic-first-evaluator-with-declarative-escalation.md).

## Changing the CI Action (`packages/ci`)

The `@adrkit/ci` Action ships a committed, self-contained bundle at
`packages/ci/dist/index.js`, and CI enforces it matches source with a
`git diff --exit-code packages/ci/dist` gate (mirroring `schema-emit-matches`).

**Rebuild the bundle under `linux/amd64` bun 1.3.14** (the CI toolchain) — not on a
Mac. bun's CJS-interop codegen differs between the macOS-arm64 and linux-x64 builds
of the same bun version, so a Mac-built bundle drifts and fails the gate. Use the
pinned container:

```bash
docker run --rm --platform linux/amd64 -v "$PWD":/work -w /work oven/bun:1.3.14 \
  bash -c "bun install --frozen-lockfile && bun run --filter='@adrkit/ci' build"
bun install --frozen-lockfile   # restore your local (host) install afterward
```

Then commit `packages/ci/dist`. Any change to `packages/ci/src` **or** `@adrkit/core`
(which is bundled in) requires regenerating it.
