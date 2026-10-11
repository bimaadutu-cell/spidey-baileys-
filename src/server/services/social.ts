import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  presetFavorites,
  presets,
  presetViews,
  userFollows,
  userUploads,
  globalChatMessages,
  reviews,
} from "@/db/schema";
import { sanitizeText } from "../http";

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) return { ok: false, message: "Tidak bisa follow diri sendiri" };
  await db
    .insert(userFollows)
    .values({ followerId, followingId })
    .onConflictDoNothing();
  return { ok: true, message: "Mengikuti" };
}

export async function unfollowUser(followerId: string, followingId: string) {
  await db
    .delete(userFollows)
    .where(and(eq(userFollows.followerId, followerId), eq(userFollows.followingId, followingId)));
  return { ok: true, message: "Berhenti mengikuti" };
}

export async function getProfileStats(userId: string) {
  try {
    const [followers] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(userFollows)
      .where(eq(userFollows.followingId, userId));
    const [following] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(userFollows)
      .where(eq(userFollows.followerId, userId));
    const [favs] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(presetFavorites)
      .where(eq(presetFavorites.userId, userId));
    const [uploads] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(userUploads)
      .where(and(eq(userUploads.userId, userId), eq(userUploads.status, "published")));
    return {
      followers: followers?.n ?? 0,
      following: following?.n ?? 0,
      favorites: favs?.n ?? 0,
      uploads: uploads?.n ?? 0,
    };
  } catch {
    return { followers: 0, following: 0, favorites: 0, uploads: 0 };
  }
}

export async function toggleFavorite(userId: string, presetId: string) {
  const existing = await db
    .select({ id: presetFavorites.id })
    .from(presetFavorites)
    .where(and(eq(presetFavorites.userId, userId), eq(presetFavorites.presetId, presetId)))
    .limit(1);
  if (existing[0]) {
    await db.delete(presetFavorites).where(eq(presetFavorites.id, existing[0].id));
    await db
      .update(presets)
      .set({ favoriteCount: sql`greatest(coalesce(${presets.favoriteCount}, 0) - 1, 0)` })
      .where(eq(presets.id, presetId));
    return { ok: true, favorited: false };
  }
  await db.insert(presetFavorites).values({ userId, presetId });
  await db
    .update(presets)
    .set({ favoriteCount: sql`coalesce(${presets.favoriteCount}, 0) + 1` })
    .where(eq(presets.id, presetId));
  return { ok: true, favorited: true };
}

export async function recordView(presetId: string, viewerId?: string | null) {
  await db.insert(presetViews).values({ presetId, viewerId: viewerId ?? null });
  await db
    .update(presets)
    .set({ viewCount: sql`coalesce(${presets.viewCount}, 0) + 1` })
    .where(eq(presets.id, presetId));
  return { ok: true };
}

export async function uploadUserPreset(input: {
  userId: string;
  username: string;
  title: string;
  caption?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  xmlUrl?: string;
  fiveMbUrl?: string;
}) {
  const title = sanitizeText(input.title, 120) || "Preset saya";
  // Keep path as-is (do not over-sanitize query strings like ?f=file.mp4)
  const videoUrl = (input.videoUrl || "").trim().slice(0, 900);
  const okVideo =
    Boolean(videoUrl) &&
    (/^https?:\/\//i.test(videoUrl) ||
      videoUrl.startsWith("/uploads/") ||
      videoUrl.startsWith("/api/media/local") ||
      videoUrl.startsWith("/api/media/"));
  if (!okVideo) {
    return { ok: false as const, message: "Video upload tidak valid — pilih ulang dari galeri" };
  }
  const xmlUrl = input.xmlUrl ? sanitizeText(input.xmlUrl, 900) : null;
  const fiveMbUrl = input.fiveMbUrl ? sanitizeText(input.fiveMbUrl, 900) : null;
  // XML / 5MB optional at upload time — user can add later via edit/admin


  const tiktokId = `upload_${input.userId.slice(0, 8)}_${Date.now()}`;
  const [preset] = await db
    .insert(presets)
    .values({
      tiktokId,
      videoUrl,
      thumbnailUrl: input.thumbnailUrl ? sanitizeText(input.thumbnailUrl, 900) : null,
      caption: input.caption ? sanitizeText(input.caption, 2000) : title,
      xmlUrl,
      fiveMbUrl,
      xmlStatus: xmlUrl ? "FOUND" : "PENDING",
      fiveMbStatus: fiveMbUrl ? "FOUND" : "PENDING",
      overallStatus: xmlUrl && fiveMbUrl ? "COMPLETE" : xmlUrl || fiveMbUrl ? "PARTIAL" : "NEW",
      confidence: xmlUrl || fiveMbUrl ? 70 : 0,
      discoverySource: "user_upload",
      uploaderUserId: input.userId,
      publishedAt: new Date(),
    })
    .returning();

  await db.insert(userUploads).values({
    userId: input.userId,
    presetId: preset!.id,
    title,
    caption: input.caption ? sanitizeText(input.caption, 2000) : null,
    videoUrl,
    thumbnailUrl: input.thumbnailUrl ? sanitizeText(input.thumbnailUrl, 900) : null,
    xmlUrl,
    fiveMbUrl,
    status: "published",
  });

  return {
    ok: true as const,
    message: "Preset berhasil di-upload ke Preset Space (muncul di Discover)",
    presetId: preset!.id,
  };
}

export async function listUserUploads(userId: string) {
  return db
    .select()
    .from(userUploads)
    .where(and(eq(userUploads.userId, userId), eq(userUploads.status, "published")))
    .orderBy(desc(userUploads.createdAt))
    .limit(50);
}

export async function clearGlobalChat() {
  await db.delete(globalChatMessages);
  return { ok: true, message: "Riwayat Global Chat dihapus" };
}

export async function deleteReviewById(id: string) {
  await db.delete(reviews).where(eq(reviews.id, id));
  return { ok: true, message: "Ulasan dihapus" };
}

export async function listReviewsAdmin(limit = 40) {
  return db.select().from(reviews).orderBy(desc(reviews.createdAt)).limit(limit);
}
