# @adrkit/cli

Git-native architecture decision record tooling from adrkit.

```sh
bun add --dev @adrkit/cli
bunx adr lint
```

For one-off use:

```sh
bunx @adrkit/cli lint
```

The `adr` binary includes `new`, `lint`, `graph`, `explain`, `check`, `queue`,
`migrate --from madr`, and the offline deterministic `evaluate` command.

Run `adr --help` for the command list, `adr help <command>` for one command's
flags, and `adr --version` to print the installed version.

The published ESM CLI runs on Node.js 22 or newer.

Documentation: <https://adrkit.dev>

License: Apache-2.0
