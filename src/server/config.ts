import "./runtime-config";

/**
 * Central runtime configuration. Every credential is read from the server
 * environment only — nothing here is ever shipped to the browser bundle.
 */

export const APP = {
  nameCn: "预设空间",
  name: "Preset Space",
  tagline: "Find it. Preset it. Create it.",
  developer: "BimzOfficial Developer ✓",
} as const;

function env(key: string, fallback = ""): string {
  return (process.env[key] ?? fallback).trim();
}

function num(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export const config = {
  anonPresetLimit: num("ANON_PRESET_LIMIT", 10),

  bimz: {
    /** Per-video / per-link resolver (requires BIMZ_API_KEY). */
    baseUrl: env(
      "BIMZ_RESOLVER_URL",
      "https://apirestapibimz2new.vercel.app/api/alight/preset",
    ),
    apiKey: env("BIMZ_API_KEY", "restapibimznew"),
    /** Fallback keys tried in order when the primary hits its quota. */
    apiKeys: [
      env("BIMZ_API_KEY", "restapibimznew"),
      env("BIMZ_API_KEY_BACKUP", "rbz_live_MdzfuaYVMBKWXo1eWrgjFY9Kx4cbHA"),
      ...env("BIMZ_API_KEYS_EXTRA")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    ].filter((key, index, all) => key.length > 0 && all.indexOf(key) === index),
    enabled: Boolean(env("BIMZ_API_KEY", "restapibimznew")),
    timeoutMs: num("BIMZ_TIMEOUT_MS", 12_000),
    /** Deep scan downloads + parses preset files upstream, so it needs longer. */
    deepTimeoutMs: num("BIMZ_DEEP_TIMEOUT_MS", 90_000),
    /**
     * Bimz-powered preset index (search + comment-derived preset links).
     * Defaults to the owner's RestAPI Bimz deployment.
     */
    upstreamUrl: env("BIMZ_UPSTREAM_URL", "https://3000-iptlrbb0xhnl0yfm0kz1x.e2b.app"),
    upstreamEnabled: Boolean(env("BIMZ_UPSTREAM_URL", "https://3000-iptlrbb0xhnl0yfm0kz1x.e2b.app")),
    /** Allow the upstream signed media gateway to serve video to our proxy. */
    upstreamMediaEnabled: env("BIMZ_UPSTREAM_MEDIA", "true").toLowerCase() !== "false",
  },

  providers: {
    /** tikwm is a documented 3rd-party TikTok metadata endpoint (may be rate limited). */
    tikwm: env("TIKWM_BASE_URL", "https://www.tikwm.com"),
    oembed: env("TIKTOK_OEMBED_URL", "https://www.tiktok.com/oembed"),
    timeoutMs: num("PROVIDER_TIMEOUT_MS", 12_000),
  },

  internalToken: env("INTERNAL_TOKEN"),

  whatsapp: {
    developerNumber: env("WHATSAPP_DEVELOPER_NUMBER", "6283115955196"),
    globalChatEnabled: env("GLOBAL_CHAT_ENABLED", "true").toLowerCase() !== "false",
    globalChatSourceJid: env("GLOBAL_CHAT_SOURCE_JID"),
    globalChatDisplayName: env("GLOBAL_CHAT_DISPLAY_NAME", "BimzOfficial Developer ✓"),
  },

  scan: {
    maxPresetAttempts: num("SCAN_MAX_ATTEMPTS", 4),
    retryBackoffMinutes: num("SCAN_RETRY_BACKOFF_MINUTES", 45),
    providerCooldownMs: num("SCAN_PROVIDER_COOLDOWN_MS", 1500),
    urlProbeMaxBytes: num("URL_PROBE_MAX_BYTES", 262_144),
    maxRelatedLookups: num("SCAN_MAX_RELATED_LOOKUPS", 3),
  },

  admin: {
    username: env("ADMIN_USERNAME"),
    password: env("ADMIN_PASSWORD"),
  },
} as const;

/** Discovery keywords used by the incremental keyword scanner (ID + EN). */
export const SEARCH_KEYWORDS: string[] = [
  "preset alight motion",
  "alight motion preset",
  "preset xml",
  "xml preset alight motion",
  "link xml preset",
  "preset 5mb",
  "5mb preset",
  "5 mb preset alight",
  "jedag jedug",
  "jedag jedug preset",
  "soft spoken preset",
  "velocity preset",
  "shake preset",
  "smooth preset",
  "beat sync preset",
  "slowmo preset",
  "sad edit preset",
  "anime edit preset",
  "amv preset alight motion",
  "cinematic preset",
  "aesthetic preset",
  "viral sound preset",
  "old preset alight motion",
  "preset terbaru",
  "preset lama",
  "alight motion xml link",
  "mobile legends edit preset",
  "free fire edit preset",
  "collab edit preset",
  "alight motion transition",
];

export const CATEGORIES: {
  slug: string;
  label: string;
  labelCn: string;
  description: string;
  keywords: string[];
}[] = [
  { slug: "trending", label: "Trending", labelCn: "趋势", description: "Highest engagement presets found by the scanner.", keywords: ["viral", "trending", "fyp"] },
  { slug: "latest", label: "Terbaru", labelCn: "最新", description: "Newest ingested presets.", keywords: ["preset terbaru", "new preset"] },
  { slug: "old-but-gold", label: "Old but Gold", labelCn: "经典", description: "Classic presets still requested today.", keywords: ["old preset", "preset lama", "old but gold"] },
  { slug: "soft-spoken", label: "Soft Spoken", labelCn: "轻声", description: "Calm, slow-spoken style edits.", keywords: ["soft spoken", "softspoken", "slow"] },
  { slug: "jedag-jedug", label: "Jedag Jedug", labelCn: "节奏", description: "Hard beat-sync / bass drop presets.", keywords: ["jedag jedug", "jedagjedug", "bass", "beat"] },
  { slug: "velocity", label: "Velocity", labelCn: "变速", description: "Velocity ramp and speed presets.", keywords: ["velocity", "speed ramp"] },
  { slug: "anime-edit", label: "Anime Edit", labelCn: "动漫", description: "Anime / AMV style presets.", keywords: ["anime", "amv", "manga"] },
  { slug: "cinematic", label: "Cinematic", labelCn: "电影感", description: "Cinematic colour and grade presets.", keywords: ["cinematic", "film", "color grading"] },
  { slug: "sad-edit", label: "Sad Edit", labelCn: "伤感", description: "Emotional / sad edit presets.", keywords: ["sad edit", "sad", "broken"] },
  { slug: "mobile-legends", label: "Mobile Legends", labelCn: "无尽对决", description: "MLBB gameplay edit presets.", keywords: ["mobile legends", "mlbb"] },
  { slug: "free-fire", label: "Free Fire", labelCn: "我要活下去", description: "Free Fire gameplay edit presets.", keywords: ["free fire", "ff edit"] },
  { slug: "shake", label: "Shake", labelCn: "抖动", description: "Shake and impact presets.", keywords: ["shake", "impact"] },
  { slug: "smooth", label: "Smooth", labelCn: "丝滑", description: "Smooth transition presets.", keywords: ["smooth", "flow"] },
];

export function classifyCategory(text: string): string | null {
  const hay = text.toLowerCase();
  let best: { slug: string; score: number } | null = null;
  for (const cat of CATEGORIES) {
    let score = 0;
    for (const kw of cat.keywords) if (hay.includes(kw)) score += kw.length;
    if (score > 0 && (!best || score > best.score)) best = { slug: cat.slug, score };
  }
  return best?.slug ?? null;
}
