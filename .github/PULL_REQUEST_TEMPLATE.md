<!--
Thanks for contributing to adrkit! Keep the description focused on the "why".
New to the project? See the "Your first PR" section in CONTRIBUTING.md.
-->

## What and why

<!-- What does this change, and what problem does it solve? -->

## Checklist

- [ ] Commits are **DCO signed off** (`git commit -s`). No CLA is required.
- [ ] If this changes a recorded decision in `docs/adr/`, an ADR is **added or
      supersedes** the affected record — with the argument, not just a status flip.
- [ ] If the schema changed, I edited the Zod source
      `packages/core/src/schema/adr.schema.ts` (not the root re-export), re-ran
      `bun run schema:emit`, and committed the generated `schema/adr.schema.json`.
- [ ] If `packages/ci/src` **or** `@adrkit/core` changed, I regenerated
      `packages/ci/dist` under **linux/amd64 bun 1.3.14** and committed it
      (see CONTRIBUTING.md — a Mac-built bundle fails the diff gate).
- [ ] New or changed behavior is covered by tests, and each test was **observed
      failing before it passed** — a check that never failed is not coverage
      ([ADR-0016](docs/adr/0016-require-every-check-to-be-observed-failing-before-it-counts-as-coverage.md)).
- [ ] `bun run typecheck && bun run build && bun test && bun run lint` pass from a
      clean clone with no credentials configured
      ([ADR-0007](docs/adr/0007-adapter-isolation-and-public-surface-build.md)).

## Notes for reviewers

<!-- Anything you are unsure about, trade-offs made, or follow-ups deferred. -->
