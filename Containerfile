# syntax=docker/dockerfile:1

ARG BUN_VERSION=1.3.14
ARG BUN_DIGEST=sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
ARG NODE_VERSION=24-alpine
ARG NODE_DIGEST=sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS build
WORKDIR /opt/adrkit

COPY package.json bun.lock LICENSE NOTICE ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/evaluator/package.json ./packages/evaluator/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY packages/ci/package.json ./packages/ci/package.json
COPY packages/catalog-envelope/package.json ./packages/catalog-envelope/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/adapters/agent-plugin/package.json ./packages/adapters/agent-plugin/package.json
COPY packages/adapters/catalog-backstage/package.json ./packages/adapters/catalog-backstage/package.json
COPY packages/adapters/spec-kit/package.json ./packages/adapters/spec-kit/package.json
COPY packages/core/src ./packages/core/src
COPY packages/evaluator/src ./packages/evaluator/src
COPY packages/cli/src ./packages/cli/src
COPY packages/mcp/src ./packages/mcp/src
COPY packages/ci/dist ./packages/ci/dist

RUN bun install --frozen-lockfile --production --ignore-scripts
RUN mkdir -p /out \
    && bun build packages/cli/src/index.ts \
      --target=node \
      --conditions bun \
      --outfile=/out/adr.js \
    && bun build packages/mcp/src/bin.ts \
      --target=node \
      --conditions bun \
      --outfile=/out/adrkit-mcp.js

FROM node:${NODE_VERSION}@${NODE_DIGEST} AS runtime
LABEL org.opencontainers.image.title="adrkit" \
      org.opencontainers.image.description="Containerized adrkit CLI, MCP server, and CI entry points" \
      org.opencontainers.image.source="https://github.com/mbeacom/adrkit" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV ADRKIT_HOME=/opt/adrkit
COPY LICENSE NOTICE /usr/share/licenses/adrkit/
RUN mkdir -p /workspace && chown node:node /workspace
WORKDIR /workspace
USER node

FROM runtime AS cli
COPY --from=build --chown=node:node /out/adr.js /opt/adrkit/adr.js
ENTRYPOINT ["node", "/opt/adrkit/adr.js"]
CMD ["--help"]

FROM runtime AS mcp
COPY --from=build --chown=node:node /out/adrkit-mcp.js /opt/adrkit/adrkit-mcp.js
ENTRYPOINT ["node", "/opt/adrkit/adrkit-mcp.js"]

FROM runtime AS ci
COPY --from=build --chown=node:node /opt/adrkit/packages/ci/dist/index.js /opt/adrkit/ci.js
ENTRYPOINT ["node", "/opt/adrkit/ci.js"]

FROM runtime AS queue-action
COPY --from=build --chown=node:node /opt/adrkit/packages/ci/dist/queue-action.js /opt/adrkit/queue-action.js
ENTRYPOINT ["node", "/opt/adrkit/queue-action.js"]

FROM runtime AS adrkit
COPY --from=build --chown=node:node /out/adr.js /opt/adrkit/adr.js
COPY --from=build --chown=node:node /out/adrkit-mcp.js /opt/adrkit/adrkit-mcp.js
COPY --from=build --chown=node:node /opt/adrkit/packages/ci/dist/index.js /opt/adrkit/ci.js
COPY --from=build --chown=node:node /opt/adrkit/packages/ci/dist/queue-action.js /opt/adrkit/queue-action.js
COPY --chmod=0755 scripts/container-entrypoint.sh /usr/local/bin/adrkit-container
ENTRYPOINT ["adrkit-container"]
CMD ["--help"]
