import { NextRequest } from "next/server";
import { fail, json } from "@/server/http";
import { getPresetDetail } from "@/server/services/preset-store";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("ID preset tidak valid", 400);
  const detail = await getPresetDetail(id);
  if (!detail) return fail("Preset tidak ditemukan", 404);
  return json({ ok: true, ...detail });
}
