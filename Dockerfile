FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl tini \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.13.0 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder

COPY . .

ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV DATABASE_URL=$DATABASE_URL

RUN pnpm db:generate && pnpm build

FROM base AS runner

ENV NODE_ENV=production

COPY --chown=node:node --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/.next ./.next
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node --from=builder /app/ops ./ops
# The seed and the password rescue run inside this image with plain `node`, so
# the plain-ESM helpers they import have to be here: without this copy the boot
# command dies with ERR_MODULE_NOT_FOUND between migrating and serving.
COPY --chown=node:node --from=builder /app/scripts/lib ./scripts/lib
# The password rescue, and nothing else from scripts/: the rest of that
# directory is workstation tooling (icon generation, the i18n inventory) that
# would only be dead weight here. Named file by file so that adding another
# development script does not quietly enlarge the image.
COPY --chown=node:node --from=builder /app/scripts/auth-password.mjs ./scripts/auth-password.mjs
# The `.env.local` loader prisma/seed.ts imports. One file, not the whole of
# src/: the runner has no bundler and no path aliases, so anything copied here
# has to be importable by plain `node` with a relative specifier.
COPY --chown=node:node --from=builder /app/src/entorno.ts ./src/entorno.ts

EXPOSE 3004

ENTRYPOINT ["tini", "-g", "--"]

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "/app/ops/healthcheck.mjs"]

# Shoppa is the sole migration owner of its database. A failed migration must
# prevent the new application version from accepting data.
#
# The seed goes between migrating and serving: it needs the schema the migration
# has just applied, and a fresh installation must never be served empty. It runs
# as TypeScript directly, because there is no build step that would produce a
# seed.js and inventing one would be a second way to get this wrong. On an
# installation that is already seeded it is a
# single SELECT.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON prisma/seed.ts && exec node node_modules/next/dist/bin/next start -p 3004"]
