import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { presets } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Redirect to the original XML / Alight share URL — never mutate the file.
 * Mutating AM project XML breaks import ("format tidak benar / file rusak").
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("ID preset tidak valid", { status: 400 });
  }

  const rows = await db
    .select({ xmlUrl: presets.xmlUrl, fiveMbUrl: presets.fiveMbUrl })
    .from(presets)
    .where(eq(presets.id, id))
    .limit(1);

  const row = rows[0];
  const target = row?.xmlUrl || row?.fiveMbUrl;
  if (!target) {
    return new Response("Link preset belum tersedia", { status: 404 });
  }

  return Response.redirect(target, 302);
}
