# Security Policy

adrkit is early software, but security reports are taken seriously. Thank you
for helping keep the project and its users safe.

## Supported versions

Security fixes ship against the latest published minor. Older versions are not
patched in place; upgrade to the newest `0.x` release to receive fixes.

| Version | Supported |
|---------|-----------|
| 0.10.x  | ✅        |
| < 0.10  | ❌        |

Until adrkit reaches `1.0.0`, minor releases may include breaking changes, so
prefer the newest release line.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub Security Advisories:

1. Go to the [Security tab](https://github.com/mbeacom/adrkit/security/advisories)
   of the repository.
2. Click **Report a vulnerability** to open a private advisory.

This routes the report privately to the maintainer. If private reporting is not
available to you, email [m@beacom.dev](mailto:m@beacom.dev) instead.

Please include:

- The affected package(s) and version(s).
- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.

## What to expect

- **Acknowledgement** of your report as soon as reasonably possible.
- An assessment and, where warranted, a coordinated fix and release.
- Credit for the report, unless you prefer to remain anonymous.

## Scope

adrkit is deliberately narrow. Match resolution is a pure function, and the
local CLI and MCP surfaces make no network or model calls. Nothing requires
credentials to **build**, and the local tools (`adr`, `@adrkit/mcp`,
`@adrkit/core`, `@adrkit/evaluator`) require none to **run**.

The shipped GitHub Actions are the exception because their job is to write back
to GitHub. The governing-decisions Action needs `pull-requests: write` to
comment, and the queue Action needs `issues: write` to maintain its managed
issue. Both accept the workflow's default `GITHUB_TOKEN`; neither requires a
personal token.

Reports about this trust boundary are especially helpful. Examples include a
path-containment escape in the MCP server, the CLI reading outside its corpus
directory, or an Action using its token beyond the scope documented in its
`action.yml`.
