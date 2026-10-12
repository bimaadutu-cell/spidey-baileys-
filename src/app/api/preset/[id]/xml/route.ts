import { eq } from "drizzle-orm";
import { db } from "@/db";
import { presets } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Redirect to the exact XML supplied for the preset; never rewrite its audio or project structure. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("ID preset tidak valid", { status: 400 });
  }

  const rows = await db
    .select({ xmlUrl: presets.xmlUrl })
    .from(presets)
    .where(eq(presets.id, id))
    .limit(1);
  const xmlUrl = rows[0]?.xmlUrl;
  if (!xmlUrl) return new Response("XML belum tersedia untuk preset ini", { status: 404 });
  if (!/^https?:\/\//i.test(xmlUrl)) return new Response("URL XML tidak valid", { status: 400 });

  return Response.redirect(xmlUrl, 302);
}
