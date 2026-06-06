# Standalone worker that processes large Anki (.apkg) imports out-of-band.
# Built from the monorepo root: `docker build -f apps/anki-worker/Dockerfile .`
FROM node:22-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo
COPY . .

# Install everything and build the worker (turbo builds its workspace deps first).
RUN pnpm install --no-frozen-lockfile
RUN pnpm turbo run build --filter=@deephaus/anki-worker

# --- Runtime image ---------------------------------------------------------
FROM node:22-slim AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo
COPY --from=build /repo /repo

WORKDIR /repo/apps/anki-worker
CMD ["node", "dist/index.js"]
