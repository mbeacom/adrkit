# Security Policy

adrkit is early software, but security reports are taken seriously. Thank you for
helping keep the project and its users safe.

## Supported versions

Security fixes are released against the latest published minor. Older versions
are not patched in place; upgrade to the latest `0.x` release to receive fixes.

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅        |
| < 0.2   | ❌        |

Until adrkit reaches `1.0.0`, minor releases may include breaking changes
([ADR-0002](docs/adr/0002-typed-frontmatter-as-madr-superset.md)); prefer the
newest release.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub Security Advisories:

1. Go to the [Security tab](https://github.com/mbeacom/adrkit/security/advisories)
   of the repository.
2. Click **Report a vulnerability** to open a private advisory.

This routes the report privately to the maintainer. If private reporting is
unavailable to you, email [m@beacom.dev](mailto:m@beacom.dev) instead.

Please include:

- The affected package(s) and version(s).
- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.

## What to expect

- **Acknowledgement** of your report as soon as reasonably possible.
- An assessment and, where warranted, a coordinated fix and release.
- Credit for the report, unless you prefer to remain anonymous.

## Scope

adrkit is deliberately narrow: match resolution is a pure function, and the MCP
server and CLI make no network or model calls. Nothing requires credentials to
**build**, and the local tools (`adr`, `@adrkit/mcp`, `@adrkit/core`,
`@adrkit/evaluator`) require none to **run**
([ADR-0007](docs/adr/0007-adapter-isolation-and-public-surface-build.md)).

The two shipped GitHub Actions are the deliberate exception, because their whole
job is to write back to GitHub: the governing-decisions Action fails without a
token (`packages/ci/src/index.ts`) and needs `pull-requests: write` to comment,
and the queue Action needs `issues: write` to maintain its managed issue. Both
accept the workflow's default `GITHUB_TOKEN`; neither asks for a personal token.

Reports that concern this trust boundary — for example, a path-containment escape
in the MCP server, the CLI reading outside its corpus directory, or an Action
using its token beyond the scope documented in its `action.yml` — are especially
valuable.
