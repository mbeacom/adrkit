# @adrkit/cli

Git-native architecture decision record tooling from adrkit.

Zero-install with `npx`, naming the package (the published binary is `adr`, but a
bare `npx adr` resolves an unrelated `adr` package on npm):

```sh
npx @adrkit/cli lint
```

Or add it as a dev dependency and invoke it through an npm script. A bare `adr`
will not be on an interactive shell's PATH, and a bare `npx adr` is worse than
missing — when the binary is not linked into `node_modules/.bin`, it silently
downloads and runs the unrelated registry package instead of failing. A script
resolves `node_modules/.bin` directly and stops with `command not found`:

```sh
npm install --save-dev @adrkit/cli    # or: bun add --dev @adrkit/cli
npm pkg set scripts.adr=adr
npm run adr -- lint
```

Or install it globally, which does put a bare `adr` on your PATH:

```sh
npm install -g @adrkit/cli
adr lint
```

Every install also provides `adrkit`, an identical alias for the same binary.
Nothing else on npm claims that binary name, so prefer it wherever a silent
wrong-tool substitution would be hard to notice — CI, `Makefile`s, and agent
instructions:

```sh
adrkit lint          # same binary, unambiguous name
```

That applies to the installed binary only. Do not use `npx adrkit` / `bunx
adrkit`: there is no unscoped `adrkit` package and there never will be — npm
refuses that name as too similar to `pdfkit`. The form resolves against the
registry and would run whatever anyone publishes under it — and in CI, where npm
assumes `--yes` on a non-TTY, it would install and run it without prompting. Use
`npx @adrkit/cli` for zero-install.

The `adr` binary includes `new`, `lint`, `graph`, `explain`, `check`, `queue`,
`migrate --from madr`, and the offline deterministic `evaluate` command.

Run `adr --help` for the command list, `adr help <command>` for one command's
flags, and `adr --version` to print the installed version.

## Inbound `@adr` markers

`adr explain <path>` and `adr check <files...>` resolve decisions in both
directions. A record declares the paths it governs with `affects`; a source
file declares the decision it lives under with a marker in a comment:

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
neighbourhood opts in one line at a time. At most the first 8192 bytes of a file
are scanned, in any language — the scan stops at the last complete line inside that
bound — and the marker must be the first content on a
dedicated comment line that is not inside a ` ``` ` or `~~~` fence — so
documenting the syntax, as this file does above, is not declaring it. In a
markdown file (`.md`, `.mdx`, `.markdown`) the comment is `<!--` or `{/*`; `#`
and `*` are a heading and a bullet there, and do not declare. Nothing is written
back to the record. In
`--json`, pattern matches carry `firedMatchers` and file declarations carry
`declaredBy`. `explain --json` carries a single-file `markers` block, while
`check --json` carries a `markerScan` report with scan-state counts and exact
unavailable, truncated, and skipped paths. The `explain` block also reports
`scannedBytes` / `fileBytes` — the prefix handed to the scanner and the file's size —
so `fileBytes - scannedBytes` sizes the unscanned remainder of a truncated file
instead of leaving it to be guessed from the window constant. The two are separate
observations taken either side of the read, so clamp the difference at `0`: a file
appended to mid-scan can report more scanned than total. Both `explain`'s human note
and `check`'s truncation warning disclose that measured extent per path; `check --json`
deliberately does not carry it, so its report shape is unchanged. Multi-file scans are
capped
at 3,000 normalized paths and 16 concurrent reads; skipped paths warn but never
fail. The cap matches GitHub's changed-file ceiling, so only a local invocation
can reach it.
See [the commands reference](https://adrkit.dev/docs/commands/#inbound-adr-markers).

The published ESM CLI runs on Node.js 22 or newer; development in the adrkit
repository uses Bun.

See also [`@adrkit/mcp`](../mcp/README.md) — a local, read-only Model Context
Protocol server that exposes this corpus (including superseded/rejected
decisions) to coding agents.

Documentation: <https://adrkit.dev>

License: Apache-2.0
