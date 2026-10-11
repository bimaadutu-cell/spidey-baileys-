import { config } from "../config";
import { sanitizeText } from "../http";
import { bimzSearch } from "./bimz-preset-provider";

/* =========================================================================
 * Provider contract
 * =======================================================================*/

export type ProviderVideo = {
  tiktokId: string;
  videoUrl: string;
  caption: string;
  thumbnailUrl?: string | null;
  playableUrl?: string | null;
  playableExpiresAt?: Date | null;
  durationSec?: number | null;
  creatorUniqueId?: string | null;
  creatorName?: string | null;
  creatorAvatar?: string | null;
  soundId?: string | null;
  soundTitle?: string | null;
  soundUrl?: string | null;
  soundAuthor?: string | null;
  publishedAt?: Date | null;
  stats?: { plays?: number | null; likes?: number | null; comments?: number | null; shares?: number | null };
  /** Real TikTok comments when a provider exposes them (never fabricated). */
  comments?: { id?: string; author?: string; text: string }[] | null;
  commentsUnavailableReason?: string;
  /** Preset links already discovered by the provider (e.g. scraped from comments). */
  presetLinks?: import("./bimz-preset-provider").ProviderPresetLink[];
  /** Where the playable URL came from (tiktok-cdn | bimz-gateway | tikwm). */
  playableSource?: string | null;
};

export type ProviderResult = {
  provider: string;
  ok: boolean;
  httpStatus?: number;
  message: string;
  videos: ProviderVideo[];
};

type CacheEntry = { expires: number; value: ProviderResult };
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): ProviderResult | null {
  const hit = cache.get(key);
  if (!hit || hit.expires < Date.now()) return null;
  return hit.value;
}

function cacheSet(key: string, value: ProviderResult, ttlMs: number): void {
  if (cache.size > 400) cache.clear();
  cache.set(key, { expires: Date.now() + ttlMs, value });
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown; raw: string }> {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(config.providers.timeoutMs),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      accept: "application/json, text/plain, */*",
      ...(init?.headers ?? {}),
    },
  });
  const raw = await res.text();
  try {
    return { status: res.status, body: JSON.parse(raw), raw };
  } catch {
    return { status: res.status, body: null, raw };
  }
}

export const TIKTOK_URL_RE = /https?:\/\/(www\.|m\.|vm\.|vt\.)?tiktok\.com\/@?[\w.\-/@]+/i;
export const TIKTOK_ID_RE = /\/video\/(\d{6,})/i;

export function normalizeTikTokUrl(raw: string): { url: string; tiktokId: string | null } | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed) || !/tiktok\.com/i.test(trimmed)) return null;
  const idMatch = trimmed.match(TIKTOK_ID_RE);
  const tiktokId = idMatch ? idMatch[1]! : null;
  if (tiktokId) {
    const handle = trimmed.match(/tiktok\.com\/@([\w.\-]+)/i);
    return {
      url: handle ? `https://www.tiktok.com/@${handle[1]}/video/${tiktokId}` : `https://www.tiktok.com/@/video/${tiktokId}`,
      tiktokId,
    };
  }
  return { url: trimmed, tiktokId: null };
}

/* =========================================================================
 * Provider 1 — TikTok oEmbed (official, public, allowed)
 * =======================================================================*/

type OembedPayload = {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  embed_product_id?: string;
  html?: string;
};

export async function tiktokOembed(videoUrl: string): Promise<ProviderResult> {
  const key = `oembed:${videoUrl}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const { status, body } = await fetchJson(
      `${config.providers.oembed}?url=${encodeURIComponent(videoUrl)}`,
    );
    if (status !== 200 || !body || typeof body !== "object") {
      const result: ProviderResult = {
        provider: "tiktok-oembed",
        ok: false,
        httpStatus: status,
        message: `TikTok oEmbed HTTP ${status}`,
        videos: [],
      };
      cacheSet(key, result, status === 200 ? 300_000 : 60_000);
      return result;
    }
    const payload = body as OembedPayload;
    const handle = payload.author_url?.match(/@([\w.\-]+)/i)?.[1] ?? null;
    const result: ProviderResult = {
      provider: "tiktok-oembed",
      ok: true,
      httpStatus: 200,
      message: "Metadata resmi TikTok oEmbed diperoleh",
      videos: [
        {
          tiktokId: videoUrl.match(TIKTOK_ID_RE)?.[1] ?? "",
          videoUrl,
          caption: sanitizeText(payload.title ?? "", 4000),
          thumbnailUrl: payload.thumbnail_url ?? null,
          creatorUniqueId: handle,
          creatorName: payload.author_name ? sanitizeText(payload.author_name, 120) : null,
          creatorAvatar: null,
          commentsUnavailableReason: "oEmbed tidak menyediakan komentar",
        },
      ],
    };
    cacheSet(key, result, 600_000);
    return result;
  } catch (error) {
    return {
      provider: "tiktok-oembed",
      ok: false,
      message: error instanceof Error ? error.message.slice(0, 180) : "oEmbed gagal",
      videos: [],
    };
  }
}

/* =========================================================================
 * Provider 2 — tikwm metadata (3rd party, documented; may be rate limited)
 * =======================================================================*/

type TikwmData = {
  id?: string;
  title?: string;
  cover?: string;
  origin_cover?: string;
  play?: string;
  wmplay?: string;
  duration?: number;
  create_time?: number;
  author?: { unique_id?: string; nickname?: string; avatar?: string };
  music_info?: { id?: string; title?: string; author?: string; play_url?: string };
  play_count?: number;
  digg_count?: number;
  comment_count?: number;
  share_count?: number;
};

function mapTikwm(data: TikwmData, sourceUrl: string): ProviderVideo | null {
  const id = data.id ?? sourceUrl.match(TIKTOK_ID_RE)?.[1];
  if (!id) return null;
  const handle = data.author?.unique_id ?? sourceUrl.match(/@([\w.\-]+)/i)?.[1] ?? null;
  const playableUrl = data.play ? (data.play.startsWith("http") ? data.play : `https://www.tikwm.com${data.play}`) : null;
  return {
    tiktokId: String(id),
    videoUrl: handle ? `https://www.tiktok.com/@${handle}/video/${id}` : sourceUrl,
    caption: sanitizeText(data.title ?? "", 4000),
    thumbnailUrl: data.origin_cover ?? data.cover ?? null,
    playableUrl,
    // tikwm CDN links are short lived — mark expiry so we refresh instead of serving dead links.
    playableExpiresAt: playableUrl ? new Date(Date.now() + 3 * 3600_000) : null,
    durationSec: typeof data.duration === "number" ? data.duration : null,
    creatorUniqueId: handle,
    creatorName: data.author?.nickname ? sanitizeText(data.author.nickname, 120) : null,
    creatorAvatar: data.author?.avatar ?? null,
    soundId: data.music_info?.id ?? null,
    soundTitle: data.music_info?.title ? sanitizeText(data.music_info.title, 200) : null,
    soundAuthor: data.music_info?.author ? sanitizeText(data.music_info.author, 120) : null,
    soundUrl: data.music_info?.play_url ?? (handle ? `https://www.tiktok.com/music/-${data.music_info?.id ?? ""}` : null),
    publishedAt: data.create_time ? new Date(data.create_time * 1000) : null,
    stats: {
      plays: data.play_count ?? null,
      likes: data.digg_count ?? null,
      comments: data.comment_count ?? null,
      shares: data.share_count ?? null,
    },
    commentsUnavailableReason: "tikwm metadata tidak menyediakan isi komentar",
  };
}

export async function tikwmResolve(videoUrl: string): Promise<ProviderResult> {
  const key = `tikwm:${videoUrl}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const { status, body, raw } = await fetchJson(`${config.providers.tikwm}/api/?url=${encodeURIComponent(videoUrl)}`);
    const payload = body as { code?: number; msg?: string; data?: TikwmData } | null;
    if (status !== 200 || !payload || payload.code !== 0 || !payload.data) {
      const cloudflare = /Just a moment|challenges\.cloudflare/i.test(raw);
      const result: ProviderResult = {
        provider: "tikwm",
        ok: false,
        httpStatus: status,
        message: cloudflare
          ? "tikwm dilindungi Cloudflare challenge"
          : `tikwm HTTP ${status} ${payload?.msg ?? ""}`.trim(),
        videos: [],
      };
      cacheSet(key, result, 120_000);
      return result;
    }
    const video = mapTikwm(payload.data, videoUrl);
    const result: ProviderResult = video
      ? { provider: "tikwm", ok: true, httpStatus: 200, message: "Metadata tikwm diperoleh", videos: [video] }
      : { provider: "tikwm", ok: false, httpStatus: 200, message: "tikwm tidak mengembalikan video valid", videos: [] };
    cacheSet(key, result, 600_000);
    return result;
  } catch (error) {
    return {
      provider: "tikwm",
      ok: false,
      message: error instanceof Error ? error.message.slice(0, 180) : "tikwm gagal",
      videos: [],
    };
  }
}

/* =========================================================================
 * Provider 3 — tikwm keyword search (may be blocked by Cloudflare)
 * =======================================================================*/

export async function tikwmSearch(
  keyword: string,
  count = 12,
): Promise<ProviderResult & { blocked?: boolean }> {
  const key = `tikwm-search:${keyword}:${count}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const { status, raw, body } = await fetchJson(
      `${config.providers.tikwm}/api/feed/search?keywords=${encodeURIComponent(keyword)}&count=${count}`,
    );
    const payload = body as { code?: number; msg?: string; data?: { videos?: TikwmData[] } } | null;
    const cloudflare = /Just a moment|challenges\.cloudflare/i.test(raw);
    if (cloudflare) {
      const result: ProviderResult & { blocked?: boolean } = {
        provider: "tikwm-search",
        ok: false,
        httpStatus: status,
        blocked: true,
        message:
          "tikwm search diblokir Cloudflare challenge — hasil pencarian keyword tidak tersedia dari provider ini.",
        videos: [],
      };
      cacheSet(key, result, 180_000);
      return result;
    }
    if (status !== 200 || !payload || payload.code !== 0) {
      const result: ProviderResult & { blocked?: boolean } = {
        provider: "tikwm-search",
        ok: false,
        httpStatus: status,
        message: `tikwm search HTTP ${status} ${payload?.msg ?? ""}`.trim(),
        videos: [],
      };
      cacheSet(key, result, 120_000);
      return result;
    }
    const videos = (payload.data?.videos ?? [])
      .map((item) => mapTikwm(item, `https://www.tiktok.com/@${item.author?.unique_id ?? "tiktok"}/video/${item.id ?? ""}`))
      .filter((v): v is ProviderVideo => Boolean(v && v.tiktokId));
    const result: ProviderResult & { blocked?: boolean } = {
      provider: "tikwm-search",
      ok: videos.length > 0,
      httpStatus: 200,
      message: videos.length ? `${videos.length} video ditemukan untuk "${keyword}"` : "Tidak ada hasil",
      videos,
    };
    cacheSet(key, result, 300_000);
    return result;
  } catch (error) {
    return {
      provider: "tikwm-search",
      ok: false,
      message: error instanceof Error ? error.message.slice(0, 180) : "tikwm search gagal",
      videos: [],
    };
  }
}

/* =========================================================================
 * Merged metadata fetch (oEmbed + tikwm) for a single video URL
 * =======================================================================*/

export async function fetchVideoMetadata(videoUrl: string): Promise<{
  video: ProviderVideo | null;
  providers: ProviderResult[];
}> {
  const [oembed, tikwm] = await Promise.all([tiktokOembed(videoUrl), tikwmResolve(videoUrl)]);
  const merged: ProviderVideo | null = (() => {
    const base = tikwm.videos[0] ?? oembed.videos[0];
    if (!base) return null;
    const extra = tikwm.videos[0];
    if (!extra) return base;
    return {
      ...base,
      caption: base.caption || extra.caption,
      thumbnailUrl: base.thumbnailUrl ?? extra.thumbnailUrl,
      playableUrl: base.playableUrl ?? extra.playableUrl,
      playableExpiresAt: base.playableExpiresAt ?? extra.playableExpiresAt,
      stats: base.stats ?? extra.stats,
      publishedAt: base.publishedAt ?? extra.publishedAt,
      soundId: base.soundId ?? extra.soundId,
      soundTitle: base.soundTitle ?? extra.soundTitle,
      soundUrl: base.soundUrl ?? extra.soundUrl,
      soundAuthor: base.soundAuthor ?? extra.soundAuthor,
      creatorAvatar: base.creatorAvatar ?? extra.creatorAvatar,
      comments: base.comments ?? extra.comments ?? null,
    };
  })();
  return { video: merged, providers: [oembed, tikwm] };
}

/** Ranked keyword search across every provider that is currently available. */
export async function keywordSearch(keyword: string, count = 12): Promise<{
  videos: ProviderVideo[];
  providers: ProviderResult[];
}> {
  const providers: ProviderResult[] = [];

  // 1. Bimz preset index — purpose-built for Alight Motion preset discovery.
  const bimz = await bimzSearch(keyword, count);
  providers.push(bimz);
  if (bimz.ok && bimz.videos.length > 0) {
    return { videos: rankVideos(dedupeVideos(bimz.videos), keyword), providers };
  }

  // 2. tikwm keyword search (may be blocked by Cloudflare).
  const search = await tikwmSearch(keyword, count);
  providers.push(search);
  if (search.ok && search.videos.length > 0) {
    return { videos: rankVideos(search.videos, keyword), providers };
  }

  return { videos: [], providers };
}

/** Newest presets across the provider chain (Bimz index first). */
export async function latestPresets(count = 24): Promise<{ videos: ProviderVideo[]; providers: ProviderResult[] }> {
  const providers: ProviderResult[] = [];
  const { bimzLatest } = await import("./bimz-preset-provider");
  const bimz = await bimzLatest(count);
  providers.push(bimz);
  if (bimz.ok && bimz.videos.length > 0) {
    return { videos: dedupeVideos(bimz.videos), providers };
  }
  return { videos: [], providers };
}

/** Relevance ranking using real signals only (caption match, engagement). */
export function rankVideos(videos: ProviderVideo[], keyword: string): ProviderVideo[] {
  const terms = keyword.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  return [...videos]
    .map((video) => {
      const hay = `${video.caption} ${video.soundTitle ?? ""} ${video.creatorUniqueId ?? ""}`.toLowerCase();
      let score = 0;
      for (const term of terms) if (hay.includes(term)) score += 12;
      if (/xml|5\s?mb|preset|alight/i.test(hay)) score += 15;
      score += Math.min(20, Math.log10(1 + (video.stats?.likes ?? 0)) * 6);
      return { video, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.video);
}

export function dedupeVideos(videos: ProviderVideo[]): ProviderVideo[] {
  const seen = new Set<string>();
  const out: ProviderVideo[] = [];
  for (const video of videos) {
    if (!video.tiktokId || seen.has(video.tiktokId)) continue;
    seen.add(video.tiktokId);
    out.push(video);
  }
  return out;
}
