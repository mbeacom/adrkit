---
schemaVersion: 0.1.0
id: "0010"
title: Use Bun as the package manager and test runner while publishing Node-targeted artifacts
status: accepted
date: 2026-07-18
deciders: ["@mbeacom"]
tags: [toolchain, build, packaging]
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo: ["0006", "0007"]
affects:
  - type: path
    pattern: "package.json"
  - type: path
    pattern: "bunfig.toml"
  - type: path
    pattern: ".github/workflows/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@mbeacom"
review:
  tier: arb
  tierReason: >-
    The linker setting determines whether ADR-0007's dependency assertion is
    meaningful or theatre.
---

# ADR-0010: Use Bun as the package manager and test runner while publishing Node-targeted artifacts

## Context

ADR-0006 decides monorepo over multi-repo. The package manager was incidental
to that decision and was never argued on its merits, so it is factored out here
and decided explicitly. ADR-0006 now refers to this record for the toolchain;
nothing in the corpus was published before that correction, so this is the
canonical choice rather than an amendment layered over an earlier one.

Bun supports npm/yarn-style workspaces natively — a `workspaces` glob array in
the root `package.json`, including negative patterns — so the monorepo structure
ADR-0006 decided is unaffected either way. Since Bun 1.2 the lockfile is
text-based by default, which matters here more than usual: ADR-0001 and ADR-0004
make this a git-native, review-centric project, and a binary lockfile would have
been disqualifying on its own.

Two constraints from other records bear directly on the choice.

**ADR-0007 asserts that the core depends on no adapter, enforced in CI.** That
assertion is only meaningful if the installed dependency graph reflects the
declared one. Bun's default *hoisted* linker mimics npm and permits phantom
dependencies — a package importing something it never declared, resolved from
the hoisted root. Under a hoisted linker, `core-has-no-adapter-deps` can pass
while the code does the forbidden thing. Bun's **isolated** linker mimics pnpm's
symlinked layout and eliminates the class.

**Consumers run Node, not Bun.** The CI package ships as a GitHub Action, which
executes on the runner's Node runtime; the MCP server is launched by third-party
agent harnesses, typically via `npx`. Neither can assume Bun is present. The
prevailing 2026 pattern — install and build with Bun, run on Node — is exactly
what this project needs.

## Decision

Adopt Bun as the package manager, script runner, and test runner. Keep
workspaces. Publish Node-targeted artifacts.

**Required, not optional:**

1. **Isolated linker.** `bunfig.toml` sets `linker = "isolated"`. Without it,
   ADR-0007's dependency assertion is theatre. This is the condition that makes
   the whole choice acceptable.
2. **Text lockfile.** `bun.lock` committed; `bun install --frozen-lockfile` in
   CI. Never `bun.lockb`.
3. **Node-compatible published output.** Every published package targets Node
   and is smoke-tested under Node in CI, not only under Bun. A package that only
   runs under Bun is a defect regardless of whether its tests pass.

**Bun is a development dependency, not a runtime dependency.** No consumer of any
published artifact needs Bun installed. This boundary is the whole basis for
accepting the choice, and it should be stated in the README so that
enterprise evaluators are not left guessing.

## Options considered

### Option A: Bun for install/build/test, Node-targeted output (chosen)

| Dimension | Assessment |
|---|---|
| Contributor setup | Single binary; simpler than corepack + pnpm |
| Install/test speed | Substantially faster |
| Clean-clone constraint | Satisfied; one tool, no corepack shim |
| Ecosystem risk | Moderate — see trade-offs |
| Consumer impact | None, given Node-targeted output |

### Option B: pnpm workspaces

**Pros:** the conservative default; isolated layout by default rather than by
configuration; the widest CI, Renovate, and enterprise-tooling support; nothing
to explain to a contributor.
**Cons:** slower; corepack adds a moving part to the clean-clone path; no
integrated test runner, so a separate test framework is required.

### Option C: Bun without workspaces — a single package

**Rejected, and worth stating why**, because it is the more tempting reading of
"drop pnpm/workspaces." ADR-0007 requires adapters to be separately versioned,
separately published, and independently breakable while the core stays stable.
A single package cannot express that: adapters could not version independently,
and `core-has-no-adapter-deps` would have no package boundary to check. Dropping
workspaces would quietly repeal ADR-0007 rather than simplify it.

### Option D: Bun runtime end-to-end, including published artifacts

**Pros:** one runtime, simplest mental model.
**Cons:** a GitHub Action cannot run on Bun without becoming a Docker action, and
agent harnesses launch MCP servers under Node. This would restrict adoption to
Bun users — a small fraction of the enterprises this project targets.

## Trade-offs

**Renovate has a known, currently-open defect with Bun monorepos**: when a PR
updates only a non-root workspace `package.json`, `bun.lock` is sometimes not
regenerated, so the merge leaves `main` failing `--frozen-lockfile` and blocks
every subsequent PR until someone regenerates it by hand. For an open-source repo
with automated dependency updates this is an operational trap, not a
theoretical one. Mitigation: disable automerge for workspace-only updates, and
add a CI check that fails a PR whose manifest changed without a corresponding
lockfile change. Accept that this may need revisiting.

Bun is a younger tool with a smaller enterprise track record. That cost is
bounded by the runtime boundary above — it lands on contributors, not adopters —
but it is real for a project courting conservative organizations. It also cuts
the other way: single-binary install is genuinely easier for a first-time
contributor than corepack.

Using `bun test` couples the test suite to Bun's runner. Migrating away later
means rewriting test setup, though assertions largely port.

## Consequences

- Easier: contributor onboarding; CI wall-clock; the clean-clone job, which now
  needs one tool instead of a Node setup plus a corepack shim.
- Harder: dependency automation until the Renovate issue resolves; explaining
  the toolchain to enterprise reviewers, which the README boundary statement
  should preempt.
- **How we would know this was wrong:** a contributor cannot complete a clean
  clone build, a published artifact fails under Node, or lockfile drift blocks
  `main` more than once. Any of the three should trigger reconsideration rather
  than a workaround.
- Revisit if: Bun's workspace or publishing behaviour proves unstable, or if
  enterprise contributors report the toolchain as an actual barrier rather than
  a stated preference.

## Action items

1. [ ] `bunfig.toml` with `linker = "isolated"` — before any dependency is added
2. [ ] Root `package.json` `workspaces` globs; `bun.lock` committed
3. [ ] CI: replace pnpm/Node setup with `oven-sh/setup-bun`; keep an explicit
       **Node** smoke-test job for every published artifact
4. [ ] Lockfile-drift check: fail any PR changing a manifest without the lockfile
5. [ ] Renovate: disable automerge for workspace-only updates
6. [ ] README: state plainly that Bun is a development dependency only
