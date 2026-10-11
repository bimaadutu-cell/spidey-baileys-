import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { presets } from "@/db/schema";
import { getCurrentUser } from "@/server/auth";
import { config } from "@/server/config";
import { fail, json, readJson } from "@/server/http";
import { fetchVideoMetadata } from "@/server/services/tiktok-providers";
import { listPresets, upsertVideo, scanPreset } from "@/server/services/preset-store";

export const dynamic = "force-dynamic";

/** Video feed page. Same server-side anonymous cap as /api/presets. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const user = await getCurrentUser();
  const requestedLimit = Number(params.get("limit") ?? 6);
  const requestedPage = Number(params.get("page") ?? 1);

  if (!user && requestedPage > 1) {
    return json(
      { ok: false, locked: true, error: "Login untuk membuka semua preset.", anonLimit: config.anonPresetLimit },
      { status: 401 },
    );
  }

  const result = await listPresets({
    search: params.get("q") ?? undefined,
    creator: params.get("creator") ?? undefined,
    category: params.get("category") ?? undefined,
    filter: params.get("filter") ?? undefined,
    sort: params.get("sort") ?? "latest",
    page: requestedPage,
    limit: user ? Math.min(requestedLimit, 24) : Math.min(requestedLimit, config.anonPresetLimit),
  });

  return json({ ok: true, ...result, authenticated: Boolean(user) });
}

const refreshSchema = z.object({ presetId: z.string().uuid(), rescan: z.boolean().optional() });

/** Refreshes an expired playable CDN link by re-reading real provider metadata. */
export async function POST(req: NextRequest) {
  const parsed = refreshSchema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail("presetId tidak valid", 422);

  const rows = await db.select().from(presets).where(eq(presets.id, parsed.data.presetId)).limit(1);
  const preset = rows[0];
  if (!preset) return fail("Preset tidak ditemukan", 404);

  const { video, providers } = await fetchVideoMetadata(preset.videoUrl);
  if (!video) {
    return json({
      ok: false,
      error: "Metadata tidak dapat diperbarui",
      providers: providers.map((p) => ({ provider: p.provider, ok: p.ok, message: p.message })),
    });
  }

  await upsertVideo(video, preset.discoverySource);
  if (parsed.data.rescan) await scanPreset(preset.id);

  return json({
    ok: true,
    playableUrl: video.playableUrl ?? null,
    thumbnailUrl: video.thumbnailUrl ?? null,
    providers: providers.map((p) => ({ provider: p.provider, ok: p.ok, message: p.message })),
  });
}
