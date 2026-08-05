# `corpus/` — the vendored ADR-0020 clause-5 accept corpus

The 24 descriptor files the clause-5 accept-corpus freeze selects, vendored
**verbatim** from `github.com/backstage/community-plugins` at commit
`92e9e4e09c76cc57f3475029b73e5ec84498a459`.

Acquired once, by `scripts/vendor-accept-corpus.ts`. `VENDOR-MANIFEST.json`
records what was fetched and how it was checked.

## These files are pristine upstream bytes

**There is no `adrkit.io/owned-paths` annotation anywhere in this directory, and
there must never be one.**

ADR-0020 clause 5 requires the accept corpus's descriptors be "authored upstream
and **otherwise unmodified**". That is provable by digest only if what is on disk
is byte-identical to what upstream published. The maintainer-authored overlay
lives in `../evidence/accept-corpus-freeze/overlay.json` and is applied by
`scripts/compare-accept-corpus.ts` at generation time, into a temporary directory
that is deleted when the run ends.

Keeping the two apart is not a style preference. `../data-model.md` §10's
`provenance` field exists precisely to make the upstream/maintainer boundary
legible; a pre-merged file would destroy it, because no reader could tell by
inspection which bytes are upstream and which are ours. The freeze already
separates them, and this preserves that separation on disk.

`scripts/vendor-accept-corpus.test.ts` asserts it, file by file.

## How the pin was checked

The freeze records no per-descriptor digest — its only recorded hashes are the two
artifact-level `contentHash` values (`../evidence/README.md` §3). What it does fix
is a **commit pin**, and a git commit names exactly one tree, which names exactly
one blob per path, and a blob id is a content-addressed digest of that blob's
bytes. Three checks follow, and all three abort rather than warn:

1. The recursive tree listing at the pin was **not truncated**, so "not found"
   cannot be confused with "not fetched".
2. The pin yields exactly **156** blobs whose basename is exactly
   `catalog-info.yaml`, matching the freeze's own
   `corpusFacts.descriptorFilesExactBasename`. A pin that moved changes this
   number.
3. For every vendored file, the git blob id was **recomputed from the bytes that
   arrived** and matched against the id the pinned tree records.

Three numbers that are easy to conflate, each read from
`../evidence/accept-corpus-freeze/accept-corpus-freeze.json` → `corpusFacts`:

| Number | What it counts |
| --- | --- |
| **156** | descriptor **files** at the pin whose basename is exactly `catalog-info.yaml` |
| **167** | entity **documents** in those files — a file may hold several |
| **24** | documents selected into the frozen corpus, from 24 distinct files |

A file count and a document count are different things. The 24 vendored files hold
more than 24 entity documents, and the comparison harness accounts for the
difference explicitly rather than assuming it away.

## Re-acquiring

```bash
bun run scripts/vendor-accept-corpus.ts
```

This is a **one-time acquisition step**, not part of a generation run. Generation
requires no network, no credential, and no service (FR-018, FR-052), and this
script is not reachable from the generator or from the comparison harness —
asserted by `scripts/vendor-accept-corpus.test.ts` rather than promised here.

Re-running it over an unchanged pin rewrites the same bytes. If the pin has moved,
it aborts and writes nothing; that is a finding to investigate, not a state to
refresh past.

## Standing constraints

Only the corpus **data** here is third-party. The overlay, the expected paths, the
audit, and every check are the maintainer's own. Per ADR-0014's honesty rules none
of this may be described as external, third-party, or community validation, and
vendoring corpus data is acquisition rather than validation. ADR-0014 **rung 1**
only.
