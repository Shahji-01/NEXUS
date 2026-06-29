# syntax=docker/dockerfile:1
# ============================================================================
# NEXUS — Node app image (Express API + bundled React dashboard)
# Build context: repository ROOT (the API needs the whole pnpm workspace).
#   docker build -f apps/api/Dockerfile -t nexus-app .
# ============================================================================

# ---- Builder: install workspace deps, typecheck, and build api + web -------
FROM node:24-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Pin pnpm to match the workspace toolchain.
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app
COPY . .

# Install all workspace packages (honours pnpm-workspace.yaml + lockfile).
RUN pnpm install --frozen-lockfile

# Typecheck everything, esbuild-bundle the API to dist/index.mjs, and
# vite-build the dashboard to apps/web/dist/public.
RUN pnpm run build

# ---- Runtime: minimal image running the self-contained API bundle ----------
# The esbuild output is fully self-contained (deps bundled), so the runtime
# image needs only the dist artifacts — no node_modules.
FROM node:24-slim AS runtime
ENV NODE_ENV=production
# Default port; override via the PORT env var at deploy time.
ENV PORT=8080

WORKDIR /app/apps/api

# API bundle + pino worker files.
COPY --from=builder /app/apps/api/dist ./dist
# Dashboard SPA assets — the API serves these from ./dist/public (relative to
# its working directory) and falls back to index.html for client-side routes.
COPY --from=builder /app/apps/web/dist/public ./dist/public

EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
