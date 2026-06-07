# Standalone worker for large Anki (.apkg) imports.
# Build from repo root: docker build -f apps/anki-worker/Dockerfile .
#
# Uses turbo prune so Render only installs/builds the worker dependency subtree
# (not the Next.js web app, mobile app, tesseract, etc.).

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# --- Prune monorepo to worker + its workspace deps -------------------------
FROM base AS prune
COPY . .
# turbo is a root devDependency; node_modules is .dockerignored, so fetch it for prune only.
RUN pnpm dlx turbo@2.5.4 prune @deephaus/anki-worker --docker

# --- Install + build ---------------------------------------------------------
FROM base AS build
COPY --from=prune /repo/out/json/ .
COPY --from=prune /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
# turbo prune omits the shared base tsconfig; packages extend ../../tsconfig.base.json
COPY --from=prune /repo/tsconfig.base.json ./tsconfig.base.json
RUN pnpm turbo run build --filter=@deephaus/anki-worker

# --- Runtime -----------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/anki-worker

# Pruned install + compiled dist; workspace packages are linked under node_modules.
COPY --from=build /repo /repo

CMD ["node", "dist/index.js"]
