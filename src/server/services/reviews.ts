import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { reviews, whatsappDeliveryLogs, type Review } from "@/db/schema";
import { config } from "../config";
import { sanitizeText } from "../http";

export type ReviewDto = {
  id: string;
  username: string;
  rating: number;
  body: string;
  notifyStatus: string;
  createdAt: string;
};

function toDto(row: Review): ReviewDto {
  return {
    id: row.id,
    username: row.username,
    rating: row.rating,
    body: row.body,
    notifyStatus: row.notifyStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createReview(input: {
  username: string;
  rating: number;
  body: string;
  userId?: string | null;
}): Promise<ReviewDto> {
  const username = sanitizeText(input.username, 40);
  const body = sanitizeText(input.body, 800);
  const rows = await db
    .insert(reviews)
    .values({ username, rating: input.rating, body, userId: input.userId ?? null })
    .returning();
  const review = rows[0]!;

  // The review is already durable — WhatsApp delivery is queued best-effort.
  await db
    .insert(whatsappDeliveryLogs)
    .values({
      reviewId: review.id,
      target: config.whatsapp.developerNumber,
      kind: "review_image",
      idempotencyKey: `review:${review.id}`,
      status: "queued",
      imageUrl: `/api/reviews/${review.id}/image`,
    })
    .onConflictDoNothing({ target: whatsappDeliveryLogs.idempotencyKey });

  return toDto(review);
}

export async function listReviews(limit = 50): Promise<ReviewDto[]> {
  const rows = await db.select().from(reviews).orderBy(desc(reviews.createdAt)).limit(limit);
  return rows.map(toDto);
}

export type DeliveryTask = {
  id: string;
  reviewId: string;
  target: string;
  idempotencyKey: string;
  imageUrl: string | null;
  attempts: number;
  review: { username: string; rating: number; body: string; createdAt: string };
};

/** Worker pulls queued deliveries; idempotency key prevents double sending. */
export async function claimDeliveries(limit = 5): Promise<DeliveryTask[]> {
  const rows = await db
    .select({ log: whatsappDeliveryLogs, review: reviews })
    .from(whatsappDeliveryLogs)
    .innerJoin(reviews, eq(reviews.id, whatsappDeliveryLogs.reviewId))
    .where(inArray(whatsappDeliveryLogs.status, ["queued", "pending"]))
    .orderBy(asc2(whatsappDeliveryLogs.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.log.id);
  await db
    .update(whatsappDeliveryLogs)
    .set({ status: "pending", updatedAt: new Date() })
    .where(inArray(whatsappDeliveryLogs.id, ids));

  return rows.map((row) => ({
    id: row.log.id,
    reviewId: row.log.reviewId ?? "",
    target: row.log.target,
    idempotencyKey: row.log.idempotencyKey,
    imageUrl: row.log.imageUrl,
    attempts: row.log.attempts,
    review: {
      username: row.review.username,
      rating: row.review.rating,
      body: row.review.body,
      createdAt: row.review.createdAt.toISOString(),
    },
  }));
}

/** asc() alias kept local so the import list stays small. */
function asc2<T>(column: T) {
  return sql`${column} asc`;
}

export async function markDelivery(
  id: string,
  status: "sent" | "failed" | "queued",
  lastError?: string | null,
): Promise<void> {
  await db
    .update(whatsappDeliveryLogs)
    .set({
      status,
      lastError: lastError ? lastError.slice(0, 300) : null,
      sentAt: status === "sent" ? new Date() : null,
      attempts: sql`${whatsappDeliveryLogs.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(whatsappDeliveryLogs.id, id));

  const rows = await db
    .select()
    .from(whatsappDeliveryLogs)
    .where(eq(whatsappDeliveryLogs.id, id))
    .limit(1);
  const reviewId = rows[0]?.reviewId;
  if (reviewId) {
    await db.update(reviews).set({ notifyStatus: status }).where(eq(reviews.id, reviewId));
  }
}

export async function requeueDelivery(id: string): Promise<boolean> {
  const rows = await db
    .update(whatsappDeliveryLogs)
    .set({ status: "queued", lastError: null, updatedAt: new Date() })
    .where(and(eq(whatsappDeliveryLogs.id, id)))
    .returning({ id: whatsappDeliveryLogs.id });
  return rows.length > 0;
}

export async function listDeliveries(limit = 50) {
  const rows = await db
    .select()
    .from(whatsappDeliveryLogs)
    .orderBy(desc(whatsappDeliveryLogs.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    reviewId: row.reviewId,
    target: row.target,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getReview(id: string): Promise<ReviewDto | null> {
  const rows = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export function newReviewRef(): string {
  return randomUUID();
}
