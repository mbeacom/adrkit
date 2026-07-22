# Research: Catalog Entity-to-Path Binding Compatibility Viability Spike

**Feature**: `009-catalog-binding-viability` | **Companion to**: [plan.md](./plan.md)

All items below are narrow implementation-planning decisions this task required
resolving, without changing core semantics, package dependencies, or the
hardened contract's own terms (ADR-0012/ADR-0013 remain the normative source;
this file only fixes *how a future execution session mechanically satisfies*
what those records and `spec.md` already require). Every corpus/upstream
citation below is copied verbatim from `spec.md`'s own Ratification
Record/Overview/FR-001 — this planning session performed **no new fetch** of
Backstage, `community-plugins`, or `rhdh-plugins` content; re-verification of
those three pinned SHAs remains FR-001's own execution-time obligation, not a
planning-time one. Two items below (R6, R8) cite this repository's own
already-installed tooling (`yaml@2.9.0`, `packages/core/src/fingerprint/`,
`packages/core/src/ordering/`) via `bun.lock`/source inspection, which is
tooling documentation, not spike evidence, and is exempt from the "no corpus
re-fetch" constraint.

## R1 — Citation Discipline (No New Fetch)

**Decision**: Every Backstage/corpus fact in this plan and its contracts is
copied verbatim from `spec.md`'s existing citations — the three pinned commits
named in FR-001 (Backstage `1121a4facd9e321179d0402c3f355e4a649e84d9`,
`backstage/community-plugins@92e9e4e09c76cc57f3475029b73e5ec84498a459`,
`redhat-developer/rhdh-plugins@3b355ddfedb23c6656bd9effc8510f9926b765c1`), the
exact descriptor counts (156/38, 23/156, 0/156), the exact file paths (the
three sibling `community-plugins` descriptors; the three `rhdh-plugins`
`github.com/project-slug` values), and the exact annotation/dialect values
from ADR-0012. No new upstream URL is fetched by this planning session.

**Rationale**: This task's own instruction restricts planning to "read-only
source verification already allowed for planning" and forbids "fetch[ing]
corpora beyond read-only source verification already allowed" — `spec.md`
already performed and cross-checked (twice, adversarially) the only fetch this
feature is authorized to have made before execution gates clear. Re-fetching
now would not strengthen the plan; it would only risk silently drifting from
the frozen citations FR-001 pins, which is exactly the moving-target failure
mode A1/A2 exist to prevent.

**Alternatives considered**: Re-fetching the three commits to "double-check"
during planning — rejected; FR-001's re-verification is explicitly an
execution-time step ("[i]mmediately before spike execution, each MUST be
re-verified"), and this plan does not open an implementation branch or begin
execution.

## R2 — Scratch/Session Artifact Paths

**Decision**: Two distinct scratch locations, mirroring the split
`specs/008-spec-kit-hook-viability/research.md` R3 already established for
this project, extended for this spike's two kinds of git-identity fixtures:

1. **General derivation-run scratch** (community-plugins-derived pass,
   rhdh-plugins-derived pass, primary synthetic pass, and all User Story 1/3/4/5/6/7
   fixtures): a disposable scratch directory created by a fresh `git init`
   (never a `git worktree add` of *this* repository — see item 2) **or** a
   throwaway branch/worktree of this repository kept entirely outside the
   committed `specs/` tree, per A7. Fixture source files (synthetic
   descriptors, input manifests) live here; nothing here is ever staged or
   committed to `main`.
2. **Standalone scratch git repository** (User Story 2's repository-mismatch
   tests only): a **separate**, fresh `git init`'d directory with its own
   `git remote add origin <chosen-url>` and its own commits — explicitly
   **not** a linked worktree of this actual repository, because a linked
   worktree shares remote configuration with the repository it was created
   from and so cannot be independently varied to produce a mismatch (A7,
   User Story 2's Independent Test). Exactly one such standalone repository is
   created per repository-identity test case (match, mismatch), each
   reconfigured or recreated as needed per A4.
3. **Evidence bundle**: the executing session's own session-scoped artifacts
   directory (this planning session's equivalent is
   `~/.copilot/session-state/<session-id>/files/`; a future execution session
   uses whatever the equivalent is for that session) — never a path under
   this repository's working tree, tracked or not, so an accidental
   `git add -A` in this repository cannot pick it up. This is a stricter
   location than item 1 precisely because the evidence bundle is the one
   artifact a future session might be tempted to leave "just outside" the
   tracked tree in this repository's own working directory; putting it in a
   wholly separate session-state directory removes that temptation by
   construction, matching `specs/008-...` R3's own rationale.

**Rationale**: FR-019/A7 require that no spike artifact ever becomes a
committed file as a side effect of running the spike, and User Story 2's own
Independent Test explicitly names the linked-worktree limitation as a reason
a wholly separate repository is required for the mismatch test specifically.
Splitting scratch locations three ways (general fixtures / mismatch-test
repository / evidence bundle) makes each constraint true by construction
rather than by discipline.

**Alternatives considered**: A single scratch directory for everything —
rejected, because it cannot simultaneously satisfy "linked worktree is
insufficient for the mismatch test" (User Story 2) and "general fixtures may
use a throwaway branch/worktree of this repository" (A7's "and/or" wording).

## R3 — Exact Evidence Filenames and Formats

**Decision**: The evidence bundle is a fixed set of files in the session
scratch directory (R2 item 3), all JSON except the one narrative Markdown
file (`spike-009-evidence.md`) and the raw `git-status-captures/*.txt` capture
pairs:

| File | Contents |
|---|---|
| `spike-009-evidence.md` | Human-readable narrative report; the one artifact a maintainer reads end-to-end. States the verdict, cites every FR/SC by ID, and reproduces the required disclaimers (FR-028–FR-030, SC-013) verbatim. |
| `spike-009-evidence.json` | The complete machine-checkable `EvidenceBundle` (`data-model.md` §22) — a top-level **manifest** that **references** every component artifact file below by an `ArtifactFileReference` (`{ relativePath, sha256 }`), never restating any of them field-for-field. The only inline members are the computed `verdict` and the two User Story 7 result records (`envelopeRejectionResults`, `repositoryIsolationCheck`) that have no standalone file of their own — and even those reference their fixture files. |
| `parsing-validation-results.json` | User Story 1's per-fixture `{ pattern, annotation }[]` results (`EvidenceBundle.parsingValidationResults`; `data-model.md` §1/§2/§22). |
| `identity-canonicalization-results.json` | `CanonicalEntityIdentity[]` including the case-only-duplicate and default-namespace scenarios (`EvidenceBundle.identityCanonicalizationResults`; §7). |
| `atomic-failure-records.json` | User Story 2's whole-operation `AtomicFailureRecord[]` (`EvidenceBundle.atomicFailureRecords`; §6). |
| `repository-identity-checks.json` | `RepositoryIdentityCheck[]` — the repository/revision match and mismatch cases (`EvidenceBundle.repositoryIdentityChecks`; §4). The FR-033 manifest-version/capability rejections live in `atomic-failure-records.json`, not here. |
| `identity-only-results.json` | User Story 4's `IdentityOnlyEntity[]` (`EvidenceBundle.identityOnlyResults`; §15). |
| `structural-edge-case-fixtures.json` | User Story 5's `StructuralEdgeCaseFixture[]`, all three kinds (`EvidenceBundle.structuralEdgeCaseFixtures`; §16). |
| `dotfile-policy-confirmation.json` | User Story 5 Acceptance Scenario 4's `DotfilePolicyConfirmation` (`EvidenceBundle.dotfilePolicyConfirmation`; §17). |
| `network-denial.json` | The `NetworkDenialRecord` for the derivation runs (`EvidenceBundle.networkDenial`; §20). |
| `mutation-baselines.json` | The `MutationBaseline[]` before/after `git status` records — each carrying the computed `identical` boolean the verdict's no-go check reads, and referencing its raw `git-status-captures/*.txt` pair (`EvidenceBundle.mutationBaselines`; §21). |
| `input-manifest.community-plugins.json` | FR-009/FR-033 manifest for the community-plugins-derived pass. |
| `input-manifest.rhdh-plugins.json` | Same, rhdh-plugins-derived pass. |
| `input-manifest.synthetic.json` | Same, primary synthetic pass. |
| `snapshot-envelope.community-plugins.json` | FR-022 envelope, community-plugins-derived pass. |
| `snapshot-envelope.rhdh-plugins.json` | FR-022 envelope, rhdh-plugins-derived pass. |
| `snapshot-envelope.synthetic.json` | FR-022 envelope, primary synthetic pass. |
| `envelope-fixtures/malformed-invalid-json.json`, `.../malformed-missing-or-wrong-field.json`, `.../malformed-unrecognized.json`, `.../malformed-missing-source-digest.json`, `.../malformed-identity-only.json` | User Story 7's **five** malformed rejection-case fixtures — one file per mutually-exclusive malformation kind (FR-034; `data-model.md` §22's `MalformedEnvelopeRejectionResult[]`; `contracts/snapshot-envelope.md` §2/§7). They cannot share one file: `malformed-invalid-json.json` is deliberately non-parseable, while the other four are different *valid*-JSON mutations of `snapshot-envelope.synthetic.json`, each auditable by diff against the valid original. |
| `envelope-fixtures/tampered.json`, `.../stale.json`, `.../wrong-repository.json` | User Story 7's tampered/stale/wrong-repository rejection-case derivatives of `snapshot-envelope.synthetic.json` (FR-035–FR-037). Each is a deliberately mutated copy, never a fresh independent generation, so the mutation is auditable by diff against the valid original. |
| `envelope-fixtures/second-repository.json` | The second, independently-generated, individually-valid single-repository envelope for User Story 7's repository-isolation check (FR-038) — a fourth pass, distinct from the three FR-022 passes, using a second throwaway synthetic repository identity (A4). |
| `comparison-matrix.json` | User Story 3's spike-authored labeled entity × changed-file matrix plus the B/C TP/FP/TN/FN classification and precision/false-positive-rate figures (or `undefined-for-this-heuristic-on-this-matrix`). |
| `scale-evidence.json` | FR-023's per-pass measurements, aggregated across all three FR-009 passes. |
| `git-status-captures/*.txt` | One before/after pair per derivation run (FR-018/SC-011), named `<pass-or-probe-label>.before.txt` / `.after.txt`. |

**Rationale**: `specs/008-...`'s R4 established a two-file (JSON + Markdown)
pattern for a spike with one fixture and one verdict; this spike produces
three required envelopes (SC-010) plus eight rejection-case derivatives (five
malformed, one each tampered/stale/wrong-repository) plus a second-repository
isolation fixture plus a separate comparison matrix, so a flat two-file bundle
would force either duplicating large JSON blobs inline inside
`spike-009-evidence.json` or losing per-artifact traceability. Naming every
artifact file explicitly, and having `spike-009-evidence.json`
**reference** them by relative path + digest (`ArtifactFileReference`,
`data-model.md` §22) rather than embedding them, keeps each artifact
independently diffable and keeps the top-level manifest legible — and is the
single representation the bundle uses (referenced file-backed artifacts;
inline small mechanical records only).

**Alternatives considered**: One monolithic JSON file with every envelope
nested inline — rejected; SC-010's requirement that each envelope be "an
actual run['s]" artifact "never...a description of what would be produced" is
best satisfied by each envelope being its own standalone file a consumer could
independently validate (per `contracts/snapshot-envelope.md`), not a nested
sub-object only reachable through the evidence bundle's own schema.

## R4 — Deterministic Ordering and Canonical JSON Choice

**Decision**: The spike's design reuses, by pattern (never by forking or
duplicating), the sort/canonicalization approach this repository's own
`@adrkit/core` already ships and already uses for an analogous
hash-a-canonical-projection purpose:

- **Owned-paths sort/dedupe** (FR-008): the same *shape* of convention
  `packages/core/src/affects/index.ts`'s `uniqueSortedFiredMatchers` already
  applies to fired-matcher output (deduplicate by key, then sort) — but the
  spike's design deliberately uses `packages/core/src/ordering/index.ts`'s
  `compareCodeUnits` as the actual comparator, **not**
  `uniqueSortedFiredMatchers`'s own `compareFiredMatcher`, which in fact
  calls `String.prototype.localeCompare` (verified by direct inspection of
  `packages/core/src/affects/index.ts`'s `compareFiredMatcher` function —
  this plan's earlier draft mis-cited it as already using
  `compareCodeUnits`, corrected here per the reader-test finding in §R13).
  `compareCodeUnits` is instead the comparator `packages/core/src/ordering/index.ts`
  itself was written to promote as "the one locale-independent comparator...
  Never `String.prototype.localeCompare`" for exactly the byte-stable
  channels (the queue kernel, the MCP corpus projection) that already need
  environment-independent determinism — the same property SC-001 requires of
  this spike's own output. FR-008's "consistent with the existing
  sort-and-dedupe convention" is therefore read as "consistent with this
  project's own established *shape* of convention (dedupe-by-key, then
  sort)," using the **stronger**, already-precedented-elsewhere-in-this-repo
  `compareCodeUnits` comparator rather than the fired-matcher path's own
  locale-dependent one — never a claim that the fired-matcher code path
  itself already uses `compareCodeUnits`.
- **Array element ordering, closing a gap the reader test found**: RFC
  8785-style canonicalization preserves *whatever* order an array already
  has — it does not itself impose one. Because
  `SnapshotEnvelope.entities`/`sources` and `CanonicalEntityIdentity.allRefs`
  are all arrays, this plan fixes their producer-side ordering explicitly, so
  "deterministic entities" does not silently depend on an unspecified
  insertion order: `entities` is sorted by `identity.canonicalId`
  (`compareCodeUnits`); `sources` is sorted by `path` (`compareCodeUnits`);
  `allRefs` is `[canonicalId, ...fixtureAuthoredAliasRefs sorted by
  compareCodeUnits]` (the canonical ID always first, aliases sorted after
  it, never the reverse). This ordering is itself part of what
  `contracts/snapshot-envelope.md` §1 and `data-model.md` §7/§9 fix, not an
  incidental implementation detail.
- **Envelope canonicalization for the digest** (FR-035): the same structural
  approach `packages/core/src/fingerprint/index.ts`'s `canonicalStringify`
  already implements and `fingerprintOf` already uses to hash a canonical
  corpus projection for the queue kernel and MCP server — recursively sorted
  object keys at every nesting level by code-unit order, arrays serialized in
  declaration order, compact separators (no insignificant whitespace),
  `undefined` fields omitted, UTF-8 encoding before hashing. This already
  is byte-equivalent to RFC 8785/JCS over this envelope's closed scalar domain
  (strings, booleans, null, and bounded non-negative integers). The operative contract is
  the enumerated `canonicalStringify`-compatible algorithm above; this spike does not claim
  general RFC 8785 support for arbitrary JSON numbers or values, does not need, and MUST NOT
  introduce, a separate RFC 8785 library dependency.

**Rationale**: `@adrkit/core` already contains one pure, already-tested,
already-precedented canonicalization function built for exactly this
"hash a JSON projection deterministically" purpose (`fingerprintOf`, used by
the already-merged Phase 6 queue kernel). Reusing its algorithmic shape — the spike's
own generator script may import `canonicalStringify`/`compareCodeUnits` as
already-published pure utilities from `@adrkit/core`'s public entry point,
never by copying or forking their source — avoids introducing a second,
subtly-incompatible canonicalization scheme into the same repository, and
costs no new dependency (Constitution Principle III). This is reuse of an
existing published function, not a change to it or to any existing type
(FR-020 is unaffected: neither function's signature or behavior changes).

**Alternatives considered**: A dedicated `json-canonicalize`-style npm
package implementing general RFC 8785 — rejected; it would be a new
dependency for a property this repository's own core package already
provides correctly, and Constitution Principle III restricts new core-adjacent
dependencies to what is "vetted" and already justified. Locale-aware
`String.prototype.localeCompare` sorting — rejected; `compareCodeUnits`
existing specifically to avoid locale-dependent, environment-variable sort
order is exactly the property SC-001's byte-identical-across-runs requirement
needs, and introducing a second sort convention would risk exactly the kind
of subtle non-determinism this spike must prove absent.

## R5 — Manifest and Envelope Shapes

**Decision**: Both shapes are fixed exactly (fields, types, exact literal
values) in `data-model.md` §3 (`InputManifest`) and §9 (`SnapshotEnvelope`);
this item records only the two structural principles governing both, so a
future execution session does not need to re-derive them from first
principles:

- **One digest algorithm throughout.** Both the manifest's per-source digests
  (FR-009's "descriptor paths and digests") and the envelope's content digest
  (FR-035) use SHA-256 hex-encoded output. Using a single algorithm
  everywhere in the spike avoids introducing a second hash primitive for no
  documented reason, and SHA-256 is already what FR-035 fixes for the
  envelope digest.
- **Manifest fields are typed and closed, never a passthrough bag.** The
  `InputManifest` shape names every field FR-009/FR-033 require
  (`manifestSchemaVersion`, `requestedSnapshotSchemaVersion`,
  `requiredCapabilities`, `repository.id`, `repository.revision`, and a
  `sources` array of `{path, digestAlgorithm, digest}` triples) and nothing
  else — an unrecognized top-level field is itself an "unsupported manifest
  version"-class rejection (FR-033), not silently ignored, since silently
  ignoring an unknown field is exactly the kind of latent-capability
  ambiguity the hardened contract's fail-closed philosophy forecloses
  elsewhere.

**Rationale**: Fixing the digest algorithm once, rather than letting the
manifest and the envelope independently choose, removes an entire axis of
accidental inconsistency a future execution session might otherwise
introduce without a documented reason. Closing the manifest schema (rather
than allowing arbitrary extra fields) is consistent with FR-033's own closed
enumeration for `requiredCapabilities` and FR-034's closed enumeration for
envelope-consumer rejection reasons.

**Alternatives considered**: Letting the manifest's own schema be
open/extensible for "future capabilities" — rejected as scope creep beyond
this spike's single defined capability (`pathOwnership`); FR-033 already
closes `requiredCapabilities` to exactly one string, and an open manifest
schema elsewhere would be an inconsistent design within the same artifact.

## R6 — Repository ID Normalization Algorithm

**Decision**: FR-009 fixes the target shape (`lowercase
github.com/<owner>/<repo>`) but not the exact parsing algorithm from a real
`git remote get-url origin` value, which may appear in any of several forms.
This plan fixes the algorithm, applied identically to (a) the manifest's
declared `repository.id` at authoring time and (b) the value read from the
checkout's actual `origin` at generation time, so the two are compared on
equal footing:

1. Read the raw remote URL string (`git remote get-url origin`, or the
   manifest author's own declared value), and strip any trailing whitespace.
2. Strip **one or more** trailing `/` characters, if present (handles a
   remote configured as `.../repo.git/` or `.../repo/`, not merely a single
   trailing slash).
3. If the result matches `^git@github\.com:(.+)$`, rewrite to
   `github.com/$1`.
4. If the result matches `^(?:https?|ssh)://(?:git@)?github\.com/(.+)$`,
   rewrite to `github.com/$1`.
5. If the result matches `^github\.com/(.+)$` already (no scheme), keep as
   is.
6. Strip an exact trailing `.git` suffix, if present (applied **after**
   steps 2–5, so `.../repo.git/` is handled by step 2 stripping the slash
   first, then this step stripping `.git`, in that order — never the
   reverse, which would leave a dangling `/` unstripped).
7. **Reject anything but exactly two non-empty path segments.** After steps
   2–6, the remainder following `github.com/` MUST match
   `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$` exactly — exactly one `owner`
   segment, one `/`, and one `repo` segment, each composed only of the
   characters GitHub itself permits in an owner/repository name
   (alphanumerics, hyphens, underscores, periods), with **no** further path
   segments, no query string, and no fragment. `github.com/owner/repo/extra`,
   `github.com/owner/repo?x=1`, and `github.com/owner` (missing the repo
   segment) are all **not a valid repository ID** under this rule — this
   closes the gap the reader test found, where an unbounded
   `(.+)` capture in steps 3–5 could otherwise accept a URL with trailing
   path segments as if it were a bare `owner/repo` pair.
8. Lowercase the entire resulting string using a plain ASCII case fold
   (`String.prototype.toLowerCase()` is sufficient — GitHub owner/repository
   names are constrained to ASCII alphanumerics, hyphens, underscores, and
   periods, so no Unicode-aware case-folding library is required).
9. If the input matches none of steps 3–5, or fails step 7's exactly-two-
   segments check, the result is **not a valid repository ID** — this is
   itself a fail-closed condition, never a best-effort guess, consistent
   with FR-009's "reject a mismatch" default posture.

**Rationale**: A `git remote get-url origin` in a real checkout can be `git@
github.com:owner/repo.git`, `https://github.com/owner/repo.git`,
`https://github.com/owner/repo`, or `ssh://git@github.com/owner/repo.git`,
depending on how the checkout was cloned — User Story 2's own Independent
Test requires reading this value "via separate git tooling," so the
normalization step that follows must handle every form a real clone can
produce, not only the one canonical form the manifest itself is expected to
declare. Fixing this now prevents an execution session from silently
accepting a same-repository-different-URL-form pair as a "mismatch" it
shouldn't be, or vice versa.

**Alternatives considered**: Requiring the checkout to already use the exact
canonical form (rejecting any other `origin` form outright) — rejected; this
would make the repository-boundary check spuriously fail for a checkout
cloned via SSH, which is a normal, common configuration this spike's own
standalone scratch repositories (R2 item 2) may reasonably use.

## R7 — Input Boundaries (What the Generator May Read/Write)

**Decision**: A single generation invocation's I/O surface is closed:

- **Reads**: the input manifest file (by its own provided path); each
  descriptor file path the manifest's `sources` array lists, and only those
  — every listed `path` first passes source-path validation
  (`contracts/input-manifest.md` §4.1: a lexical rejection pass against
  empty/absolute/leading-slash/drive/UNC/backslash/`.`/`..`/control-character
  forms, then a `realpath`-confined check that the resolved target — symlinks
  followed — still lies beneath the verified checkout root, failing closed on
  any escape) **before** the file is opened; then each is opened, its SHA-256
  digest independently computed, and compared against the manifest's declared
  digest for that source *before* its content is trusted, per FR-009's
  "incomplete required source" rejection class; `git remote get-url origin`
  and `git rev-parse HEAD`, invoked as subprocesses against the checkout root
  the manifest claims to describe (never re-read from the manifest file
  itself, per FR-009/User Story 2).
- **Writes**: exactly one output envelope file, at a path supplied to the
  invocation; stdout/stderr for diagnostics and the exit code. No other file
  is created, moved, or deleted by a generation run.
- **Explicitly never**: a recursive directory walk or glob expansion to
  "discover" descriptor files not explicitly named in the manifest (this is
  the direct operationalization of FR-010's "reads only the descriptor files
  explicitly listed... does not follow a `Location` entity's `spec.targets`
  reference... does not invoke any catalog processor or plugin"); any network
  call of any kind during the read/write window (FR-018).

**Rationale**: FR-010 and FR-018 already state the completeness and
network-denial constraints in prose; this item fixes the literal file-system
and subprocess surface a future execution session's generator script may
touch, so "the generator never reads a file outside the manifest" (User
Story 5, Acceptance Scenario 3) is a mechanically checkable property (e.g. via
a syscall/strace-level or language-level file-access audit during the
derivation run) rather than a behavior inferred only from the output.

**Alternatives considered**: Allowing the generator to read the entire
descriptor directory and filter to the manifest's listed paths in memory —
rejected; even though the *effective* result might be identical for a
well-formed manifest, this would make "the generator never reads a file
outside the manifest" empirically unverifiable (a directory read that is
merely filtered still touches the filesystem outside the manifest's named
set), undermining User Story 5 Acceptance Scenario 3's specific proof
requirement.

## R8 — Parser Duplicate-Key Behavior

**Decision**: Duplicate-YAML-mapping-key detection (FR-006) relies on the
`yaml` package's own default behavior. `yaml@2.9.0` is already pinned in
`bun.lock` and already a direct `packages/core` dependency (`package.json`
`"yaml": "latest"`). That package's `parse()`/`parseDocument()` family accepts
a `uniqueKeys` option that **defaults to `true`**, meaning a duplicate mapping
key at any level already throws a `YAMLParseError` ("Map keys must be
unique") without any additional configuration. The spike's design therefore
does **not** introduce a custom duplicate-key scanner: it parses each
descriptor document with the library's own default options (never passing
`uniqueKeys: false`, and never post-hoc re-serializing and comparing key
counts as a workaround), and treats any resulting `YAMLParseError` whose
message indicates a duplicate key as FR-006's duplicate-YAML-key rejection
class, distinct from FR-003's JSON-shape rejection class (which applies only
to the *decoded annotation value*, not the surrounding YAML document).

**Rationale**: Reusing a well-known, already-pinned dependency's own default,
documented safety behavior is simpler and more trustworthy than writing a
bespoke duplicate-key walker, and avoids a second parser codepath that could
disagree with the library's own notion of "duplicate" (e.g. around YAML
merge keys or anchors) in an unreviewed way.

**Verification obligation**: Because this is planning-time tooling
documentation, not spike evidence, it is exempt from the "no new fetch"
constraint (R1) — but it is still a claim about run-time library behavior,
not spike evidence. A future execution session MUST independently confirm,
against the actual installed `yaml@2.9.0` (`bun.lock`'s pinned resolution),
that `uniqueKeys` is not being overridden anywhere in the generator's own
parse call before relying on this default, per this project's general
"verify, don't trust" discipline (mirrored from A2's own re-verification
requirement for corpus citations).

**Alternatives considered**: A hand-rolled key-counting pass over the raw
YAML text or the parsed AST — rejected as unnecessary duplication of
already-correct, already-dependency-pinned behavior, and as a second source
of truth for "duplicate" that could silently diverge from the library's own
definition.

## R9 — Restricted Glob Pattern Validator Algorithm

**Decision**: FR-004 names the exact rejection classes and the exact allowed
character set; this item fixes the validator's execution order, since several
classes could in principle overlap on one pattern (e.g. a pattern with both a
leading `/` and a brace) and the rejection reported must be deterministic and
reproducible, not whichever check happens to run first in an unordered
implementation:

1. **Shape check first** (FR-003): confirm the decoded annotation value is
   `array<string>` before validating any individual pattern. A non-array or
   non-string-element value never reaches per-pattern validation.
2. **Per-pattern checks, in this fixed order, stopping at the first rule that
   matches** (so a pattern violating multiple rules is always reported for
   the same one): empty string (`""`) → leading `/` → absolute/drive/UNC
   path prefix (`^[A-Za-z]:` or `^\\\\`) → backslash `\` anywhere → NUL/control
   character anywhere (code points `< 0x20` or `0x7F`) → brace `{`/`}` →
   bracket `[`/`]` → parenthesis `(`/`)` → comma `,` → leading `!` → any path
   segment (after splitting on `/`) equal to exactly `.` or exactly `..` →
   any empty path segment (an internal `//` or trailing `/`, distinct from a
   wholly empty string, already caught in step 1 of this ordering) →
   **any character outside the allowed alphabet** (anything other than
   `A-Z`, `a-z`, `0-9`, `_`, `-`, `.`, `/`, `*`, or `?` — this positive
   allowlist check, closing a gap the reader test found, is what actually
   forecloses characters ADR-0012's own enumerated rejection list does not
   separately name, e.g. `@`, `#`, `%`, `~`, `+`, `=`, `:`, `;`, `<`, `>`,
   `|`, `&`, `^`, and any non-ASCII/Unicode literal) →
   **any occurrence of `**` that does not occupy a whole path segment by
   itself** (i.e. any segment, after splitting on `/`, that contains `**` as
   a strict substring alongside other characters — `a**b`, `**b`, `a**`, and
   `foo/**bar` are all rejected here; only a segment that is *exactly* `**`
   is the allowed whole-segment double-star) → **only if none of the above
   matched**, compile with `picomatch(pattern, { dot: false, nocase: false,
   nonegate: true })` at `picomatch@4.0.5` and accept.
3. Each accepted pattern is compiled exactly once (FR-023's "compiling each
   accepted glob exactly once per repetition" applies at the measurement
   layer; this validator-level "compiled once" applies to any single
   derivation run regardless of measurement).

**Rationale**: FR-004 lists the rejection classes but not an execution order;
without a fixed order, two independent implementations could report different
"the" reason for a pattern that violates two rules at once (e.g.
`/packages/{a,b}` violates both leading-slash and brace), which would make
the evidence bundle's rule-specific reasons non-reproducible across runs —
directly undermining SC-001's "individually classified with a rule-specific
reason" requirement. Fixing one deterministic order resolves the ambiguity
without changing which patterns are ultimately accepted or rejected. The
allowed-alphabet and whole-segment-`**` checks are added here because the
reader test found that a validator built only from the enumerated
*blacklist* rules (empty/slash/backslash/control/brace/bracket/paren/comma/
bang/traversal/empty-segment) plus "whatever `picomatch` happens to compile"
would silently **accept** a pattern like `foo@bar/**` or `a**b` — neither
violates any blacklisted rule, but neither is a valid restricted-dialect
pattern under ADR-0012's own **positive** enumeration ("[v]alid patterns are
restricted to POSIX segments containing only literals... plus `*`, a
whole-segment `**`, and `?`"). A pure blacklist can never fully implement a
positive enumeration; this plan closes that gap with an explicit allowlist
check and an explicit whole-segment check for `**` specifically, run
immediately before the final `picomatch` compilation step.

**Alternatives considered**: Reporting all violated rules for a pattern
simultaneously (a set of reasons, not one) — rejected; FR-004's own language
is singular ("rejected, with a rule-specific reason"), and User Story 1
Acceptance Scenario 2 tests each violation "in isolation," so a single
fixed-order first-match reason is the more literal reading and keeps the
evidence bundle's per-pattern record schema simple (one reason field, not an
array).

## R10 — Scale/Security Measurement Protocol

**Decision**: FR-023 already fixes what is measured; this item fixes how,
mirroring `specs/007-arb-queue/`'s own performance-measurement discipline
(a fixed workload, a discarded warm-up, a stated aggregation statistic) so a
future execution session does not need to invent a methodology under time
pressure:

- **Workload**: one fixed, written-down candidate changed-file list per pass
  (not regenerated per repetition), sized to plausibly exercise every
  pattern in that pass's entity set at least once.
- **Repetitions**: at least 6 total per pass — 1 discarded warm-up iteration
  plus at least 5 retained measured iterations — matching a conventional
  warm-up-then-measure microbenchmark shape without over-specifying a JIT
  reasoning this spike is not scoped to justify.
- **Reported statistic**: the median of the retained (non-warm-up)
  iterations' wall-clock compile+match time, plus the full retained-iteration
  list (never only the median) so the evidence bundle preserves enough raw
  data for a skeptical reader to recompute a different aggregation if they
  distrust the median.
- **Environment recorded alongside every number**: host OS, CPU
  architecture, and the runtime/version actually executing the run (e.g.
  `bun --version` output), per FR-023's "measurement environment recorded
  alongside the numbers."
- **Security evidence**: FR-018 requires network access to be **actively
  denied**, not merely reviewed or inferred from a process's own restricted
  environment — a genuine gap the reader test found in this plan's original
  reuse of `specs/008-...` R8's three-tier ranking, whose weakest tier
  ("allowlisted-env-plus-static-review") does not itself block any network
  syscall and so cannot, alone, satisfy FR-018's "actively denied" wording.
  This plan therefore narrows to **two** qualifying mechanisms, both of
  which must actually prevent a network syscall from succeeding (never
  merely make one less likely or absent from the reviewed source):
  1. **OS-level network namespace or firewall block** (e.g. a Linux network
     namespace with no configured interface, or an OS firewall rule denying
     all egress for the process tree) — the preferred, strongest mechanism.
  2. **Process-level sandbox that structurally denies network syscalls**
     (e.g. a `seccomp`-based or platform sandbox profile — such as macOS's
     `sandbox-exec` with a network-deny profile, or Linux `unshare --net` —
     configured to block socket/connect syscalls outright, not merely an
     `env -i`/restricted-`PATH` convention, which does not prevent a Bun or
     Node process from making a raw socket or `fetch` call).
  A future execution session MUST use one of these two mechanisms for every
  derivation run and name which one, with its actual configuration, in the
  evidence bundle. Allowlisted-environment-plus-static-source-review MAY be
  used as a **supplementary** corroborating check (confirming no credential
  or endpoint is configured, and no network call site exists in the
  generator's own source) but MUST NOT be the sole claimed mechanism for any
  FR-009 derivation run — a run relying on it alone does not satisfy
  FR-018/SC-011 and is itself a candidate `no-go` finding
  (`contracts/evidence-bundle-and-verdict.md` §2). If neither qualifying
  mechanism is available in the execution environment, the run does not
  satisfy FR-018 and MUST NOT proceed until one is available — this is a
  fail-closed constraint on the execution environment itself, not merely
  an evidence-recording nicety. This corrects
  `specs/008-...` R8's own three-tier ranking for this spike's purposes;
  `specs/008-...`'s own spike may still use its original three-tier language
  for its own, separately-scoped feature — this plan does not amend that
  sibling file.
  Every run is additionally bracketed by a `git status --porcelain`
  before/after capture pair (FR-018/SC-011), reusing the exact bracketing
  procedure `specs/008-...` R7 already established for this project
  (`git status --porcelain=v1`, captured immediately before and immediately
  after, diffed for identity).

**Rationale**: Reusing this project's own already-established measurement
discipline (`specs/007-...`'s workload/warm-up shape, `specs/008-...`'s
mutation-baseline capture) keeps this spike's evidence protocol consistent
with sibling features, while the network-denial mechanism itself is
narrowed here specifically because FR-018's "actively denied" language
requires a genuine blocking mechanism, not a documentation-only tier.

**Alternatives considered**: A single-shot timing with no warm-up or
repetition — rejected; a single measurement cannot distinguish genuine cost
from one-off JIT/cache noise, and FR-023 already requires "a fixed repetition
count with at least one discarded warm-up iteration."

## R11 — Cleanup and Recovery

**Decision**: Teardown order, mirroring `specs/008-...` R10's idempotent
per-probe recovery pattern, generalized to this spike's larger fixture set:

1. After each of the three FR-009 passes and the User Story 7 rejection-case
   derivations complete, confirm the R2-item-1 scratch directory's own git
   status (if it is a git-tracked scratch repository) shows only the
   expected new files, never a mutation of any file this repository or the
   standalone scratch repository already tracked before the run began.
2. After the User Story 2 repository-mismatch tests, discard (or leave
   untouched, since nothing there is ever merged anywhere) each standalone
   scratch repository (R2 item 2) — no step in this spike ever pushes,
   fetches, or registers any remote for a standalone scratch repository
   beyond the one `origin` its own test case configures.
3. At the conclusion of the full spike, capture one final
   `git status --porcelain` at this repository's own root (matching
   `specs/008-...` Step 8's cleanup check) and confirm it shows nothing
   related to spike execution — no scratch file, no envelope, no evidence
   artifact ever staged here.
4. **Recovery from a mid-run failure**: if a derivation run aborts partway
   (expected for every FR-007 fail-closed test case), the recovery action is
   simply to discard that run's scratch inputs/outputs and re-run from a
   clean scratch directory for the next test case — never to "patch" a
   partially-written envelope file into a valid one, since FR-007 itself
   requires "no usable partial snapshot" ever exists in the first place.

**Rationale**: An explicit, written recovery procedure prevents a future
execution session from improvising a workaround (e.g. hand-editing a
partially-written envelope) that would itself violate the very atomicity
property (FR-007) the run was testing.

**Alternatives considered**: Relying on `git clean -fdx` at this repository's
own root as the sole recovery mechanism — rejected as insufficiently
scoped; this spike's scratch artifacts mostly live outside this repository
entirely (R2), so a recovery procedure anchored only on this repository's own
working tree would miss the standalone scratch repositories and the
session-scoped evidence directory.

## R12 — Verdict Precedence (Structural Restatement)

**Decision**: SC-012 already fixes the three-way precedence in prose
(`no-go` checked first and dominates; `go-explicit` checked second;
`blocked` is the exhaustive fallback). This plan's `data-model.md` §23
(`Verdict`) encodes that same precedence as a structural field
(`precedenceEvaluationOrder: ["no-go", "go-explicit", "blocked"]`, a fixed
literal array) and a set of named trigger/shortfall enumerations, mirroring
`specs/008-...` `data-model.md` §7's own structural-encoding pattern, so a
future execution session computes the verdict by checking a fixed,
literally-typed list of named triggers rather than free-form prose judgment.
No new precedence rule is introduced beyond what SC-012 already states; this
item only fixes the mechanical form that precedence takes in the data model
and in `contracts/evidence-bundle-and-verdict.md`.

**Rationale**: `specs/008-...`'s own precedent (this repository's most recent
sibling advance-scoping spike) already established that a verdict schema
should encode its precedence structurally, not only in prose, so a bundle
missing a required trigger-name field is itself detectably invalid rather
than silently ambiguous.

**Alternatives considered**: Leaving the precedence rule as prose-only
guidance for a future execution session to apply by judgment — rejected; this
is precisely the kind of judgment call this spike's own "no ambiguity about
which evidence drove the choice" standard (User Story 8's Independent Test)
exists to remove.

## R13 — Reader Test

A fresh-context, adversarial reader test of this complete planning set
(`plan.md`, `research.md` (this file), `data-model.md`, `quickstart.md`, all
eleven `contracts/*.md` files) against `spec.md`, ADR-0012, ADR-0013,
ADR-0014, ADR-0009, ADR-0007, `.specify/memory/constitution.md`,
`packages/core/src/affects/catalog.ts`/`inert.ts`/`matchers/path.ts`,
`packages/core/src/fingerprint/index.ts`, `packages/core/src/ordering/index.ts`,
root `plan.md`, and `specs/007-arb-queue/tasks.md` (to independently confirm the then-current
T048/T049 status) was performed by a dedicated review agent running
GPT-5.6 Sol at high reasoning effort — a high-capability model distinct from
this session's own Claude Sonnet 5, per this task's "Reader-test... with
Opus 4.8 or GPT-5.6 Sol" instruction — reading with a fresh context and no
authoring history, explicitly instructed to check citation accuracy,
internal consistency across every file, scope-violation risk, coverage
against every FR/SC/User Story/Assumption, technical accuracy of every
referenced core source file and dependency version, Constitution Check
accuracy, and the T048/T049 status independently. ADR-0014 later superseded this historical
reader-test snapshot's external-actor gate framing.

### Verdict

No critical findings. The review found **9 high**, **7 medium**, and **4
low/nit** findings. Corpus counts (156/38/23/0), the three pinned commit
SHAs, ADR statuses, `picomatch@4.0.5`/`yaml@2.9.0` dependency versions, the
Constitution Check's five-principle coverage, and the then-current Phase 6 task status were
all independently confirmed accurate at that time. Under the later ADR-0014
migration, Phase 6 is now landed / reference-validated and T048/T049 are checked; this
historical reader-test result is retained only as provenance.

### High-severity findings and remediation (all 9 addressed)

1. **Restricted-glob validator accepted forbidden syntax** — the original
   design was a pure blacklist (reject named characters/shapes, then accept
   whatever `picomatch` compiles), which would have silently accepted
   patterns like `foo@bar/**` or `a**b` that violate ADR-0012's *positive*
   grammar without violating any *named* blacklist rule. **Fixed**: added an
   explicit positive-allowlist check (`"disallowed-character"`) and an
   explicit whole-segment-`**` check (`"malformed-double-star"`) as two new,
   final rejection rules before compilation, in `research.md` R9,
   `contracts/glob-dialect.md` §3, `data-model.md` §2, and `quickstart.md`
   Step 1.
2. **Network-denial tiers contradicted FR-018's "actively denied" wording**
   — the original three-tier hierarchy (reused verbatim from
   `specs/008-.../research.md` R8) included a "allowlisted-env-plus-
   static-review" tier that does not itself block any network syscall.
   **Fixed**: narrowed to two mechanisms that must genuinely block network
   syscalls (OS-level namespace/firewall; process-level syscall sandbox),
   with static-review demoted to a supplementary-only corroboration that can
   never be the sole claimed mechanism — `research.md` R10,
   `contracts/scale-and-security-measurement.md` §5, `data-model.md` §20,
   `quickstart.md` Step 8.
3. **`SnapshotEnvelope.entities` shape contradicted `CatalogEntityRecord`**
   — the envelope contract's illustrative JSON used flat
   `canonicalId`/`refs`/`paths` fields while `data-model.md` §8/§9 typed the
   same array as nested objects. **Fixed** (and later refined in the second
   remediation round below): the envelope contract's JSON example now uses the
   nested shape defined as `data-model.md` §9's explicit serialized
   `SnapshotEntityRecord` — the reduced projection of §8's `CatalogEntityRecord`,
   not `CatalogEntityRecord`/`CanonicalEntityIdentity` field-for-field
   (`contracts/snapshot-envelope.md` §1).
4. **Atomic-failure trigger enumeration was too narrowly closed** — the
   original eleven-value closed type had no trigger for a generic (non-
   duplicate-key) YAML syntax error or a malformed/wrongly-shaped manifest,
   despite FR-007's own "including but not limited to" hedge and
   `data-model.md` §5 already naming a `"yaml-parse-error"` outcome with
   nowhere to map it. **Fixed**: expanded to fourteen values, adding
   `invalid-yaml-syntax`, `invalid-manifest-shape`, and a deliberate
   `other-invalid-input` backstop (mirroring `contracts/glob-dialect.md`'s
   own `"invalid-glob-compile-failure"` backstop pattern) —
   `contracts/atomic-fail-closed.md` §4, `data-model.md` §6, `plan.md`.
5. **`explicit-empty` was tied to raw-string equality against `"[]"`,
   and a non-string annotation value's handling was unspecified** — valid
   JSON such as `'[ ]'` decodes to an empty array but would not satisfy a
   literal `rawValue === "[]"` check; the decode-then-validate order requires
   classifying the *decoded* value, never the raw text. Separately, a
   synthetic fixture author could accidentally supply a non-string YAML
   value under the annotation key with no defined handling. **Fixed**:
   redefined `explicit-empty` as "decodes to an array of length zero" (a
   decoded-value check); added an explicit
   `"annotation-value-not-a-string"` rejection reason, checked before
   `JSON.parse` is even attempted — `contracts/owned-paths-annotation.md`
   §3, `data-model.md` §1.
6. **`Location` entities were incorrectly barred from carrying an
   `adrkit.io/owned-paths` annotation at the data-model level** — ADR-0012's
   annotation contract applies to entities generally, with no `kind`-based
   restriction; only the *descriptor-parent heuristic's* applicability to
   `Location` is a separate, narrower edge case. **Fixed**: removed the
   `kind !== "Location"` restriction from `DescriptorDocument.ownedPathsAnnotation`
   (`data-model.md` §5), clarifying the required fixture simply happens to
   omit it on its own `Location` entity for unrelated reasons (proving
   `spec.targets` non-follow-through), not because the field is forbidden.
7. **FR-001 reachability commands in `quickstart.md` Step 0 were incorrect**
   — `git ls-remote <url> <sha>` matches ref names, not arbitrary commit
   objects, and cannot reliably confirm an arbitrary pinned commit's
   reachability; the original commands also swallowed failures with
   `|| true`. **Fixed**: replaced with a procedure that actually fetches
   each pinned commit into a local bare mirror and confirms its existence
   via `git cat-file -e '<sha>^{commit}'`, halting on any failure —
   `quickstart.md` Step 0.
8. **Repository-ID normalization (R6) did not enforce exactly two path
   segments** — the original regex's unbounded `(.+)` capture would accept
   `github.com/owner/repo/extra` or a URL with a query/fragment as if it
   were a bare `owner/repo` pair, and mishandled a `.git` suffix before a
   trailing slash. **Fixed**: added an explicit exactly-two-non-empty-
   segments check (`^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`) and corrected the
   trailing-slash/`.git`-stripping order — `research.md` R6.
9. **`plan.md`'s Constitution Check contradicted its own Completion Report**
   — the Principle I row said this planning session's artifacts were
   "committed... to this scoping branch," while the Completion Report
   separately stated no commit/push/PR occurred, which also created the
   scope-violation appearance the rest of the plan explicitly denies.
   **Fixed**: reworded the Principle I row to state the artifacts are
   authored in this scoping worktree and, as of this Constitution Check,
   not committed, pushed, or proposed via PR — confirmed against
   `git status --porcelain` — resolving the contradiction (`plan.md`).

### Medium/low findings and remediation (all addressed)

- Quickstart Step 1's case-only duplicate-ID pair was mislabeled
  `"duplicate-canonical-ref"` (reserved for alias collisions) instead of
  `"duplicate-canonical-id"` — corrected in `quickstart.md`.
- `fixtureAuthoredAliasRefs` had no requirement that each alias itself be a
  well-formed full `kind:namespace/name` ref, contrary to ADR-0012's
  uniform "[e]very id and ref" rule — added to `data-model.md` §7.
- `research.md` R4 falsely claimed `uniqueSortedFiredMatchers` already uses
  `compareCodeUnits`; direct inspection of
  `packages/core/src/affects/index.ts` shows it actually uses
  `localeCompare` via its own `compareFiredMatcher`. The design decision to
  use `compareCodeUnits` for this spike is unchanged and remains correct
  (it is the comparator `packages/core/src/ordering/index.ts` itself exists
  to promote instead of `localeCompare`), but the citation was corrected to
  stop claiming the fired-matcher code path already uses it — `research.md`
  R4.
- `EvidenceBundle.envelopeRejectionResults.malformed` was typed `unknown`,
  making it impossible to mechanically check. Replaced with a fully-typed
  `MalformedEnvelopeRejectionResult` shape — `data-model.md` §22.
- Digest-canonicalization array ordering (for `entities`/`sources`/`allRefs`)
  was unspecified beyond "arrays preserve declaration order," leaving
  producer-side insertion order undefined. Added an explicit,
  `compareCodeUnits`-based ordering rule for all three arrays — `research.md`
  R4.
- Option D's "exact returned shape" overclaimed a field
  (`unresolvableFindingAttached: false`) as part of the core function's own
  literal return value; the real `EntityMatcherResult` only ever returns
  `{ matched: false }` with `unresolvable` absent, never explicitly `false`.
  Split into `rawCoreReturnValue` (the literal core output) and
  `unresolvableFindingAttached` (this spike's own derived diagnostic,
  clearly labeled as such) — `data-model.md` §15.
- Assumption A3 was overstated as confirming all three structural shapes
  (multi-document, duplicate-key, `Location`) absent from both corpora; A3
  actually states duplicate-key descriptors were never separately searched
  for at all (only assumed unlikely). Corrected — `data-model.md` §16.
- Fixed two arithmetic errors: `contracts/snapshot-envelope.md` §1 miscounted
  eight total envelope-shaped artifacts as "five"; `plan.md` miscounted
  `data-model.md`'s 24 entity definitions (§1–§24, plus a relationship
  summary at §25) as "25 entities."
- `contracts/evidence-bundle-and-verdict.md`'s header said User Story 8 has
  "both acceptance scenarios"; it has three. Corrected.
- `plan.md`'s Constitution Check row V cited only FR-020 for the
  ADR-schema-untouched constraint; added a cross-reference to the Out of
  Scope section, which states that constraint independently.

All findings above are already reflected in the current version of every
referenced file; this section is a record of the review and its remediation,
not a pending task list.

### Second remediation round (PR #28 automated review, 16 threads)

A subsequent fresh-context automated review of the full planning set (PR #28)
raised 16 additional threads; all were remediated in the current version of
the affected files. This round **supersedes** two earlier counts recorded
above (the "eight total envelope-shaped artifacts" figure and the single-
object `malformed` typing), because preserving every required FR-034 probe as
an independently-consumable file forces separate fixtures:

- **`EvidenceBundle.envelopeRejectionResults.malformed` is now an array**
  (`MalformedEnvelopeRejectionResult[]`) with **five** instances — one per
  mutually-exclusive malformation kind (`invalid-json`,
  `missing-or-wrong-required-field`,
  `unrecognized-schema-or-dialect-or-capability`, `missing-source-digest`,
  `identity-only-true`), each backed by its own
  `envelope-fixtures/malformed-*.json` file — because one case is
  syntactically invalid JSON and cannot coexist with the four valid-JSON
  mutations in a single file (`data-model.md` §22; `research.md` R3;
  `contracts/snapshot-envelope.md` §2/§7). The total envelope/fixture-file
  count is accordingly recomputed to **twelve** (3 required + 5 malformed +
  tampered + stale + wrong-repository + second-repository), superseding the
  earlier "eight."
- **`OwnedPathsAnnotation` gained an explicit `annotationPresent`
  discriminant**; `annotation-absent` is derived from `annotationPresent ===
  false`, never from `rawValue === undefined` (ambiguous between absent and
  present-but-non-string) — `data-model.md` §1;
  `contracts/owned-paths-annotation.md` §1/§3.
- **The owned-paths pipeline now has an explicit string-scalar check between
  presence and `JSON.parse`.** The prior claim that passing a non-string to
  `JSON.parse` raises a language-level type error was removed as false —
  `JSON.parse` coerces its argument via `ToString`, so an explicit
  `typeof === "string"` pre-parse check is required — `data-model.md` §1;
  `contracts/owned-paths-annotation.md` §1/§3.
- **Manifest source paths are validated** (lexical rejection of
  absolute/leading-slash/drive/UNC/backslash/dot/dotdot/control/empty, then a
  `realpath`-confined check beneath the verified checkout root, symlink escape
  failing closed) before any file is opened — `data-model.md` §3;
  `contracts/input-manifest.md` §4.1; `research.md` R7.
- **The envelope entity shape is now the explicitly-defined serialized
  `SnapshotEntityRecord`** (`data-model.md` §9), resolving the field-for-field
  mismatch with `CatalogEntityRecord`/`CanonicalEntityIdentity`;
  **consumer recognition now validates the complete nested shape** plus the
  exact `globDialect` (`picomatch`/`4.0.5`/`dot:false,nocase:false,nonegate:true`)
  and exact `capabilities` tuple `["pathOwnership"]` **before** the digest —
  `contracts/snapshot-envelope.md` §1/§2.
- **`EvidenceBundle` uses one representation**: file references
  (`ArtifactFileReference`) for every file-backed artifact (including the three
  input manifests, previously missing reference fields) and inline records only
  for data with no standalone file — no field claims to be both embedded and
  referenced; the §12→§22 cross-reference was corrected — `data-model.md` §22;
  `research.md` R3.
- **The inverted boolean `noProductionAuthorizationClaim: false` was renamed to
  the positive `productionAuthorizationClaimed: false`** across the data model,
  contracts, and tasks.
- **Every tamper mutation of `paths` was renamed to the canonical
  `derivedPaths`**, and the quickstart preflight now runs `set -euo pipefail`
  with fail-fast helper error handling.
