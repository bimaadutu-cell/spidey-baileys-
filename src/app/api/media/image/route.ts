import { NextRequest } from "next/server";
import { streamMedia } from "@/server/services/media-proxy";

export const dynamic = "force-dynamic";

/**
 * Image gateway: /api/media/image?u=<encoded tiktok cdn url>
 * Avoids referrer/anti-hotlink failures on thumbnails & avatars.
 */
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("u");
  if (!target) return Response.json({ ok: false, error: "Parameter u wajib" }, { status: 400 });
  if (target.length > 1200) return Response.json({ ok: false, error: "URL terlalu panjang" }, { status: 414 });
  return streamMedia(target, req.headers.get("range"));
}
