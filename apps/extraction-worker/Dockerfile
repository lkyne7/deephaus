# Standalone worker for durable hybrid PDF extraction.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.5.4 prune @deephaus/extraction-worker --docker

FROM base AS build
COPY --from=prune /repo/out/json/ .
COPY --from=prune /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
COPY --from=prune /repo/tsconfig.base.json ./tsconfig.base.json
RUN pnpm turbo run build --filter=@deephaus/extraction-worker

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/extraction-worker
COPY --from=build /repo /repo
CMD ["node", "dist/index.js"]
