# Book Time With — production image (Coolify deploys this).
# Next.js standalone output. Durable state lives in PostgreSQL via DATABASE_URL.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# standalone server (traced node_modules included) + static assets
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Startup migration runner and generated SQL. The entrypoint finishes these
# under a PostgreSQL advisory lock before the HTTP server can accept traffic.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
# Next's standalone trace includes the pg driver through the application, but
# the separately executed migration CLI also needs Drizzle's package root.
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

RUN chown -R node:node /app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["sh", "/app/scripts/docker-entrypoint.sh"]
