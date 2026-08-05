# Negative cases

One subdirectory per deliberately-constructed failing input, retained under
[ADR-0016](../../../../docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)
clause 2: *"Keep that input as a permanent negative case, not a throwaway. The
artifact that proves the check works is the case that makes it fail."*

## Convention

Each case lives in its own subdirectory, named for the rule it violates, and is
**self-describing**. A reader should need nothing outside that subdirectory to
understand what was constructed, what command was run, and what was emitted.

Each subdirectory carries:

| File | Contents |
|---|---|
| `README.md` | what was constructed and why, which command produced the failure, the exact emitted strings, and where the permanent automated case lives |
| `*.patch` | the failing input itself, as a `git apply`-able diff — this is the retained artifact clause 2 asks for |
| `*.observed.txt` | verbatim captured stdout+stderr and exit code, written by the run rather than transcribed from it |
| `restored.observed.txt` | the same command after the input is reverted, showing the pass |

**Always record which command produced the failure.** `bun run check:deps` and
`bun run typecheck` are not interchangeable, and at least one case in this tree
fails under one and passes under the other — see `dep-core-to-adapter/`.

## This file is deliberately not an index

`negative-cases/` is a shared deposit tree written by tasks across several
phases. An enumeration here would be stale the moment the next phase deposits,
and a stale manifest of what is present is precisely the failure ADR-0016 is
about. **Read the directory, not this file.**

What is recorded here, because it stays true: **Phase A** (T009–T012) deposited
`dep-core-to-adapter/`, `dep-consumer-to-adapter/`, `dep-adapter-to-consumer/`,
and `dep-allowlist-present/`. Later phases own their own subdirectories and
should not modify Phase A's.

## Standing constraints

ADR-0014 **rung 1 only**. Nothing in this tree is reference-verified (rung 2) or
externally validated (rung 3). Every observation here is maintainer-owned, which
is not external, third-party, or community validation.
