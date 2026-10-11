import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { fail, json, readJson } from "@/server/http";
import {
  followUser,
  getProfileStats,
  recordView,
  toggleFavorite,
  unfollowUser,
} from "@/server/services/social";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  const stats = await getProfileStats(user.id);
  return json({ ok: true, stats, user: { id: user.id, username: user.username, displayName: user.displayName } });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("follow"), userId: z.string().uuid() }),
  z.object({ action: z.literal("unfollow"), userId: z.string().uuid() }),
  z.object({ action: z.literal("favorite"), presetId: z.string().uuid() }),
  z.object({ action: z.literal("view"), presetId: z.string().uuid() }),
]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  const parsed = schema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail("Aksi tidak valid", 422);
  const data = parsed.data;
  if (data.action === "follow") return json(await followUser(user.id, data.userId));
  if (data.action === "unfollow") return json(await unfollowUser(user.id, data.userId));
  if (data.action === "favorite") return json(await toggleFavorite(user.id, data.presetId));
  return json(await recordView(data.presetId, user.id));
}
