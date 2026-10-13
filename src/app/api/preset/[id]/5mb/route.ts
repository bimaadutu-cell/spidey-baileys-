import { eq } from "drizzle-orm";
import { db } from "@/db";
import { presets } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resolve the current 5MB/share URL from the database at click time. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("ID preset tidak valid", { status: 400 });
  }

  const rows = await db
    .select({ fiveMbUrl: presets.fiveMbUrl })
    .from(presets)
    .where(eq(presets.id, id))
    .limit(1);
  const target = rows[0]?.fiveMbUrl;
  if (!target) return new Response("Link 5MB belum tersedia untuk preset ini", { status: 404 });
  try {
    const parsed = new URL(target);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
  } catch {
    return new Response("URL 5MB tidak valid", { status: 400 });
  }
  return Response.redirect(target, 302);
}
