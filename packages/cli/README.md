# @adrkit/cli

Git-native architecture decision record tooling from adrkit.

## Install and run

Use the package name for zero-install runs. The published binary is `adr`, but a
bare `npx adr` resolves an unrelated npm package:

```sh
npx @adrkit/cli lint
```

For project use, add it as a dev dependency and invoke it through a script:

```sh
npm install --save-dev @adrkit/cli    # or: bun add --dev @adrkit/cli
npm pkg set scripts.adr=adr
npm run adr -- lint
```

That keeps you on the installed local binary instead of whatever `npx adr` might
download from the registry.

You can also install it globally:

```sh
npm install -g @adrkit/cli
adr lint
```

Every install also provides `adrkit`, an identical alias for the same binary.
Prefer `adrkit` in CI, Makefiles, and agent instructions because its name is
unambiguous:

```sh
adrkit lint
```

Do **not** use `npx adrkit` or `bunx adrkit`. There is no unscoped `adrkit`
package, so those forms would resolve against the registry rather than the
published `@adrkit/cli` package.

Human-readable CLI output is TTY-aware: it stays ANSI-free when redirected or
piped, honors `NO_COLOR`, and can be forced with `--color auto|always|never`.

## Commands

The binary includes:

- `new`
- `lint`
- `graph`
- `explain`
- `check`
- `queue`
- `migrate --from madr`
- `completion`
- `evaluate`

Run `adr --help` for the command list, `adr help <command>` for one command's
flags, and `adr --version` to print the installed version.

## Shell completions

`adr completion <bash|zsh|fish>` prints a deterministic completion script to
stdout. The generated script registers both `adr` and `adrkit` where the shell
format permits.

```sh
adr completion bash > ~/.local/share/bash-completion/completions/adr
cp ~/.local/share/bash-completion/completions/adr ~/.local/share/bash-completion/completions/adrkit
adr completion zsh > ~/.zsh/completions/_adr
cp ~/.zsh/completions/_adr ~/.zsh/completions/_adrkit
adr completion fish > ~/.config/fish/completions/adr.fish
cp ~/.config/fish/completions/adr.fish ~/.config/fish/completions/adrkit.fish
```

If you prefer symlinks, point both Fish entry points at the same generated file:

```sh
ln -sf ~/.config/fish/completions/adr.fish ~/.config/fish/completions/adrkit.fish
```

## Inbound `@adr` markers

`adr explain <path>` and `adr check <files...>` resolve decisions in both
directions. A record declares the paths it governs with `affects`; a source
file can declare the decision it lives under with a comment marker:

```ts
// @adr 0012
export function syncOnce() { /* ... */ }
```

```
$ adr explain src/services/sync/retry.ts
Decisions governing src/services/sync/retry.ts:
  0009  [accepted] Resolve affects deterministically
    via path: src/services/sync/**
  0012  [accepted] Bind catalog entities to owned paths
    declared by src/services/sync/retry.ts:1 (@adr 0012)
```

Marker scanning is intentionally narrow:

- only the first **8192 bytes** of a file are considered
- the scan stops at the last complete line inside that window
- the marker must be the first content on a dedicated comment line
- lines inside fenced code blocks are ignored
- markdown files (`.md`, `.mdx`, `.markdown`) accept only `<!--` and `{/*`

Nothing is written back to the record.

In `--json`, pattern matches appear in `firedMatchers` and file declarations in
`declaredBy`. `explain --json` includes a single-file `markers` block plus
`scannedBytes` and `fileBytes`. `check --json` includes a `markerScan` report
with state counts and exact unavailable, truncated, and skipped paths.

Multi-file scans are capped at **3,000 normalized paths** with **16 concurrent
reads**. Skipped paths warn but never fail, and marker claims never change the
exit code.

See [the commands reference](https://adrkit.dev/commands/#inbound-adr-markers).

The published ESM CLI runs on Node.js 22 or newer; development in the adrkit
repository uses Bun.

See also [`@adrkit/mcp`](../mcp/README.md), a local read-only Model Context
Protocol server that exposes the same corpus to coding agents.

Documentation: <https://adrkit.dev>

License: Apache-2.0
