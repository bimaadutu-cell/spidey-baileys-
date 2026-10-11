import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { presets, sounds } from "@/db/schema";
import { fetchXmlText, injectSoundIntoXml } from "@/server/services/xml-sound-inject";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Serves preset XML with TikTok/sound URL injected so Alight Motion can
 * resolve audio without a separate download step.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("ID preset tidak valid", { status: 400 });
  }

  const rows = await db
    .select({
      id: presets.id,
      title: presets.title,
      xmlUrl: presets.xmlUrl,
      soundUrl: sounds.url,
      soundTitle: sounds.title,
    })
    .from(presets)
    .leftJoin(sounds, eq(sounds.id, presets.soundId))
    .where(eq(presets.id, id))
    .limit(1);

  const row = rows[0];
  if (!row?.xmlUrl) {
    return new Response("XML belum tersedia untuk preset ini", { status: 404 });
  }

  const fetched = await fetchXmlText(row.xmlUrl);
  if (!fetched.ok || !fetched.text) {
    // Fall back: redirect to original so user still gets the file
    return Response.redirect(row.xmlUrl, 302);
  }

  const soundUrl =
    row.soundUrl && /^https?:\/\//i.test(row.soundUrl) ? row.soundUrl : null;

  const result = injectSoundIntoXml(fetched.text, soundUrl, row.soundTitle);
  const filename = `presetspace-${(row.title || id).replace(/[^\w\-]+/g, "_").slice(0, 40)}.xml`;

  return new Response(result.xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-presetspace-sound-injected": result.injected ? "1" : "0",
      "x-presetspace-sound-reason": result.reason ?? (result.injected ? "injected" : "none"),
    },
  });
}
