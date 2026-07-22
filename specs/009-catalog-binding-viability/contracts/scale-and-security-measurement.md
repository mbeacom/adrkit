# Contract: Scale and Security Measurement Model (No Invented Production Limits)

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-018, FR-023,
User Story 6 (all 3 acceptance scenarios), SC-010, SC-011. Companion to
`data-model.md` §18 (`ScaleEvidenceRecord`), §19 (`StandaloneScratchRepository`),
§20 (`NetworkDenialRecord`), §21 (`MutationBaseline`), `research.md` R10.
Normative source: ADR-0012 "Decode/security/scale evidence."

## 1. What Is Measured (Fixed Set, FR-023)

For **each** of the three FR-009 single-repository passes, measure and
record: total `adrkit.io/owned-paths` annotation bytes; entity count;
patterns per entity (min/max/mean); maximum pattern length; count of
multi-document files; count of any ref aliases encountered; and wall-clock
compile+match cost. Nothing beyond this fixed set is required, and nothing
beyond it should be added without updating this contract first.

## 2. Measurement Protocol (`research.md` R10)

1. **Fixed workload**: one written-down candidate changed-file list per
   pass, defined before measurement begins and never regenerated between
   repetitions.
2. **Repetitions**: at least 6 total per pass — 1 discarded warm-up
   iteration, plus at least 5 retained measured iterations.
3. **Compile discipline**: each accepted glob is compiled exactly once **per
   repetition** — never once per match check within a repetition
   (`contracts/glob-dialect.md` §6).
4. **Reported statistic**: the median of the retained iterations' wall-clock
   compile+match time, **plus** the full retained-iteration list (never the
   median alone) so a skeptical reader can recompute a different
   aggregation.
5. **Environment recorded alongside every number**: host OS, CPU
   architecture, and the runtime/version actually executing the run (e.g.
   `bun --version`).

## 3. Aggregation Across Passes (User Story 6, Acceptance Scenario 3)

Per-pass numbers are recorded individually, then aggregated into **one**
combined scale-evidence summary in the evidence bundle, with **every figure
clearly attributed to its originating pass** — never merged into a single
undifferentiated total that loses per-pass attribution. `annotationBytesTotal`
is `0` for both real-corpus passes (neither carries the annotation) and
non-zero only for the synthetic pass — this is expected, not an error.

## 4. The "Not Guessed Now" Rule (FR-023)

The spike MUST NOT propose a specific production scale limit from this
evidence alone — `ScaleEvidenceRecord.productionLimitProposed` is always
`false` (`data-model.md` §18), a fixed literal existing precisely so no
future edit can silently introduce an invented number. Production limits, if
ever set, must be ratified from evidence in a separate, later decision —
this spike's own contribution is the raw, honestly-measured numbers, never
a recommendation about where to cap them.

## 5. Security Evidence — Network Denial (FR-018; SC-011)

Every actual fixture/corpus derivation run (parsing, validating,
canonicalizing, generating a snapshot) begins only after the one-time,
already-completed preflight acquisition step for the three FR-001 commits,
and runs with network access **actively denied** for the run's duration —
never merely "no network calls happened to occur," and never merely a
documentation-only review of the generator's own source. This plan requires
one of exactly **two** qualifying mechanisms (`research.md` R10), both of
which must genuinely prevent a network syscall from succeeding:

1. **OS-level network namespace or firewall block** — the preferred,
   strongest mechanism (e.g. a Linux network namespace with no configured
   interface, or an OS firewall rule denying all egress for the process
   tree).
2. **Process-level sandbox that structurally denies network syscalls** —
   e.g. a `seccomp`-based or platform sandbox profile (macOS `sandbox-exec`
   with a network-deny profile, Linux `unshare --net`) configured to block
   socket/connect syscalls outright. This is **not** the same as an
   `env -i`/restricted-`PATH` convention: stripping environment variables or
   removing networking tools from `PATH` does not prevent a Bun or Node
   process from making a raw socket or `fetch` call, and does not qualify on
   its own.

**Allowlisted-environment-plus-static-source-review does not, by itself,
satisfy this requirement.** It MAY be used only as a supplementary
corroborating check (confirming no credential or endpoint is configured, and
the generator's own source contains no network call site) alongside one of
the two mechanisms above — never as the sole claimed mechanism for any
FR-009 derivation run. A run whose evidence names only an allowlist/static-
review check, with neither mechanism 1 nor 2 actually in effect, does not
satisfy FR-018/SC-011 and is itself a candidate `no-go` finding
(`contracts/evidence-bundle-and-verdict.md` §2). If neither qualifying
mechanism is available in the execution environment, the run MUST NOT
proceed — this is a fail-closed constraint on the execution environment
itself, not merely an evidence-recording nicety.

Whichever mechanism is actually used MUST be named explicitly in the
evidence bundle (`NetworkDenialRecord.mechanismUsed`, `data-model.md` §20),
along with its exact configuration.

Additionally: no credential or bearer-token environment variable may be set
for any derivation run, and every run is bracketed by a `git status
--porcelain` capture immediately before and immediately after, showing no
change in either case (`MutationBaseline`, `data-model.md` §21) —
non-identical before/after captures are themselves an
`SC-012`/`no-go`-triggering finding, per `contracts/evidence-bundle-and-verdict.md`.

## 6. Compile-Cost Isolation From Match-Cost

Because §2 item 3 requires compiling each accepted glob exactly once per
repetition, the measured `compileMatchCostMs` figure necessarily includes
both the one-time compile cost and the repeated match cost within that same
repetition — this contract does not require separately isolating the two
(that would be a finer-grained measurement this spike is not scoped to
produce), only that compilation itself is not wastefully repeated per match
check, which would otherwise inflate the reported figure with an
implementation artifact unrelated to the dialect's own real cost.
