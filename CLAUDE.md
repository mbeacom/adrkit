# adrkit — Claude Code

Project memory for this repository is host-neutral and lives in one file.

@AGENTS.md

Read [`AGENTS.md`](./AGENTS.md) before doing anything else. It carries the
project overview, the surfaces and their current evidence-ladder status, the Bun
toolchain rules, and the agent working-directory rules — including the two that
have been violated in practice, about never writing to the maintainer's main
checkout and never deleting a branch on commit ancestry alone.

Nothing project-specific is duplicated here on purpose. A second copy costs
context on every session and drifts from the first.

## Claude Code specifics

- The `@AGENTS.md` line above is a Claude Code import, so the shared memory is
  loaded even when only this file is read.
- This repository is also its own plugin marketplace. To work with the plugin it
  ships, `/plugin marketplace add mbeacom/adrkit` then
  `/plugin install adrkit@adrkit`. Validate local changes to it with
  `claude plugin validate packages/adapters/agent-plugin` — that validator is
  stricter than GitHub Copilot CLI's loader and is how the manifest's shape was
  settled (see ADR-0028).
