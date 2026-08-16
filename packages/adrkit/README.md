# adrkit

The [adrkit](https://adrkit.dev) CLI under its unscoped name. This package
contains no logic of its own — it forwards to
[`@adrkit/cli`](https://www.npmjs.com/package/@adrkit/cli), which is the
canonical package and the one to depend on directly.

```sh
npx adrkit lint
npx adrkit explain src/payments/api.ts
```

## Why this package exists

`adr` on npm belongs to an unrelated package. That makes a bare `npx adr`
unsafe in a way documentation cannot fix: it reaches adrkit only when the
binary happens to be linked into `node_modules/.bin`, and otherwise runs the
other tool *without failing*. In CI it does not even prompt, because npm
assumes `--yes` when stdin is not a TTY.

Publishing `adrkit` makes the unscoped name resolve to adrkit by construction
rather than by luck, and keeps it from being claimed by anyone else.

## Which package should I install?

Depend on `@adrkit/cli`. It installs both an `adr` and an `adrkit` binary, and
it is where versions, changelog, and documentation live.

This package is for the zero-install path — `npx adrkit …` — and for anyone who
reaches for the unscoped name by reflex. It tracks `@adrkit/cli` exactly: same
version, same commands, same exit codes.

Full documentation: <https://adrkit.dev>
