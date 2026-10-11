import { NextRequest } from "next/server";
import { json, fail } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resolve a TikTok share/vm link to a playable URL for decorative wallpaper. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url")?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return fail("URL wajib", 422);

  try {
    // Expand short links
    let finalUrl = url;
    try {
      const head = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
        signal: AbortSignal.timeout(12_000),
      });
      finalUrl = head.url || url;
    } catch {
      /* keep original */
    }

    // tikwm metadata
    const api = `https://www.tikwm.com/api/?url=${encodeURIComponent(finalUrl)}&hd=1`;
    const res = await fetch(api, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const body = (await res.json()) as {
      code?: number;
      data?: { play?: string; hdplay?: string; wmplay?: string };
    };
    const playable = body.data?.hdplay || body.data?.play || body.data?.wmplay;
    if (!playable) return json({ ok: false, error: "Tidak bisa resolve video" });

    return json({
      ok: true,
      playableUrl: playable,
      streamUrl: playable,
      source: finalUrl,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "gagal" });
  }
}
