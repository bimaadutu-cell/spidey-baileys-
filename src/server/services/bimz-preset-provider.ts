import { config } from "../config";
import { sanitizeText } from "../http";
import { detectHostLabel } from "./preset-analyzers";
import { TIKTOK_ID_RE, type ProviderResult, type ProviderVideo } from "./tiktok-providers";

/* =========================================================================
 * RestAPI Bimz — Alight Motion preset discovery provider
 * -----------------------------------------------------------------------
 * Two different Bimz services are used, each for the job it was built for:
 *
 *  1. BIMZ_UPSTREAM_URL  (this file) — a Bimz-powered preset index that
 *     returns real TikTok preset videos WITH the preset links scraped from
 *     the video's own comments (xmlFiles[] + packages[]).
 *  2. BIMZ_RESOLVER_URL  (bimzLinkResolver.ts) — the per-video/link resolver
 *     used as a fallback when our own scan comes up empty.
 *
 * Nothing here invents data: whatever the upstream does not return simply
 * stays null and the scanner reports "not found".
 * =======================================================================*/

type UnknownRecord = Record<string, unknown>;

export type ProviderPresetLink = {
  url: string;
  kind: "xml" | "five_mb";
  sourceType: string;
  hostLabel: string;
  confidence: number;
  verified: boolean;
  detail?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

function str(value: unknown, max = 400): string | null {
  if (typeof value !== "string") return null;
  const cleaned = sanitizeText(value, max);
  return cleaned.length > 0 ? cleaned : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** Classifies an Alight Motion / file-hosting URL into xml | five_mb | unknown. */
export function classifyPresetUrl(url: string, hint?: string | null): "xml" | "five_mb" | "unknown" {
  const lower = url.toLowerCase();
  const hintLower = (hint ?? "").toLowerCase();

  if (/alightcreative\.com\/am\/share\//i.test(lower)) {
    // Alight Motion share links are project packages (the "5MB" payload).
    return hintLower.includes("xml") ? "xml" : "five_mb";
  }
  if (/\.xml(\?|$)/i.test(lower) || hintLower.includes("xml")) return "xml";
  if (/5\s?mb/.test(hintLower)) return "five_mb";
  if (/drive\.google|mediafire|dropbox|mega\.nz|terabox|pixeldrain|githubusercontent/.test(lower)) {
    return hintLower.includes("5mb") ? "five_mb" : "unknown";
  }
  return "unknown";
}

/** Confidence: hard evidence only, and upstream claims are capped. */
export function scoreProviderLink(link: {
  url: string;
  kind: "xml" | "five_mb";
  sourceType: string;
  detail?: Record<string, unknown>;
}): ProviderPresetLink {
  const meta = detectHostLabel(link.url);
  let confidence = 0;

  if (/\.xml(\?|$)/i.test(link.url)) confidence += 45;
  if (link.detail?.isAlightXml === true) confidence += 20; // content-inspected by upstream
  if (/alightcreative\.com\/am\/share\//i.test(link.url)) confidence += 35;
  if (/drive\.google|mediafire|dropbox|mega\.nz|terabox|pixeldrain/i.test(link.url)) confidence += 18;
  if (/comment/i.test(link.sourceType)) confidence += 15;
  if (/caption/i.test(link.sourceType)) confidence += 12;
  if (link.detail?.sizeHuman) confidence += 5;

  return {
    url: link.url,
    kind: link.kind,
    sourceType: link.sourceType || "upstream",
    hostLabel: meta.label,
    // Upstream claims never exceed 90: our own validator must confirm reachability.
    confidence: Math.max(0, Math.min(90, confidence)),
    verified: false,
    detail: link.detail,
  };
}

function normalize(raw: UnknownRecord, upstreamBase: string): ProviderVideo | null {
  const tiktokId = str(raw.id, 40) ?? str(raw.videoId, 40);
  const tiktokUrl = str(raw.tiktokUrl ?? raw.videoUrl, 400) ?? "";
  const resolvedId = tiktokId ?? tiktokUrl.match(TIKTOK_ID_RE)?.[1] ?? null;
  if (!resolvedId) return null;

  const caption = str(raw.caption ?? raw.title, 4000) ?? "";
  const username = (str(raw.username, 60) ?? "").replace(/^@/, "").toLowerCase();
  const directVideo = str(raw.playableUrl ?? raw.playUrl, 900);
  const directThumb = str(raw.thumbnailUrl, 900);
  const upstreamVideoPath = typeof raw.videoUrl === "string" && raw.videoUrl.startsWith("/") ? raw.videoUrl : null;
  const upstreamThumbPath = typeof raw.thumbnailUrl === "string" && raw.thumbnailUrl.startsWith("/") ? raw.thumbnailUrl : null;

  // Upstream may hand us its own /api/media proxy paths — resolve them to real URLs.
  // Kept only for diagnostics; never used as a playable source.
  const proxiedVideo = upstreamVideoPath ? `${upstreamBase}${upstreamVideoPath}` : null;
  void proxiedVideo;
  const proxiedThumb = upstreamThumbPath ? `${upstreamBase}${upstreamThumbPath}` : null;

  // Only a *direct* CDN URL is usable as playableUrl. Upstream proxy paths
  // (/api/media?u=...) point at TikTok's signed gateway and cannot be played by
  // a browser, so they are dropped — the media gateway re-resolves live instead.
  const isDirectMedia = (url: string | null | undefined): url is string =>
    typeof url === "string" && /(tiktokcdn|tiktokv|byteoversea|muscdn|akamaized|tikwm)\./i.test(url);

  const presetLinks: ProviderPresetLink[] = [];
  const scan = isRecord(raw.lastScan) ? raw.lastScan : null;

  // 1. explicit fields
  for (const [field, kind] of [
    ["xmlUrl", "xml"],
    ["fiveMbUrl", "five_mb"],
  ] as const) {
    const url = str(raw[field], 900);
    if (!url) continue;
    const source = str(raw[`${kind === "xml" ? "xmlSource" : "fiveMbSource"}`], 40) ?? "upstream";
    const detail = isRecord(raw.lastScan)
      ? {
          ...(kind === "xml" ? { fromXmlFiles: true } : { fromPackages: true }),
          ...(scan && Array.isArray(scan.xmlFiles) && kind === "xml"
            ? (scan.xmlFiles.find((f) => isRecord(f) && str((f as UnknownRecord).sourceUrl, 900) === url) as UnknownRecord | undefined)
            : {}),
        }
      : undefined;
    presetLinks.push(scoreProviderLink({ url, kind, sourceType: source, detail }));
  }

  // 2. xmlFiles[] — real .xml files with host + size
  if (scan && Array.isArray(scan.xmlFiles)) {
    for (const entry of scan.xmlFiles) {
      if (!isRecord(entry)) continue;
      const url = str(entry.downloadUrl ?? entry.sourceUrl, 900);
      if (!url || presetLinks.some((l) => l.url === url)) continue;
      presetLinks.push(
        scoreProviderLink({
          url,
          kind: "xml",
          sourceType: str(entry.foundIn, 30) ?? "comment",
          detail: {
            host: str(entry.host, 40),
            sizeHuman: str(entry.sizeHuman, 30),
            isAlightXml: entry.isAlightXml === true,
          },
        }),
      );
    }
  }

  // 3. packages[] — Alight Motion share packages (the real "5MB" payload)
  if (scan && Array.isArray(scan.packages)) {
    for (const entry of scan.packages) {
      if (!isRecord(entry)) continue;
      const url = str(entry.shareUrl ?? entry.sourceLink, 900);
      if (!url || presetLinks.some((l) => l.url === url)) continue;
      presetLinks.push(
        scoreProviderLink({
          url,
          kind: "five_mb",
          sourceType: str(entry.foundIn, 30) ?? "comment",
          detail: {
            title: str(entry.title, 120),
            sizeHuman: str(entry.sizeHuman, 30),
            openInAlight: str(entry.openInAlight, 900),
            thumbnail: str(entry.thumbnail, 900),
          },
        }),
      );
    }
  }

  const stats = {
    plays: num(raw.plays),
    likes: num(raw.likes),
    comments: num(raw.comments),
    shares: num(raw.shares),
  };

  return {
    tiktokId: resolvedId,
    videoUrl: tiktokUrl || `https://www.tiktok.com/@${username || "tiktok"}/video/${resolvedId}`,
    caption,
    // A relative upstream path (/api/media?u=…) must be resolved against the
    // upstream base before it can be used at all.
    thumbnailUrl: isDirectMedia(directThumb)
      ? directThumb
      : (proxiedThumb ?? (directThumb && /^https?:\/\//i.test(directThumb) ? directThumb : null)),
    // ONLY a direct CDN url may be stored as playable. Another site's
    // /api/media proxy is not usable: chaining proxies caused
    // "overload-protect triggered" and random 404s in the player.
    playableUrl: isDirectMedia(directVideo) ? directVideo : null,
    playableExpiresAt: isDirectMedia(directVideo) ? new Date(Date.now() + 90 * 60_000) : null,
    playableSource: isDirectMedia(directVideo) ? "tiktok-cdn" : null,
    durationSec: num(raw.duration),
    creatorUniqueId: username || null,
    creatorName: str(raw.nickname, 120),
    creatorAvatar: str(raw.avatar, 900),
    soundId: null,
    soundTitle: str(raw.sound, 200),
    soundUrl: null,
    soundAuthor: null,
    publishedAt: num(raw.createdAt) ? new Date(num(raw.createdAt)! * 1000) : null,
    stats,
    comments: null,
    // Upstream already inspected comments when lastScan.commentScanned === true.
    commentsUnavailableReason:
      scan?.commentScanned === true
        ? undefined
        : "Upstream belum melaporkan pemindaian komentar untuk video ini",
    presetLinks,
  };
}

async function callUpstream(url: string): Promise<{ ok: boolean; status: number; items: UnknownRecord[]; message: string; cached?: boolean }> {
  const controller = new AbortController();
  const timeoutMs = Math.max(config.providers.timeoutMs, 25_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "PresetSpaceScanner/1.0" },
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, items: [], message: `Upstream Bimz HTTP ${res.status}: ${text.slice(0, 140)}` };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, items: [], message: "Upstream Bimz mengembalikan bukan JSON" };
    }
    const record = isRecord(payload) ? payload : {};
    const data = isRecord(record.data) ? record.data : {};
    const items = Array.isArray(record.presets)
      ? record.presets
      : Array.isArray(data.presets)
        ? data.presets
        : Array.isArray(record.items)
          ? record.items
          : [];
    const meta = isRecord(data.meta) ? data.meta : {};
    return {
      ok: true,
      status: res.status,
      items: items.filter(isRecord),
      message: `Upstream Bimz OK (${items.length} preset${meta.cached === true ? ", cache" : ""})`,
      cached: meta.cached === true,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      items: [],
      message: error instanceof Error ? error.message.slice(0, 160) : "Upstream Bimz tidak dapat dihubungi",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function upstreamConfigured(): boolean {
  return Boolean(config.bimz.upstreamUrl);
}

/** Keyword / category search against the Bimz preset index. */
export async function bimzSearch(keyword: string, limit = 60): Promise<ProviderResult> {
  const base = config.bimz.upstreamUrl;
  if (!base) {
    return {
      provider: "restapi-bimz",
      ok: false,
      message: "BIMZ_UPSTREAM_URL belum dikonfigurasi — indeks preset Bimz tidak dapat dipakai.",
      videos: [],
    };
  }
  const capped = Math.min(Math.max(limit, 1), 120);
  const url = `${base.replace(/\/$/, "")}/api/search?q=${encodeURIComponent(keyword)}&limit=${capped}`;
  const response = await callUpstream(url);
  const videos = response.items
    .map((item) => normalize(item, base.replace(/\/$/, "")))
    .filter((video): video is ProviderVideo => video !== null);

  return {
    provider: "restapi-bimz",
    ok: response.ok && videos.length > 0,
    httpStatus: response.status || undefined,
    message: response.ok
      ? `${videos.length} video preset untuk "${keyword}" dari indeks Bimz`
      : response.message,
    videos,
  };
}

/** Latest presets — used to warm the database with fresh content. */
export async function bimzLatest(limit = 60): Promise<ProviderResult> {
  const base = config.bimz.upstreamUrl;
  if (!base) {
    return { provider: "restapi-bimz", ok: false, message: "BIMZ_UPSTREAM_URL belum dikonfigurasi", videos: [] };
  }
  // Upstream /api/presets returns a small latest slice; prefer search with a broad term for more volume.
  const capped = Math.min(Math.max(limit, 1), 120);
  let response = await callUpstream(`${base.replace(/\/$/, "")}/api/search?q=preset&limit=${capped}`);
  if (!response.ok || response.items.length === 0) {
    response = await callUpstream(`${base.replace(/\/$/, "")}/api/presets?limit=${capped}`);
  }
  const videos = response.items
    .map((item) => normalize(item, base.replace(/\/$/, "")))
    .filter((video): video is ProviderVideo => video !== null);
  return {
    provider: "restapi-bimz",
    ok: response.ok && videos.length > 0,
    httpStatus: response.status || undefined,
    message: response.ok ? `${videos.length} preset terbaru dari Bimz` : response.message,
    videos,
  };
}

/**
 * Resolve ONE video through the Bimz index.
 * The index is not queryable by raw video id, so we try the creator handle
 * first (that is how the index is keyed in practice), then the id, and match
 * the returned rows against our tiktokId.
 */
export async function bimzResolveVideo(tiktokUrl: string): Promise<ProviderResult> {
  const base = config.bimz.upstreamUrl?.replace(/\/$/, "");
  if (!base) return { provider: "restapi-bimz", ok: false, message: "BIMZ_UPSTREAM_URL belum dikonfigurasi", videos: [] };

  const tiktokId = tiktokUrl.match(TIKTOK_ID_RE)?.[1] ?? null;
  const handle = tiktokUrl.match(/tiktok\.com\/@([\w.\-]+)/i)?.[1]?.toLowerCase() ?? null;

  // Creator handle is the most reliable key; the raw id is the fallback.
  const attempts: string[] = [];
  if (handle) attempts.push(handle);
  if (tiktokId) attempts.push(tiktokId);
  attempts.push(tiktokUrl);

  const seenIds = new Set<string>();
  const collected: ProviderVideo[] = [];

  for (const query of attempts) {
    const response = await callUpstream(`${base}/api/search?q=${encodeURIComponent(query)}&limit=20`);
    if (!response.ok) continue;
    for (const item of response.items) {
      const video = normalize(item, base);
      if (!video || seenIds.has(video.tiktokId)) continue;
      seenIds.add(video.tiktokId);
      collected.push(video);
    }
    // Stop as soon as the video we want is in the result set.
    if (tiktokId && collected.some((video) => video.tiktokId === tiktokId)) break;
  }

  const video = tiktokId
    ? collected.find((candidate) => candidate.tiktokId === tiktokId) ?? null
    : (collected[0] ?? null);

  if (!video) {
    return {
      provider: "restapi-bimz",
      ok: false,
      message: `Video ${tiktokId ?? tiktokUrl} tidak ada di indeks Bimz (${collected.length} kandidat diperiksa)`,
      videos: [],
    };
  }
  return {
    provider: "restapi-bimz",
    ok: true,
    message: `Metadata + link preset dari Bimz (@${video.creatorUniqueId ?? "?"})`,
    videos: [video],
  };
}

export async function bimzUpstreamHealth(): Promise<{ configured: boolean; reachable: boolean; indexed: number | null; message: string }> {
  const base = config.bimz.upstreamUrl;
  if (!base) return { configured: false, reachable: false, indexed: null, message: "BIMZ_UPSTREAM_URL tidak diset" };
  const response = await callUpstream(`${base.replace(/\/$/, "")}/api/status`);
  const statusRecord = isRecord(response.items[0]) ? response.items[0] : {};
  return {
    configured: true,
    reachable: response.ok,
    indexed: num(statusRecord.indexed),
    message: response.ok ? `Indeks Bimz aktif${num(statusRecord.indexed) ? ` (${num(statusRecord.indexed)} preset)` : ""}` : response.message,
  };
}
