import { config } from "../config";
import { isSafePublicUrl, sanitizeText } from "../http";

/* =========================================================================
 * linkDetector — host fingerprinting
 * =======================================================================*/

const HOST_LABELS: { test: RegExp; label: string; kindHint?: "file" | "page" }[] = [
  { test: /drive\.google\.com$/i, label: "Google Drive", kindHint: "page" },
  { test: /docs\.google\.com$/i, label: "Google Docs", kindHint: "page" },
  { test: /mediafire\.com$/i, label: "MediaFire", kindHint: "page" },
  { test: /dropbox\.com$/i, label: "Dropbox", kindHint: "page" },
  { test: /mega\.nz$|mega\.io$/i, label: "MEGA", kindHint: "page" },
  { test: /terabox\./i, label: "Terabox", kindHint: "page" },
  { test: /pixeldrain\.com$/i, label: "Pixeldrain", kindHint: "page" },
  { test: /github\.com$|raw\.githubusercontent\.com$/i, label: "GitHub", kindHint: "file" },
  { test: /telegra\.ph$|t\.me$/i, label: "Telegram", kindHint: "page" },
  { test: /discord\./i, label: "Discord", kindHint: "page" },
  { test: /alight\.link$/i, label: "Alight Link", kindHint: "page" },
  { test: /vt\.tiktok\.com$|tiktok\.com$/i, label: "TikTok", kindHint: "page" },
];

/** Suspicious hosts are never auto-trusted as preset links. */
const SUSPICIOUS = [/bit\.ly$/i, /tinyurl\.com$/i, /adfoc\.us$/i, /shorte\.st$/i, /\/short\//i];

export function detectHostLabel(url: string): { label: string; suspicious: boolean; extension: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { label: "unknown", suspicious: true, extension: "" };
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const label = HOST_LABELS.find((h) => h.test.test(host))?.label ?? host;
  const match = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
  return {
    label,
    suspicious: SUSPICIOUS.some((re) => re.test(host)),
    extension: match ? match[1]!.toLowerCase() : "",
  };
}

/* =========================================================================
 * captionAnalyzer / commentAnalyzer
 * =======================================================================*/

export const XML_TRIGGERS = [
  "xml",
  "link xml",
  "preset xml",
  "5mb",
  "5 mb",
  "preset 5mb",
  "link preset",
  "alight motion",
  "link di bio",
  "cek komentar",
  "link ada di komen",
  "link di komen",
  "preset by",
  "am preset",
];

export type UrlEvidence = {
  url: string;
  /** characters immediately before the URL, used to bind a URL to a trigger word */
  lead: string;
  trigger: "xml" | "five_mb" | "none";
  hostLabel: string;
  suspicious: boolean;
};

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;

export function extractUrlEvidence(text: string): UrlEvidence[] {
  const found: UrlEvidence[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0].replace(/[.,;]+$/, "");
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const start = match.index ?? 0;
    const lead = text.slice(Math.max(0, start - 40), start).toLowerCase();
    const trigger: UrlEvidence["trigger"] = /5\s?mb/.test(lead)
      ? "five_mb"
      : /xml/.test(lead)
        ? "xml"
        : "none";
    const meta = detectHostLabel(raw);
    found.push({
      url: raw,
      lead: lead.slice(-40),
      trigger,
      hostLabel: meta.label,
      suspicious: meta.suspicious,
    });
  }
  return found;
}

export type CaptionAnalysis = {
  caption: string;
  hashtags: string[];
  mentionsXml: boolean;
  mentionsFiveMb: boolean;
  mentionsAlight: boolean;
  hints: { linkInBio: boolean; checkComments: boolean };
  urls: UrlEvidence[];
};

export const captionAnalyzer = {
  analyze(rawCaption: string): CaptionAnalysis {
    const caption = sanitizeText(rawCaption ?? "", 4000);
    const lower = caption.toLowerCase();
    const hashtags = Array.from(caption.matchAll(/#[\p{L}\p{N}_]+/gu)).map((m) => m[0].toLowerCase());
    return {
      caption,
      hashtags: Array.from(new Set(hashtags)).slice(0, 40),
      mentionsXml: /(^|[^a-z])xml([^a-z]|$)/.test(lower) || lower.includes("preset xml"),
      mentionsFiveMb: /5\s?mb/.test(lower),
      mentionsAlight: lower.includes("alight motion") || lower.includes("alightmotion"),
      hints: {
        linkInBio: lower.includes("link di bio") || lower.includes("link in bio"),
        checkComments:
          lower.includes("cek komentar") ||
          lower.includes("link ada di komen") ||
          lower.includes("link di komen") ||
          lower.includes("check comment"),
      },
      urls: extractUrlEvidence(caption),
    };
  },
};

export type CommentSource = { id?: string; author?: string; text: string };

export type CommentAnalysis = {
  available: boolean;
  status: "OK" | "COMMENTS_UNAVAILABLE" | "NOT_REQUESTED";
  reason?: string;
  scanned: number;
  urls: (UrlEvidence & { commentId?: string; author?: string })[];
};

export const commentAnalyzer = {
  /**
   * Analyses ONLY real comments handed over by a provider. Fabricated comments
   * are impossible here because the caller passes provider output verbatim.
   */
  analyze(comments: CommentSource[] | null, unavailableReason?: string): CommentAnalysis {
    if (!comments) {
      return {
        available: false,
        status: unavailableReason ? "COMMENTS_UNAVAILABLE" : "NOT_REQUESTED",
        reason: unavailableReason,
        scanned: 0,
        urls: [],
      };
    }
    const urls: (UrlEvidence & { commentId?: string; author?: string })[] = [];
    for (const comment of comments) {
      for (const evidence of extractUrlEvidence(comment.text ?? "")) {
        urls.push({ ...evidence, commentId: comment.id, author: comment.author });
      }
    }
    return { available: true, status: "OK", scanned: comments.length, urls };
  },
};

/* =========================================================================
 * urlValidator — safe probe (never downloads large bodies)
 * =======================================================================*/

export type UrlValidation = {
  ok: boolean;
  httpStatus?: number;
  contentType?: string;
  contentLength?: number;
  finalUrl?: string;
  reason?: string;
  isXmlFile: boolean;
};

export async function validateUrl(rawUrl: string): Promise<UrlValidation> {
  let rawUrlToProbe = rawUrl;
  // Bimz download proxy requires the apikey — attach it server-side only.
  if (/apirestapibimz2new\.vercel\.app\/api\/alight\/preset\/download/i.test(rawUrl) && config.bimz.enabled) {
    try {
      const url = new URL(rawUrl);
      if (!url.searchParams.has("apikey")) {
        url.searchParams.set("apikey", config.bimz.apiKey);
        rawUrlToProbe = url.toString();
      }
    } catch {
      /* fall through with the original url */
    }
  }

  const safety = isSafePublicUrl(rawUrlToProbe);
  if (!safety.ok) return { ok: false, reason: safety.reason, isXmlFile: false };
  const target = safety.url!;
  const meta = detectHostLabel(rawUrl);
  const isXmlFile = meta.extension === "xml" || /\.xml(\?|$)/i.test(target.pathname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "range": "bytes=0-1023", "user-agent": "PresetSpaceScanner/1.0" },
    });
    const lengthHeader = res.headers.get("content-length");
    const totalRaw = res.headers.get("content-range")?.split("/")[1];
    const total = totalRaw ? Number(totalRaw) : lengthHeader ? Number(lengthHeader) : undefined;
    // A 200/206 alone is NOT proof of a valid preset — host + extension weigh in.
    const type = res.headers.get("content-type") ?? "";
    const isFileHost =
      /drive\.google|docs\.google|mediafire|dropbox|mega\.nz|pixeldrain|terabox|githubusercontent|alightcreative\.com/i.test(
        target.hostname,
      );
    // Alight Motion share pages serve HTML but ARE the real project payload.
    const isAlightShare = /alightcreative\.com\/am\/share\//i.test(target.pathname + target.search);
    const reachable = res.status < 400;
    const credible = isXmlFile || isAlightShare || isFileHost || type.includes("xml") || type.includes("octet-stream");

    return {
      ok: reachable && credible,
      httpStatus: res.status,
      contentType: type.split(";")[0],
      contentLength: Number.isFinite(total) ? total : undefined,
      finalUrl: res.url,
      reason: !reachable
        ? `HTTP ${res.status}`
        : credible
          ? undefined
          : "Host/konten tidak terindikasi sebagai file preset",
      isXmlFile,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 160) : "probe failed",
      isXmlFile,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================================================
 * presetMatcher — evidence based confidence + relevance scoring
 * =======================================================================*/

export type LinkKind = "xml" | "five_mb" | "unknown";

export type LinkCandidate = {
  url: string;
  kind: LinkKind;
  confidence: number;
  hostLabel: string;
  sourceType: "caption" | "comment" | "bimz_resolver" | "bimz_deep_scan" | "manual" | "related_search";
  sourceRef?: string;
  reasons: string[];
};

/**
 * Confidence is derived from observable evidence only:
 *  +45 direct .xml file URL
 *  +30 URL bound to the word XML   +30 URL bound to 5MB
 *  +15 file hosting domain         -60 suspicious shortener
 *  +10 comes from a real comment    +8 comes from caption
 */
export function scoreLinkCandidate(
  evidence: UrlEvidence & { sourceType: LinkCandidate["sourceType"]; sourceRef?: string },
): LinkCandidate {
  const meta = detectHostLabel(evidence.url);
  const reasons: string[] = [];
  let confidence = 0;
  let kind: LinkKind = "unknown";

  const isXmlExt = meta.extension === "xml" || /\.xml(\?|$)/i.test(evidence.url);
  if (isXmlExt) {
    confidence += 45;
    kind = "xml";
    reasons.push("URL mengarah ke file .xml");
  }
  if (evidence.trigger === "xml") {
    confidence += 30;
    kind = kind === "unknown" ? "xml" : kind;
    reasons.push("URL muncul setelah kata 'XML'");
  }
  if (evidence.trigger === "five_mb") {
    confidence += 30;
    kind = "five_mb";
    reasons.push("URL muncul setelah kata '5MB'");
  }
  if (/drive\.google|mediafire|dropbox|mega\.nz|terabox|pixeldrain/i.test(evidence.url)) {
    confidence += 15;
    reasons.push(`Domain file hosting: ${meta.label}`);
  }
  if (evidence.sourceType === "comment") {
    confidence += 10;
    reasons.push("Ditemukan pada komentar asli");
  }
  if (evidence.sourceType === "caption") {
    confidence += 8;
    reasons.push("Ditemukan pada caption asli");
  }
  if (meta.suspicious) {
    confidence -= 60;
    reasons.push("Domain pemendek / mencurigakan");
  }
  if (/alight\.link/i.test(evidence.url)) {
    confidence += 12;
    reasons.push("Alight Motion share link");
  }

  return {
    url: evidence.url,
    kind,
    confidence: Math.max(0, Math.min(100, confidence)),
    hostLabel: meta.label,
    sourceType: evidence.sourceType,
    sourceRef: evidence.sourceRef,
    reasons,
  };
}

/** Relevance of an externally-found preset to the preset we are analysing. */
export function relevanceScore(
  target: { creator?: string | null; caption?: string | null; sound?: string | null },
  candidate: { creator?: string | null; caption?: string | null; sound?: string | null },
): { score: number; reasons: string[] } {
  const norm = (v?: string | null) => (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const reasons: string[] = [];
  let score = 0;
  if (target.creator && norm(target.creator) === norm(candidate.creator)) {
    score += 40;
    reasons.push("Kreator sama");
  }
  if (target.sound && candidate.sound && norm(target.sound) === norm(candidate.sound)) {
    score += 25;
    reasons.push("Sound sama");
  }
  const targetWords = new Set(norm(target.caption).split(/\W+/).filter((w) => w.length > 4));
  const candidateWords = new Set(norm(candidate.caption).split(/\W+/).filter((w) => w.length > 4));
  const overlap = [...targetWords].filter((w) => candidateWords.has(w)).length;
  if (overlap >= 3) {
    score += Math.min(30, overlap * 5);
    reasons.push(`${overlap} kata unik caption sama`);
  }
  return { score, reasons };
}

export const SCANNER_LIMITS = {
  maxAttempts: config.scan.maxPresetAttempts,
  backoffMinutes: config.scan.retryBackoffMinutes,
};
