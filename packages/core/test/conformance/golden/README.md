# adrkit conformance fixture

A small fixed corpus and the golden CLI JSON it produces: the conformance fixture that
[ADR-0030](../../../../../docs/adr/0030-keep-extension-surfaces-that-carry-a-dependency-tree-outside-this-repository.md)
clause 5 names and
[ADR-0031](../../../../../docs/adr/0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md)
action item 6 assigns to `@adrkit/sdk` as its own test fixture.

| File | What it is |
|---|---|
| `repo/` | A repository root: `docs/adr/` (seven records plus one nested file discovery cannot see) and `src/` files, two of them carrying inbound `@adr` markers. |
| `manifest.json` | The exact invocations, run with `repo/` as the working directory, and their exit codes. |
| `queue.json` | `adr queue --format json --as-of 2026-07-15` (QueueReport v1). |
| `check.json` | `adr check --json` over five paths, one of which does not exist. |

What the corpus exercises: an accepted record governing by pattern, one governing only by
marker, a supersession whose replaced record is still named by a marker (`stale-marker`), a
`proposed` record that is queued, overdue on the pinned date, with two approvals that are one
identity under casefold and one open objection, a `proposed` record with no review block, a
`draft`, `relatesTo` and `conflictsWith` edges, a skipped nested file (`warn`), and an absent
path in the check.

## Using it downstream

Run each `manifest.json` command with `repo/` as the working directory against the version of
`adr` you pin, and compare stdout byte for byte with the golden, and the exit code with
`exitCode`. A difference is a change to the CLI JSON contract that the version you pin
carries. The fixture is checked out with LF line endings (`.gitattributes`), because
`queue.json`'s `corpusFingerprint` is computed over the record bytes.

## In this repository

- `packages/cli/test/conformance.test.ts` runs the CLI over the fixture and requires both
  goldens byte for byte.
- `packages/sdk/test/conformance.test.ts` runs `@adrkit/sdk` over the same corpus and requires
  its `queue()` and `governing()` to describe the same decisions as the goldens.

The goldens are a contract, not a snapshot: regenerate them only in the change that
deliberately alters the CLI JSON, and say so in the CHANGELOG. To regenerate, run the commands
in `manifest.json` from `repo/` with `bun ../../../../../cli/src/index.ts <args> > ../<golden>`.
