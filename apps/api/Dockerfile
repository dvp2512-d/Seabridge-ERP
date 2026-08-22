# Production Dockerfile for the API
#
# Debian "slim" is used rather than Alpine on purpose: Prisma's query engine is
# a native binary that needs OpenSSL, and on Alpine (musl) it fails at runtime
# with "Unable to require libquery_engine-linux-musl.so.node". Debian + openssl
# is detected automatically by Prisma and needs no binaryTargets configuration.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# openssl is required by the Prisma engine; ca-certificates for HTTPS fetches.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first so dependency installation is cached
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/database/package*.json ./packages/database/

RUN npm install

# Copy source
COPY packages/database ./packages/database
COPY apps/api ./apps/api

# Generate the Prisma client, then compile the database package.
# The API imports @seabridge/database, whose "main"/"types" point at dist/,
# so this build step must run before the API is compiled.
WORKDIR /app/packages/database
RUN npx prisma generate
RUN npm run build

# Build API
WORKDIR /app/apps/api
RUN npm run build

# ---------- Runtime image ----------
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# The Prisma engine needs OpenSSL at runtime too, not just at build time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# node_modules carries the generated Prisma client
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package*.json ./apps/api/

WORKDIR /app/apps/api

EXPOSE 4000

CMD ["node", "dist/index.js"]
