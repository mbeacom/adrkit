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

## Inbound `@adr` markers

`adr explain <path>` resolves decisions in both directions. A record declares
the paths it governs with `affects`; a source file declares the decision it
lives under with a marker in a comment:

```ts
// @adr 0012
export function syncOnce() { … }
```

```
$ adr explain src/services/sync/retry.ts
Decisions governing src/services/sync/retry.ts:
  0009  [accepted] Resolve affects deterministically
    via path: src/services/sync/**
  0012  [accepted] Bind catalog entities to owned paths
    declared by src/services/sync/retry.ts:1 (@adr 0012)
```

This lets `affects` stay narrow — the *defining* files — while the surrounding
neighbourhood opts in one line at a time. Only the first 8192 bytes of a file
are scanned, in any language, and the marker must be the first content on a
dedicated comment line. Nothing is written back to the record. In
`--json`, pattern matches carry `firedMatchers` and file declarations carry
`declaredBy`, and a `markers` block reports whether the file was actually read.
See [the commands reference](https://adrkit.dev/docs/commands/#inbound-adr-markers).

The published ESM CLI runs on Node.js 22 or newer; development in the adrkit
repository uses Bun.

See also [`@adrkit/mcp`](../mcp/README.md) — a local, read-only Model Context
Protocol server that exposes this corpus (including superseded/rejected
decisions) to coding agents.

Documentation: <https://adrkit.dev>

License: Apache-2.0
