# @adrkit/cli

Git-native architecture decision record tooling from adrkit.

Zero-install with `npx`, naming the package (the published binary is `adr`, but a
bare `npx adr` resolves an unrelated `adr` package on npm):

```sh
npx @adrkit/cli lint
```

Or add it as a dev dependency and invoke it through your runner, which puts
`node_modules/.bin` on PATH — a bare `adr` will not be on an interactive shell's
PATH:

```sh
npm install --save-dev @adrkit/cli    # or: bun add --dev @adrkit/cli
npx adr lint                          # or: bunx adr lint, or an npm script
```

The `adr` binary includes `new`, `lint`, `graph`, `explain`, `check`, `queue`,
`migrate --from madr`, and the offline deterministic `evaluate` command.

Run `adr --help` for the command list, `adr help <command>` for one command's
flags, and `adr --version` to print the installed version.

The published ESM CLI runs on Node.js 22 or newer; development in the adrkit
repository uses Bun.

See also [`@adrkit/mcp`](../mcp/README.md) — a local, read-only Model Context
Protocol server that exposes this corpus (including superseded/rejected
decisions) to coding agents.

Documentation: <https://adrkit.dev>

License: Apache-2.0
