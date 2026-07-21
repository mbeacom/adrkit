# Contract: Isolation and Offline — Scratch Boundary, No-Mutation Boundary, Offline Subprocess Boundary, Network-Denial Hierarchy

**Feature**: `008-spec-kit-hook-viability` | **Freezes**: FR-011, FR-012, FR-017,
A8, and the Edge Cases network-denial note. Companion to `research.md` R3,
R5–R8, R10 (this contract is the normative statement; research.md records
the reasoning behind it).

## 1. Scratch-Worktree / Project Isolation Boundary

| Boundary | Rule |
|---|---|
| Fixture source + scratch `specify init` project | MUST live outside any git-tracked clone of `mbeacom/adrkit` (research.md R3). Never a branch or worktree of *this* repository. |
| Scratch adrkit feature used for the live `/speckit.plan` run (User Story 2) | MUST be created outside the committed `specs/` tree (FR-017) and MUST NOT become a numbered feature in this repository's `specs/` directory (A8). |
| Evidence bundle files | MUST live in the executing session's own session-scoped artifacts directory, never inside this repository's working tree, tracked or not (research.md R3). |
| Crossing rule | Nothing produced inside the scratch boundary may cross into this repository's tracked history at any point during this spike — not as a commit, not as a branch push, not as a PR (FR-017, Out of Scope). |

**Violation handling**: if any artifact from the scratch boundary is ever
found staged, committed, or pushed against `mbeacom/adrkit`, that is an
immediate `no-go`-triggering event under `data-model.md` §7 rule 1 (a
mutation), independent of whether the artifact's *content* was otherwise
harmless.

## 2. No-Mutation Boundary and Its Evidence

**Rule**: every fixture invocation — install, hook fire, disable, remove, both
failure probes, and any direct/manual invocation — leaves `git status
--porcelain=v1` and (for the `hook-fire` category specifically, against this
repository) `git diff --stat -- docs/adr` byte-identical immediately before
and immediately after (FR-012, SC-003; `data-model.md` §5's
`MutationBaseline` entity is the evidence shape).

**Capture procedure** (research.md R5/R7, restated normatively here):

1. Immediately before the invocation: capture `statusBefore` (and, for
   `hook-fire` only, `adrDiffStatBefore`).
2. Run the invocation.
3. Immediately after: capture `statusAfter` (and, for `hook-fire` only,
   `adrDiffStatAfter`).
4. Compute `identical`. A `false` result is not merely logged — it triggers
   the `no-go` verdict path in `contracts/evidence-bundle-and-verdict.md`
   §2 Step 1, unconditionally.

## 3. Offline, No-Credential Built-`adr`-Subprocess Boundary (FR-011)

**Rule**: whenever the fixture's command needs ADR governance data, it
obtains it **exclusively** by spawning adrkit's built Node CLI artifact
(`packages/cli/dist/index.js`) as a subprocess — never by importing
`@adrkit/core` directly, never by reading `docs/adr/**` itself. That
subprocess call runs with:

- Outbound network access disabled (per the ranked mechanism hierarchy in §4
  below).
- No credential environment variable present (per the allowlist in §3.1
  below — only `PATH` and the validated, non-secret `ADRKIT_REPO_ROOT` path).

**`SubprocessInvocation` shape** (`data-model.md` §9 reference):

```json
{
  "commandLine": "node $ADRKIT_REPO_ROOT/packages/cli/dist/index.js queue --dir $ADRKIT_REPO_ROOT/docs/adr --format json",
  "allowlistedEnv": {
    "PATH": "<redacted-but-present>",
    "ADRKIT_REPO_ROOT": "<canonical local path, no credential>"
  },
  "networkDenialMechanism": "os-namespace-or-firewall | process-level-egress-block | allowlisted-env-plus-static-review",
  "stdout": "<verbatim JSON from adr queue>",
  "stderr": "",
  "exitCode": 0
}
```

### 3.1 Allowlisted Environment (research.md R6)

The subprocess call's environment is constructed as an **allowlist**, not a
denylist. The illustrative script in `contracts/fixture-surface.md` §1 uses
`env -i PATH="$PATH" ADRKIT_REPO_ROOT="$ADRKIT_REPO_ROOT" node ...` — starting
from a fully empty environment and adding back only the executable search path and the
canonical, non-secret local adrkit checkout path. No `GH_TOKEN`, `GITHUB_TOKEN`,
`SPECKIT_*`, or any other
credential-shaped variable is ever passed through.

## 4. Network-Denial Mechanism Hierarchy (Edge Cases note; research.md R8)

A future execution session applies the strongest available mechanism, in
this fixed order, and records exactly which one in
`NetworkDenialRecord.mechanismUsed` (`data-model.md` §4):

| Rank | Mechanism | Strength | Requires |
|---|---|---|---|
| 1 | OS-level network namespace / firewall isolation (`unshare --net`, container `--network none`, or equivalent) | Enforced at the kernel — an attempted connection fails | Privileges the execution environment may not grant |
| 2 | Process-level egress blocking (`pfctl` on macOS, `iptables`/`nftables` on Linux, scoped to the invocation) | Enforced, narrower scope | Elevated/administrative privileges |
| 3 | Allowlisted environment (§3.1) + full source-level review of the fixture command's only external call | Establishes absence of configured credentials/endpoints, corroborated by review of a short, fully-readable command | No special privileges — the fallback for a shared, unprivileged sandbox |

**Honest limitation, stated now, not discovered later**: mechanism 3 does not
*prove* the absence of a network call the way mechanisms 1–2 do. It
establishes that no credential or endpoint is configured for one to succeed
against, corroborated by reading the fixture's own short command source in
full and confirming its only external process invocation is the adrkit CLI
subprocess call (§3) — which is independently known to be offline by
construction, since every `@adrkit/cli` command reads only the local
filesystem (Principle II; ADR-0007). If a future execution session's
environment supports only mechanism 3, `NetworkDenialRecord.limitationsStatement`
MUST record this exact limitation, not a stronger claim than what was
actually verified.

## 5. What This Contract Does Not Cover

- The catalog/search/update network calls upstream's own `specify` CLI tool
  makes for *other* operations (e.g. `specify extension search`) are out of
  scope — this fixture is installed via `--dev` only (FR-005), which per
  `EXTENSION-USER-GUIDE.md` §"Install from Local Directory (Development)"
  requires no catalog fetch. The one-time `specify-cli` tool install itself
  (already complete per A2) is the sole network access this spike's evidence
  bundle is not required to deny.
- Windows-specific sandboxing primitives — cross-platform verification is out
  of scope (Assumption A9).
