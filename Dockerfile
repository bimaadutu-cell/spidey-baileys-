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
# Debug: show what was actually uploaded (helps if Git/Railway root is wrong)
RUN echo "=== source tree ===" && find src -type f | head -80 && echo "=== end ==="
RUN test -f src/app/layout.tsx && test -f src/app/shell.tsx && test -f src/app/perf.tsx
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV WA_SESSION_DIR=/data/.spaceprs-session
RUN mkdir -p /data/.spaceprs-session /app/public
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
