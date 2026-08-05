# Contract: Package Boundary

**Feature**: 010-catalog-backstage
**Status**: New in this feature. Spike 009 built no packages, so it has no counterpart.
**Freezes**: where the two new packages live, what each may depend on, the direction of the
edge between them (there is none), what the interface between them actually is, and which
duplication across them is deliberate.
**Normative sources**: Constitution v1.0.2 Principle III; ADR-0007 (independent adapter
versioning); ADR-0013 (no dynamic adapter loader); `spec.md` FR-001 through FR-005 and FR-044;
`data-model.md` cross-cutting ownership table; `research.md` R1 and R7.
**Supersedes**: nothing.

---

## 0. Why this contract exists at all

Spike 009 produced no packages — `contracts/README.md` §2 delta **D2** records that
`composition-and-release-boundary.md` §6's zero-artifact claim is no longer true for this
feature. The spike therefore froze no package placement, no dependency allowlist, and no
inter-package direction. All three have to be frozen here.

The placement question was live enough to have been recorded as an open question in `spec.md`
and resolved by maintainer decision on 2026-08-04 (`checklists/requirements.md` "Notes"). This
contract fixes the resolution so it is not re-opened by drift.

---

## 1. The two packages

| | Generator | Consumer |
| --- | --- | --- |
| Path | `packages/adapters/catalog-backstage/` | `packages/catalog-envelope/` |
| Name | `@adrkit/catalog-backstage` | `@adrkit/catalog-envelope` (working name) |
| Kind | Adapter | Non-adapter workspace library |
| Role | Reads a manifest and descriptor files offline; writes one envelope | Reads an envelope; validates it; derives a snapshot |
| Versioning | Independent of `@adrkit/core` (ADR-0007) | Follows the ordinary workspace convention |

Both paths are already matched by the root `package.json` `workspaces` globs
`["packages/*", "packages/adapters/*"]` (read at the repository root in this worktree).
**No change to `workspaces` is required, and none may be made.** A change there would be a
signal that the placement is wrong.

`@adrkit/catalog-envelope` is a working name. If the maintainer renames it, only this table and
the allowlist entries in §2 change; nothing in §3 through §6 depends on the string.

---

## 2. Dependency allowlists

These are the entries to be added to `allowedDependenciesFor()` in `scripts/check-deps.ts`. They
are the design; they are not yet implemented.

| Package | `dependencies` | `devDependencies` |
| --- | --- | --- |
| `@adrkit/catalog-backstage` | `@adrkit/core`, `picomatch`, `yaml` | `@types/bun`, `@types/picomatch` |
| `@adrkit/catalog-envelope` | `@adrkit/core` | `@types/bun` |

`picomatch` and `yaml` are already present in the committed lockfile — declared at `bun.lock`
lines 47 and 49 and resolved to `picomatch@4.0.5` (line 165) and `yaml@2.9.0` (line 187), all
read in this worktree. Neither package introduces a new registry surface.

### 2.1 Why the generator depends on `@adrkit/core` (decision G1)

`research.md` R7 posed the choice: **G1**, the adapter depends on `@adrkit/core` solely for
canonicalization primitives; or **G2**, the adapter depends on the consumer. R7 adopted G1 as
the working assumption because G2 is directly forbidden by FR-044 while G1 is merely
undesirable.

Two things sharpen that, and neither contradicts R7:

- The generator must emit a `digest` byte-identical to one an independent recomputation
  produces. `research.md` R2 fixes the primitive as `canonicalStringify` from `@adrkit/core`
  (defined `packages/core/src/fingerprint/index.ts:16`, exported `packages/core/src/index.ts:24`,
  ordering via `compareCodeUnits` at `packages/core/src/ordering/index.ts:12`). Re-implementing
  it in the adapter would create a second definition of "canonical" that could drift silently —
  which is the failure the digest exists to detect.
- Constitution Principle III describes adapters as packages that "live under
  `packages/adapters/*`, **depend on the core**, and are permitted to break on upstream churn."
  An adapter depending on core is the Principle's own expected shape, not a carve-out.

**Do not import the same-named `canonicalStringify` from
`packages/evaluator/src/report/serialize.ts:38`.** It is a different function with a different
signature (`(root, pretty = false)`). Importing it would also cross a package boundary the
allowlist in §2 does not permit.

### 2.2 Scope qualification that travels with the digest

For the envelope's closed scalar domain, `canonicalStringify`'s bytes are *equivalent to*
RFC 8785 / JCS output. No document under this feature may claim that `canonicalStringify` is a
general-purpose RFC 8785 implementation. The equivalence is scoped to the domain, and the
qualification is part of the claim, not a footnote to it.

---

## 3. Direction: there is no edge between the two packages

Per `spec.md` FR-044:

- `@adrkit/catalog-backstage` MUST NOT depend on `@adrkit/catalog-envelope`.
- `@adrkit/catalog-envelope` MUST NOT depend on `@adrkit/catalog-backstage`.

**The envelope file on disk is the entire interface.** The generator writes it. The consumer
reads it. Neither package imports a symbol from the other, at build time or at runtime, and
there is no shared internal module between them.

This is what makes the digest and the staleness check meaningful. If the consumer imported the
generator's serializer, a digest check would be comparing the generator against itself and would
detect nothing.

### 3.1 The consumer is a non-adapter by construction

`isAdapterPackage()` (`scripts/check-deps.ts` lines 92–94, read in this worktree) classifies a
package as an adapter purely by whether its path begins with `packages/adapters/`. Because
`packages/catalog-envelope/` does not, the consumer is a non-adapter as a matter of its location,
not as a matter of an allowlisted exception.

Constitution Principle III's `core-has-no-adapter-deps` rule — no package outside
`packages/adapters/**` may depend on an adapter — is therefore satisfied structurally. There is
no entry anywhere granting the consumer permission to be a non-adapter; it simply is one.

---

## 4. How the boundary is actually enforced, and one way it silently is not

The two guards in `scripts/check-deps.ts` that matter here (all line numbers read in this
worktree):

- The guard emitting `non-adapter workspace depends on an adapter package`: a non-adapter workspace declaring a dependency on an adapter is a violation
  with reason `non-adapter workspace depends on an adapter package`.
- The guard emitting `<name> declares a dependency outside its allowed public surface`: a package declaring a dependency outside its allowed public surface is a
  violation with reason `<name> declares a dependency outside its allowed public surface`.

**The trap:** `allowedDependenciesFor()` returns `undefined` for any package it has no entry for
(`allowedDependenciesFor()` returns `undefined`), and the second guard is then skipped entirely. A package with no
allowlist entry is **silently unconstrained** — it passes `check:deps` no matter what it
declares.

Both new packages therefore require explicit entries per §2. Omitting an entry does not produce
a failure; it produces a green check that means nothing. This is the one place where the absence
of a rule is indistinguishable from a satisfied rule, and it must be closed deliberately.

---

## 5. The duplication that is deliberate

Per the cross-cutting ownership table in `data-model.md`, **both packages declare the envelope's
shape independently.** This is the single deliberate duplication in the design.

It is deliberate because a shared type module would be an import edge, and an import edge is
exactly what §3 forbids. If both packages derived their view of the envelope from one
declaration, the consumer could not detect a generator that had changed the shape — the shape
would have changed on both sides at once. Two independent declarations are what make the
consumer's structural validation an actual check rather than a tautology.

The cost is real and is accepted: the two declarations can diverge, and nothing but the
consumer's own validation failing will say so. That failure is the intended signal.

No other duplication across the two packages is sanctioned by this contract.

---

## 6. Independent versioning

`@adrkit/catalog-backstage` versions independently of `@adrkit/core` per ADR-0007: its semver
contract is with the pinned Backstage predicate surface, not with `@adrkit/core`'s API.

The §2.1 dependency on `@adrkit/core` does **not** change that, and the package MUST record so
explicitly. The precedent is the `"//versioning"` note already carried in
`packages/adapters/spec-kit/package.json` (read in this worktree); this package follows the same
form. Without that note, a reader encountering a core dependency would reasonably infer coupled
versioning, and the inference would be wrong.

---

## 7. Out of scope, named so it is not done by accident

Wiring `@adrkit/catalog-envelope` into `@adrkit/cli` (or into `@adrkit/core`) is **not** part of
this feature.

Constitution Principle III permits core and CLI to depend on "their own workspace packages", so
the placement in §1 does not foreclose that wiring later. But doing it here would require
amending `allowedDependenciesFor('@adrkit/cli')`, whose allowlist is currently exactly
`{'@adrkit/core', '@adrkit/evaluator'}` (`scripts/check-deps.ts` lines 107–115, read in this
worktree). **Do not amend it under this feature.**

Also out of scope, and forbidden rather than merely deferred: any dynamic adapter loader or
registry (ADR-0013; `spec.md` FR-002). The generator is invoked directly by name. Constitution
Principle III's phrase "discovery is by runtime configuration" predates ADR-0013; where the two
differ the ADR governs, per the Constitution's own precedence rule.

---

## 8. Observation requirement

Per ADR-0016 and `research.md` R8, each boundary rule lands only by being observed failing
first, then passing:

| Rule | Failing observation to construct |
| --- | --- |
| §3 no consumer → adapter edge | Add the adapter to the consumer's `dependencies`; observe `non-adapter workspace depends on an adapter package`; remove it; observe pass. |
| §3 no adapter → consumer edge | Add the consumer to the adapter's `dependencies`; observe the allowed-public-surface violation; remove it; observe pass. |
| §2 allowlists are present | Confirm each new package has an entry by adding a disallowed dependency and observing a violation. A green `check:deps` on a package with no entry (§4) is not evidence of anything. |

The third row is the one that is easy to skip and the only one that closes the §4 trap.

---

## 9. Standing honesty constraints

Repeated here per `contracts/README.md` §4:

1. **The warrant is a predicate return value**, not the behaviour of Backstage as a system. This
   contract makes no Backstage claim at all.
2. **No unverified counts.** Every line number, path, and version above names the file it was
   read from in this worktree.
3. **No evidence is claimed.** Neither package exists. Every statement above is a requirement on
   work not yet done.
4. **ADR-0014 rung 1 only.** Nothing here is external, third-party, or community validation.
5. **Genuine unknowns are marked.** This contract carries none of its own. The name
   `@adrkit/catalog-envelope` is a working name, not an unknown (§1).


## §5. Citation rule for this contract

Guards in `scripts/check-deps.ts` are cited **by the reason string they emit**, never
by line number. Line numbers drift with any edit above them — feature 010 Phase A's own
allowlist additions shifted both guards by 41 lines, silently invalidating every citation
here and in `tasks.md` — while the reason strings are stable and are already asserted
verbatim by `scripts/check-deps.test.ts`.

A line number is a reference that nothing checks. A reason string is a reference the
test suite checks on every run, so a citation that goes stale fails the build rather
than quietly misleading a reader.

---

## §6. Reading an installed dependency's version — permitted, and why it is not loader behaviour

**Decided by the maintainer, 2026-08-05.**

FR-029 / T063 require the `picomatch` version be **read at runtime from the resolved
dependency, never transcribed**, so that the frozen glob engine recorded in a snapshot is
the engine that actually ran. ADR-0013 and FR-002 separately forbid any dynamic runtime
adapter/plugin loader, and the guard enforcing that
(`packages/adapters/catalog-backstage/test/no-dynamic-loader.test.ts`) bans
`import.meta.resolve` anywhere in the adapter.

Read naively, those two requirements collide.

**They do not.** The permitted implementation is a **filesystem read of the installed
dependency's manifest** — walking up from the module to `node_modules/picomatch/package.json`
and reading its `version` field. This satisfies FR-029 because the value comes from the
installed artifact rather than from a literal in our source, and it does not engage the
loader-guard's concern because it invokes no resolver, imports no module, and cannot load
code.

The distinction the guard protects is **dynamic module loading**, not **filesystem access**:

| | Loads code | Resolver invoked | Permitted |
|---|---|---|---|
| `import.meta.resolve(...)`, dynamic `import()`, `require.resolve` | yes | yes | **no** — ADR-0013, FR-002 |
| Reading `node_modules/<dep>/package.json` as a file | no | no | **yes** — this section |

Recorded here rather than left in a source comment because it looked, to the session that
implemented it, like a route *around* the guard rather than a path *through* it — and a
future reader deciding the same question deserves the reasoning, not an inference from
what happened to be committed.

**The observation still applies.** A test asserting the read value matches the lockfile is
required and must be observed failing (ADR-0016), because a read that silently returns
`undefined` and a read that returns the right version are indistinguishable from a green
suite alone.
