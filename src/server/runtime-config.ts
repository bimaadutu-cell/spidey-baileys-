/**
 * Non-secret runtime defaults only.
 *
 * Database credentials must be configured in the hosting platform environment;
 * never bake a production connection string into source code or a build artifact.
 */

type Defaults = Record<string, string>;

const DEFAULTS: Defaults = {
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

}

applyRuntimeDefaults();
