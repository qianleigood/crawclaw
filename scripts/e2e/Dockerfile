# syntax=docker/dockerfile:1.7

FROM node:24-bookworm@sha256:3a09aa6354567619221ef6c45a5051b671f953f0a1924d1f819ffb236e520e6b

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable

RUN useradd --create-home --shell /bin/bash appuser \
 && mkdir -p /app \
 && chown appuser:appuser /app

ENV HOME="/home/appuser"
ENV NODE_OPTIONS="--disable-warning=ExperimentalWarning"

USER appuser
WORKDIR /app

COPY --chown=appuser:appuser package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=appuser:appuser extensions ./extensions
COPY --chown=appuser:appuser patches ./patches
COPY --chown=appuser:appuser scripts/postinstall-bundled-plugins.mjs scripts/install-plugin-runtimes.mjs scripts/npm-runner.mjs ./scripts/

RUN --mount=type=cache,id=crawclaw-pnpm-store,target=/home/appuser/.local/share/pnpm/store,sharing=locked \
    CRAWCLAW_DISABLE_RUNTIME_POSTINSTALL=1 \
    pnpm install --frozen-lockfile

COPY --chown=appuser:appuser tsconfig.json tsconfig.plugin-sdk.dts.json tsdown.config.ts vitest.config.ts vitest.e2e.config.ts vitest.performance-config.ts crawclaw.mjs ./
COPY --chown=appuser:appuser src ./src
COPY --chown=appuser:appuser test ./test
COPY --chown=appuser:appuser scripts ./scripts
COPY --chown=appuser:appuser docs ./docs
COPY --chown=appuser:appuser packages ./packages
COPY --chown=appuser:appuser skills ./skills
COPY --chown=appuser:appuser extensions ./extensions
COPY --chown=appuser:appuser src/canvas-host/a2ui-src ./src/canvas-host/a2ui-src

RUN pnpm build

CMD ["bash"]
