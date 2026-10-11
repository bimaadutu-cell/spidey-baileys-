# Railway / VPS — full Next.js + optional in-process Baileys worker
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=optional

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN test -f src/components/shell.tsx && test -f src/app/layout.tsx
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Baileys session persistence
ENV WA_SESSION_DIR=/data/.spaceprs-session
RUN mkdir -p /data/.spaceprs-session
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# keep session dir writable
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
