/**
 * Baked-in runtime defaults.
 *
 * The hosting platform rewrites `.env` on every build, which previously wiped
 * the Neon connection string and the RestAPI Bimz keys. Real environment
 * variables ALWAYS win; these values only fill the gaps so the deployed app
 * keeps working after a platform-side reset.
 *
 * On Vercel set the same keys in Project → Settings → Environment Variables
 * and these defaults are simply ignored.
 */

type Defaults = Record<string, string>;

const DEFAULTS: Defaults = {
  NEON_DATABASE_URL:
    "postgresql://neondb_owner:npg_eduq7oWQNpU5@ep-red-sun-b5lmeoxx-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  INTERNAL_TOKEN: "spaceprs-internal-9f2c41a7b8d3e650",
  ANON_PRESET_LIMIT: "10",
  ADMIN_USERNAME: "bimzadmin",
  ADMIN_PASSWORD: "admin009",
  TIKWM_BASE_URL: "https://www.tikwm.com",
  TIKTOK_OEMBED_URL: "https://www.tiktok.com/oembed",
  PROVIDER_TIMEOUT_MS: "30000",
  BIMZ_API_KEY: "restapibimznew",
  BIMZ_API_KEY_BACKUP: "rbz_live_MdzfuaYVMBKWXo1eWrgjFY9Kx4cbHA",
  BIMZ_UPSTREAM_URL: "https://3000-iptlrbb0xhnl0yfm0kz1x.e2b.app",
  BIMZ_UPSTREAM_MEDIA: "true",
  BIMZ_RESOLVER_URL: "https://apirestapibimz2new.vercel.app/api/alight/preset",
  BIMZ_AM_URL: "https://apirestapibimz2new.vercel.app/api/am",
  BIMZ_TIMEOUT_MS: "20000",
  BIMZ_DEEP_TIMEOUT_MS: "90000",
  DEEP_SCAN_PACE_MS: "1500",
  PREMIUM_REQUIRED_REVIEWS: "3",
  WHATSAPP_DEVELOPER_NUMBER: "6283115955196",
  GLOBAL_CHAT_ENABLED: "true",
  GLOBAL_CHAT_DISPLAY_NAME: "BimzOfficial Developer ✓",
  WA_SESSION_DIR: "./.spaceprs-session",
};

/** A platform-injected local Postgres URL must not shadow the real database. */
function isPlaceholderDatabaseUrl(value: string | undefined): boolean {
  if (!value) return true;
  return /127\.0\.0\.1|localhost/.test(value);
}

let applied = false;

export function applyRuntimeDefaults(): void {
  if (applied) return;
  applied = true;

  for (const [key, value] of Object.entries(DEFAULTS)) {
    const current = process.env[key];
    if (current === undefined || current.trim() === "") {
      process.env[key] = value;
    }
  }

  // If only a placeholder DATABASE_URL exists, point it at the real database.
  if (isPlaceholderDatabaseUrl(process.env.DATABASE_URL) && process.env.NEON_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
  }
}

applyRuntimeDefaults();
