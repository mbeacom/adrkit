# Contributing to adrkit

## Toolchain

Bun (see [ADR-0010](docs/adr/0010-bun-toolchain.md)). Install it, then
`bun install`. Bun is a **development** dependency only — nothing published by
this project requires it, and every published artifact is smoke-tested under
Node.

`bunfig.toml` sets `linker = "isolated"`. Do not change it: the hoisted linker
permits phantom dependencies, which would let the core import an adapter while
CI's dependency check still passed.

## Sign-off is required

All commits require a [DCO](https://developercertificate.org/) sign-off. There is
no CLA — see [ADR-0006](docs/adr/0006-license-apache-2-and-single-monorepo.md) for
why.

```
git commit -s -m "your message"
```

## Two hard rules

These are enforced in CI. A PR that violates either will fail, and the fix is to
change the code, not the check.

**1. A clean clone must build with no credentials.**

```
git clone <repo> && cd adrkit && bun install && bun run build && bun test && bun run lint
```

must pass with no tokens, no services, no network beyond the package registry.
Contributions may not depend on private registries, authenticated APIs, or
anything requiring a managed device. See
[ADR-0007](docs/adr/0007-adapter-isolation-and-public-surface-build.md).

**2. The core depends on no adapter.**

`packages/core`, `packages/cli`, and `schema/` import nothing from
`packages/adapters/*`. Integrations are optional, separately versioned, and
allowed to break on upstream churn. The core is not.

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
