# 预设空间 | Preset Space — Setup & Operations

> Find it. Preset it. Create it. — Developer **BimzOfficial ✓**

Full-stack Next.js (App Router) + PostgreSQL (Drizzle ORM) application with a real
TikTok metadata scanner, permanent preset storage, Instagram-style video feed,
floating Global Chat, review → WhatsApp PNG notifications, and an admin console.

---

## 1. Stack as actually implemented

| Requirement | Implementation |
| --- | --- |
| Frontend | Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4 |
| Backend | Next.js Route Handlers (`src/app/api/**`) on the Node runtime |
| Database | PostgreSQL (Neon in production / local `app_db` in the sandbox) via Drizzle ORM |
| Auth | scrypt password hashing + DB-backed sessions in an httpOnly cookie |
| Realtime | Server-Sent Events (`/api/chat/stream`) with automatic polling fallback |
| Background work | `server/workers/*` long-running Node processes (PM2) — **not** serverless |
| PWA | `src/app/manifest.ts`, `public/sw.js`, install prompt, offline fallback |

The project was rebuilt from zero; nothing was carried over from an older codebase.

---

## 2. Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL connection (Neon: `postgresql://…?sslmode=require`) |
| `NEON_DATABASE_URL` | recommended | Neon PostgreSQL URL; takes precedence over `DATABASE_URL` |
| `UPLOAD_DIR` | optional | Directory on a persistent mounted volume for uploaded video files (default: `/data/uploads` when `/data` exists; otherwise `public/uploads`) |
| `INTERNAL_TOKEN` | ✅ (bot) | Shared secret for `/api/internal/whatsapp` (server-to-server) |
| `ANON_PRESET_LIMIT` | optional | Anonymous preset cap (default `10`, enforced server-side) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | optional | The first account registered with `ADMIN_USERNAME` becomes admin |
| `TIKWM_BASE_URL` | optional | 3rd-party TikTok metadata provider (default `https://www.tikwm.com`) |
| `TIKTOK_OEMBED_URL` | optional | Official TikTok oEmbed endpoint |
| `BIMZ_RESOLVER_URL` | optional | Bimz Preset Link Resolver endpoint |
| `BIMZ_API_KEY` | ⚠️ | Required by the Bimz resolver — without it the resolver returns `MISSING_API_KEY` |
| `WHATSAPP_DEVELOPER_NUMBER` | ✅ (bot) | `6283115955196` |
| `GLOBAL_CHAT_ENABLED` | optional | `true` by default |
| `GLOBAL_CHAT_SOURCE_JID` | recommended | e.g. `6283115955196@s.whatsapp.net` |
| `GLOBAL_CHAT_DISPLAY_NAME` | optional | `BimzOfficial ✓` |
| `WHATSAPP_BOT_PHONE` | worker only | Number to pair (E.164, no `+`) |
| `APP_URL` | worker only | Base URL of the website |

No secret is ever imported into a client component; only `NEXT_PUBLIC_*` values
would be exposed and none are used.

User-uploaded preset records and XML/5MB links are saved transactionally in PostgreSQL.
For uploaded video files to survive redeploys, mount persistent storage and set
`UPLOAD_DIR` to that mount (or provide a persistent `/data` volume). Without a mounted
volume, the local `public/uploads` fallback may be ephemeral on serverless hosts.

---

## 3. Run locally

```bash
npm install
npx drizzle-kit push          # create/patch all tables
npm run build && npm start    # http://localhost:3000
```

Optional: create the full-text search index (nice for large datasets):

```bash
psql "$DATABASE_URL" -c "create index if not exists presets_caption_fts on presets using gin (to_tsvector('simple', coalesce(caption,'')));"
```

---

## 4. WhatsApp worker (SPACEPRS)

`server/workers/whatsapp-bot.mjs` is a **persistent** process. It must run on a
host that allows long-lived sockets (VPS/Ubuntu + PM2, Fly.io, Render worker,
Railway…). Never deploy Baileys inside a Vercel function.

```bash
# Ubuntu 22.04 (persistent host)
export APP_URL=https://your-site.example
export INTERNAL_TOKEN=xxxxxxxx
export WHATSAPP_BOT_PHONE=6283115955196
export GLOBAL_CHAT_SOURCE_JID=6283115955196@s.whatsapp.net
pm2 start ecosystem.config.cjs && pm2 save && pm2 logs spaceprs-whatsapp
```

On the first start the worker prints a **pairing code** (WhatsApp → Linked
devices → Link with phone number instead) and also publishes it to the admin
dashboard through `/api/internal/whatsapp`.

What the worker does — nothing else:

1. Listens to `messages.upsert`; only the configured developer JID is forwarded
   into `global_chat_messages` (deduplicated by WhatsApp message id). Users'
   private messages are never published.
2. Polls `whatsapp_delivery_logs` every 15 s, downloads the rendered review PNG
   from `/api/reviews/:id/image`, sends it to the developer number, and reports
   `sent` / `failed` back.

---

## 5. Scanner pipeline

`src/server/services/preset-scanner` flow (see `preset-store.ts → scanPreset`):

| Stage | What happens |
| --- | --- |
| A | `tiktok-providers.ts` fetches oEmbed (official) + tikwm metadata |
| B | `captionAnalyzer` extracts trigger words, hashtags and every real URL |
| C | `commentAnalyzer` analyses comments **only if a provider supplies them**, else `COMMENTS_UNAVAILABLE` |
| D | related keyword search + `bimzLinkResolver` (fallback source, capped) |
| E | `urlValidator` probes with `Range: bytes=0-1023`, SSRF guard, no large downloads |

Confidence is evidence-based (`.xml` extension, URL bound to `XML`/`5MB`,
file-hosting domain, source type) and every attempt is written to
`scan_attempts`. `presets.overall_status` ∈ `NEW, SCANNING, PARTIAL, XML_FOUND,
FIVE_MB_FOUND, COMPLETE, RETRY_PENDING, SOURCE_UNAVAILABLE, FAILED`.

Nothing is ever invented: no fake XML/5MB URLs, no fake play counts, no fake
"online" bot status. Unknown values render as "belum ditemukan".

---

## 6. Tests

```bash
APP_URL=http://localhost:3000 node --test tests/smoke.test.mjs
```

Covers: DB health, anon 10-preset cap, auth round-trip, review storage + real
PNG render, chat history dedupe, internal-token auth, scanner provider truth,
SSRF rejection.

---

## 7. Deployment notes

* **Vercel** — deploy the Next.js app as usual; set all env vars; use Neon
  `DATABASE_URL`. Run `npx drizzle-kit push` against production once.
* **WhatsApp worker** — deploy separately on a persistent host and point
  `APP_URL` at the Vercel domain.
* The admin dashboard reads live status from `bot_runtime`; a stale heartbeat is
  reported as **offline**, never as connected.

## Riset otomatis (auto-scan)

Server menjalankan riset sendiri di background (tanpa cron). Preset baru langsung masuk database dan muncul di beranda.

| Env | Default | Fungsi |
| --- | --- | --- |
| `AUTO_SCAN_ENABLED` | `true` | `false` untuk mematikan |
| `AUTO_SCAN_INTERVAL_MIN` | `30` | jeda antar putaran (menit, min 5) |
| `AUTO_SCAN_QUERIES` | `40` | jumlah query per putaran |
| `AUTO_SCAN_DEEP` | `10` | jumlah preset yang di-deep-scan per putaran |


## Neon database deployment (required)

Set `NEON_DATABASE_URL` in the deployment platform's environment variables to the current Neon connection string (prefer the Neon pooled connection string for runtime). Do not commit the URL to source control. The deployment startup runs `drizzle-kit push` before starting Next.js; a migration failure stops startup instead of silently serving an app with missing tables. For a reviewed schema change that explicitly requires accepting data-loss prompts, set `DRIZZLE_PUSH_FORCE=1` only after backing up the database. Check `/api/health` after deploy to confirm database connectivity and schema readiness.

If a database password was ever pasted into a chat, issue a new password/connection string in Neon and update the deployment variable before redeploying.
