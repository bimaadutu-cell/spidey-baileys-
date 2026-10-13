# Railway — Next.js + Baileys
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN test -f src/app/layout.tsx && test -f src/app/shell.tsx && test -f src/app/perf.tsx
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV WA_SESSION_DIR=/data/.spaceprs-session
RUN mkdir -p /data/.spaceprs-session /app/public/uploads /data/uploads
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
# Everything `drizzle-kit push --force` needs at boot (config + schema + migrations)
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src/db/schema.ts ./src/db/schema.ts
# Env files are copied too so the live watcher can read edits made on a mounted volume
COPY --from=builder /app/env* ./
# drizzle-kit + pg + drizzle-orm for db-push at boot (standalone output does not ship them)
RUN npm install --no-save --no-package-lock --omit=dev pg@8.20.0 drizzle-orm@0.45.2 drizzle-kit@0.31.10
EXPOSE 3000
CMD ["sh", "-c", "node scripts/db-push.mjs; exec node server.js"]
