# Contract: Single-Repository Input Manifest, Identity/Revision Checks, Source Digests, and Completeness Boundary

**Feature**: `009-catalog-binding-viability` | **Freezes**: FR-009, FR-010,
FR-033, User Story 2 (all 5 acceptance scenarios), User Story 5 Acceptance
Scenario 3, SC-003. Companion to `data-model.md` §3 (`InputManifest`), §4
(`RepositoryIdentityCheck`), `research.md` R5, R6, R7. Normative source:
ADR-0012 "Repository boundary" and "Composition, envelope, and persistence."

## 1. Manifest Shape (Closed Schema)

```json
{
  "manifestSchemaVersion": "1",
  "requestedSnapshotSchemaVersion": "1",
  "requiredCapabilities": ["pathOwnership"],
  "repository": {
    "id": "github.com/mbeacom/adrkit-spike-fixture",
    "revision": "0000000000000000000000000000000000000000"
  },
  "sources": [
    {
      "path": "catalog-info.yaml",
      "digestAlgorithm": "sha256",
      "digest": "<64 lowercase hex chars>"
    }
  ]
}
```

Every field is exactly as `data-model.md` §3 types it. **The schema is
closed**: an unrecognized top-level field anywhere in the manifest JSON is
itself an "unsupported manifest version"-class rejection (`research.md` R5)
— never silently ignored as a forward-compatible passthrough field.

## 2. The Three Manifest-Level Version/Capability Rejections (FR-033)

All three are properties of the **manifest/generation request as a whole**,
never of an individual entity within a batch (User Story 2, Acceptance
Scenario 4) — each aborts generation, non-zero, **before any entity's paths
are derived**:

| Field | Only accepted value(s) | Rejection reason if violated |
|---|---|---|
| `manifestSchemaVersion` | exactly `"1"` | "unsupported manifest version" |
| `requestedSnapshotSchemaVersion` | exactly `"1"` (matching `SnapshotEnvelope.schemaVersion`) | "unsupported snapshot version" |
| `requiredCapabilities` | array whose only defined member is exactly `"pathOwnership"` | "unsupported capability" (triggered by any string other than `"pathOwnership"` appearing in the array) |

## 3. Repository Identity/Revision Verification (FR-009)

Repository identity and revision are supplied **only** by the manifest —
**never** inferred from any descriptor annotation, including
`github.com/project-slug` (which User Story 3 independently found unreliable
for exactly this purpose — see `contracts/structural-fixtures-and-corpora.md`
§4). Verification procedure, mirroring `research.md` R6's exact normalization
algorithm:

1. Read the checkout's actual `git remote get-url origin` and
   `git rev-parse HEAD` via **separate git tooling** — never by re-reading
   the manifest file under test.
2. Normalize the raw remote URL via `research.md` R6's algorithm to
   lowercase `github.com/<owner>/<repo>` form (or `"invalid"` if it matches
   no recognized form).
3. Compare: `manifest.repository.id === normalizedActualId` **and**
   `manifest.repository.revision === actualHead`, both as exact string
   equality.
4. Any outcome other than both-match aborts generation **before any entity's
   paths are derived** (FR-007) — including a partial match (e.g. revision
   matches but repository ID does not).

**This check is bounded by FR-018's offline constraint**: it confirms the
manifest agrees with the checkout's own locally-configured git state, never
with a live, network-verified GitHub repository. A stronger,
network-verified provenance check is explicitly out of scope for this
offline spike (FR-009) and left to any later production feature.

### 3.1. Test Fixture Requirement: Standalone Scratch Repository, Never a Linked Worktree

Because a `git worktree add` linked worktree shares its remote configuration
with the repository it was created from, a linked worktree of *this actual
repository* cannot be independently varied to test a mismatch (its `origin`
would always report `github.com/mbeacom/adrkit`). User Story 2's
repository-mismatch test therefore uses a **standalone scratch git
repository** (`data-model.md` §19; `research.md` R2 item 2) — a fresh,
disposable `git init`'d directory with its own `git remote add origin
<url>` and its own commits, entirely separate from this repository's own
`.git`. The manifest-vs-checkout comparison in §3 above is always against
that standalone repository's own separately-read `origin`/`HEAD`, never
against a value asserted only in the manifest itself, and never satisfiable
by running inside a linked worktree of this actual repository.

## 4. Source Digests and "Incomplete Required Source" (FR-009)

Every `sources[]` entry's `digest` is the expected SHA-256 hex digest of that
file's raw bytes, computed at manifest-authoring time. At generation time,
each listed file is read, its actual digest independently recomputed, and
compared. A **mismatch**, or a manifest-listed path **absent from the actual
fixture set on disk**, is an "incomplete required source" rejection (User
Story 2, Acceptance Scenario 4) — a property of the manifest/generation
request, aborting before any entity's paths are derived, never a per-entity
skip.

## 5. Input Boundary — What Generation May Read (`research.md` R7)

A single generation invocation reads **only**: the manifest file itself;
each descriptor file path the manifest's `sources` array lists (digest-
verified before trust, §4); and the two git-identity values in §3, via
subprocess. It **never**:

- Follows a `Location` entity's `spec.targets` reference to read a file not
  itself listed in the manifest (FR-010; see
  `contracts/structural-fixtures-and-corpora.md` §3 for the required
  synthetic fixture proving this).
- Invokes any catalog processor or plugin of any kind.
- Recursively walks or glob-expands the repository's directory tree to
  "discover" descriptor files — even ones that would trivially match a
  typical `catalog-info.yaml` naming convention.
- Claims or implies whole-catalog completeness — `SnapshotEnvelope.completeness.wholeCatalog`
  (`data-model.md` §9) is always `false` for every envelope this spike
  produces.

## 6. Worked Example — the `Location`-Not-Followed Case (User Story 5, Acceptance Scenario 3)

Given a synthetic `Location` entity whose `spec.targets` names a second
fixture file that is **not itself listed** in the manifest's `sources` array:
generation, using only the manifest-listed files, derives **zero** paths for
the target file's `Component` entity — not because its annotation was
invalid (it is never read at all), but because the generator never opens a
file outside the manifest to find it. The evidence bundle records this
distinction explicitly as `"zero-derived-paths-never-read"`
(`data-model.md` §16), never as `"invalid-input"`.
