import { config } from "../config";
import { isSafePublicUrl } from "../http";
import { detectHostLabel, extractUrlEvidence, scoreLinkCandidate, type LinkCandidate } from "./preset-analyzers";

export type ResolverInput = {
  tiktokUrl?: string;
  tiktokId?: string;
  creator?: string | null;
  caption?: string | null;
  keyword?: string;
};

export type ResolverResult = {
  ok: boolean;
  status: "OK" | "MISSING_API_KEY" | "HTTP_ERROR" | "NO_RESULT" | "INVALID_RESPONSE";
  httpStatus?: number;
  message: string;
  candidates: LinkCandidate[];
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

/** Depth-first collection of every http(s) URL inside an arbitrary JSON payload. */
function collectUrls(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 6 || out.length > 40) return out;
  if (typeof value === "string") {
    for (const evidence of extractUrlEvidence(value)) out.push(evidence.url);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, depth + 1, out);
    return out;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectUrls(item, depth + 1, out);
  }
  return out;
}

function looksLikePresetFile(url: string): boolean {
  const meta = detectHostLabel(url);
  if (meta.suspicious) return false;
  if (/\.xml(\?|$)/i.test(url)) return true;
  if (/drive\.google\.com\/(file\/d|open\?id=|uc\?)/i.test(url)) return true;
  if (/mediafire\.com\/(file|download)\//i.test(url)) return true;
  if (/dropbox\.com\/(s|scl\/fi)\//i.test(url)) return true;
  if (/mega\.nz\/file\//i.test(url)) return true;
  if (/pixeldrain\.com\/[a-z0-9]+/i.test(url)) return true;
  if (/terabox\./i.test(url) && /\/s\//i.test(url)) return true;
  return false;
}

/**
 * Bimz Preset Link Resolver — FALLBACK source for XML / 5MB preset links.
 * Contract: GET {baseUrl}?apikey=...&url=<tiktok url> | &query=<keyword>
 * The endpoint is reachable but requires an API key (HTTP 401 without one),
 * so a missing BIMZ_API_KEY is reported honestly as MISSING_API_KEY.
 */
export async function bimzResolve(input: ResolverInput): Promise<ResolverResult> {
  if (!config.bimz.enabled) {
    return {
      ok: false,
      status: "MISSING_API_KEY",
      message:
        "BIMZ_API_KEY belum dikonfigurasi di environment server — resolver Bimz tidak dapat dipanggil.",
      candidates: [],
    };
  }

  const params = new URLSearchParams({ apikey: config.bimz.apiKey });
  if (input.tiktokUrl) params.set("url", input.tiktokUrl);
  if (input.tiktokId) params.set("id", input.tiktokId);
  if (!input.tiktokUrl && !input.tiktokId) {
    params.set("query", input.keyword ?? input.caption?.slice(0, 90) ?? input.creator ?? "alight motion preset");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.bimz.timeoutMs);
  try {
    const res = await fetch(`${config.bimz.baseUrl}?${params.toString()}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: "HTTP_ERROR",
        httpStatus: res.status,
        message: `Resolver Bimz HTTP ${res.status}: ${text.slice(0, 180)}`,
        candidates: [],
      };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, status: "INVALID_RESPONSE", httpStatus: res.status, message: "Response bukan JSON", candidates: [] };
    }
    const record = isRecord(payload) ? payload : {};
    if (record.success === false) {
      const err = isRecord(record.error) ? record.error : {};
      return {
        ok: false,
        status: "HTTP_ERROR",
        httpStatus: res.status,
        message: String(err.message ?? "Resolver Bimz menolak request").slice(0, 200),
        candidates: [],
      };
    }

    const urls = collectUrls(record.data ?? record.result ?? record).filter(looksLikePresetFile);
    const unique = Array.from(new Set(urls));
    if (unique.length === 0) {
      return { ok: true, status: "NO_RESULT", httpStatus: res.status, message: "Resolver tidak mengembalikan link preset", candidates: [] };
    }

    const candidates: LinkCandidate[] = unique.slice(0, 6).map((url) => {
      const safety = isSafePublicUrl(url);
      const lead = /\.xml(\?|$)/i.test(url) ? "xml" : /5\s?mb/i.test(url) ? "5mb" : "";
      const scored = scoreLinkCandidate({
        url,
        lead,
        trigger: /xml/.test(lead) ? "xml" : /5mb/.test(lead) ? "five_mb" : "none",
        hostLabel: detectHostLabel(url).label,
        suspicious: detectHostLabel(url).suspicious,
        sourceType: "bimz_resolver",
        sourceRef: "Bimz Preset Link Resolver",
      });
      // Resolver hits are keyword-matched, so they must be verified before trust.
      scored.confidence = Math.min(scored.confidence, 55);
      scored.reasons.push("Berasal dari resolver (perlu verifikasi kesesuaian)");
      scored.reasons.push(safety.ok ? "URL lolos pemeriksaan keamanan" : `URL ditolak: ${safety.reason}`);
      if (!safety.ok) scored.confidence = 0;
      return scored;
    });

    return {
      ok: true,
      status: "OK",
      httpStatus: res.status,
      message: `Resolver mengembalikan ${candidates.length} kandidat link`,
      candidates,
    };
  } catch (error) {
    return {
      ok: false,
      status: "HTTP_ERROR",
      message: error instanceof Error ? error.message.slice(0, 180) : "Resolver Bimz gagal",
      candidates: [],
    };
  }
}

export async function bimzHealth(): Promise<{ configured: boolean; reachable: boolean; message: string }> {
  if (!config.bimz.enabled) {
    return { configured: false, reachable: false, message: "BIMZ_API_KEY tidak diset" };
  }
  try {
    const res = await fetch(`${config.bimz.baseUrl}?apikey=${encodeURIComponent(config.bimz.apiKey)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    return {
      configured: true,
      reachable: res.status < 500,
      message:
        res.ok
          ? "Resolver merespons dengan API key valid"
          : `Resolver merespons HTTP ${res.status}${res.status === 401 ? " (API key ditolak)" : ""}`,
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      message: error instanceof Error ? error.message.slice(0, 160) : "Resolver tidak dapat dihubungi",
    };
  }
}
