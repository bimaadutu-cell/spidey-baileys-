import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { supportReplies, supportTickets, whatsappDeliveryLogs } from "@/db/schema";
import { sanitizeText } from "../http";
import { getBotConfig } from "./chat";

/* =========================================================================
 * Support / "Laporan Kendala"
 *
 * Flow:
 *   user submits  -> stored in PostgreSQL
 *                 -> forwarded to the developer's WhatsApp by the bot
 *   developer replies on WhatsApp with:  #balas <ticketId> <jawaban>
 *                 -> stored as a reply + the user's inbox lights up green
 * =======================================================================*/

export type TicketDto = {
  id: string;
  shortId: string;
  username: string;
  category: string;
  subject: string;
  body: string;
  status: string;
  notifyStatus: string;
  unread: boolean;
  createdAt: string;
  lastReplyAt: string | null;
  replies: { id: string; author: string; authorName: string; body: string; createdAt: string }[];
};

const shortOf = (id: string) => id.slice(0, 8);

export async function createTicket(input: {
  userId: string | null;
  username: string;
  category: string;
  subject: string;
  body: string;
}): Promise<TicketDto> {
  const rows = await db
    .insert(supportTickets)
    .values({
      userId: input.userId,
      username: sanitizeText(input.username, 40),
      category: sanitizeText(input.category, 20) || "kendala",
      subject: sanitizeText(input.subject, 120),
      body: sanitizeText(input.body, 1500),
    })
    .returning();

  const ticket = rows[0]!;

  // Queue the WhatsApp notification (survives the bot being offline).
  const cfg = await getBotConfig();
  await db
    .insert(whatsappDeliveryLogs)
    .values({
      reviewId: null,
      target: cfg.targetNumber || cfg.botNumber,
      kind: "support_ticket",
      idempotencyKey: `ticket:${ticket.id}`,
      status: "queued",
      imageUrl: null,
      lastError: null,
    })
    .onConflictDoNothing({ target: whatsappDeliveryLogs.idempotencyKey });

  return toDto(ticket, []);
}

function toDto(
  ticket: typeof supportTickets.$inferSelect,
  replies: (typeof supportReplies.$inferSelect)[],
): TicketDto {
  return {
    id: ticket.id,
    shortId: shortOf(ticket.id),
    username: ticket.username,
    category: ticket.category,
    subject: ticket.subject,
    body: ticket.body,
    status: ticket.status,
    notifyStatus: ticket.notifyStatus,
    unread: ticket.unreadForUser,
    createdAt: ticket.createdAt.toISOString(),
    lastReplyAt: ticket.lastReplyAt ? ticket.lastReplyAt.toISOString() : null,
    replies: replies.map((reply) => ({
      id: reply.id,
      author: reply.author,
      authorName: reply.authorName,
      body: reply.body,
      createdAt: reply.createdAt.toISOString(),
    })),
  };
}

export async function listTickets(userId: string): Promise<TicketDto[]> {
  const tickets = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.createdAt))
    .limit(50);
  if (tickets.length === 0) return [];

  const all = await db
    .select()
    .from(supportReplies)
    .orderBy(supportReplies.createdAt);

  return tickets.map((ticket) => toDto(ticket, all.filter((reply) => reply.ticketId === ticket.id)));
}

/** Count of unread developer replies — drives the green "balasan developer nih" light. */
export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportTickets)
    .where(and(eq(supportTickets.userId, userId), eq(supportTickets.unreadForUser, true)));
  return Number(row?.n ?? 0);
}

export async function markRead(userId: string, ticketId: string): Promise<void> {
  await db
    .update(supportTickets)
    .set({ unreadForUser: false })
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)));
}

/**
 * Called by the WhatsApp worker when the developer answers with
 * `#balas <ticketId> <text>`. Accepts the 8-char short id or the full uuid.
 */
export async function addDeveloperReply(input: {
  ticketRef: string;
  body: string;
  whatsappId?: string | null;
}): Promise<{ ok: boolean; message: string; ticketId?: string }> {
  const ref = input.ticketRef.trim().toLowerCase();
  const rows = await db
    .select()
    .from(supportTickets)
    .where(sql`${supportTickets.id}::text = ${ref} or left(${supportTickets.id}::text, 8) = ${ref}`)
    .limit(1);

  const ticket = rows[0];
  if (!ticket) return { ok: false, message: `Tiket ${ref} tidak ditemukan` };

  const cfg = await getBotConfig();
  await db.insert(supportReplies).values({
    ticketId: ticket.id,
    author: "developer",
    authorName: cfg.displayName || "BimzOfficial ✓",
    body: sanitizeText(input.body, 1500),
    viaWhatsappId: input.whatsappId ?? null,
  });

  await db
    .update(supportTickets)
    .set({ status: "answered", unreadForUser: true, lastReplyAt: new Date() })
    .where(eq(supportTickets.id, ticket.id));

  return { ok: true, message: `Balasan tersimpan untuk tiket ${shortOf(ticket.id)}`, ticketId: ticket.id };
}

/** Pending ticket notifications for the worker to deliver. */
export async function claimTicketNotifications(limit = 3): Promise<
  { logId: string; target: string; ticket: TicketDto }[]
> {
  const logs = await db
    .select()
    .from(whatsappDeliveryLogs)
    .where(and(eq(whatsappDeliveryLogs.kind, "support_ticket"), eq(whatsappDeliveryLogs.status, "queued")))
    .limit(limit);
  if (logs.length === 0) return [];

  const out: { logId: string; target: string; ticket: TicketDto }[] = [];
  for (const log of logs) {
    const ref = log.idempotencyKey.replace("ticket:", "");
    const rows = await db.select().from(supportTickets).where(eq(supportTickets.id, ref)).limit(1);
    if (!rows[0]) continue;
    await db
      .update(whatsappDeliveryLogs)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(whatsappDeliveryLogs.id, log.id));
    out.push({ logId: log.id, target: log.target, ticket: toDto(rows[0], []) });
  }
  return out;
}

export async function markTicketNotified(
  logId: string,
  ticketId: string,
  status: "sent" | "failed",
  error?: string,
): Promise<void> {
  await db
    .update(whatsappDeliveryLogs)
    .set({
      status,
      lastError: error ? error.slice(0, 280) : null,
      sentAt: status === "sent" ? new Date() : null,
      attempts: sql`${whatsappDeliveryLogs.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(whatsappDeliveryLogs.id, logId));
  await db.update(supportTickets).set({ notifyStatus: status }).where(eq(supportTickets.id, ticketId));
}

export async function listAllTickets(limit = 50): Promise<TicketDto[]> {
  const tickets = await db.select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(limit);
  if (tickets.length === 0) return [];
  const all = await db.select().from(supportReplies).orderBy(supportReplies.createdAt);
  return tickets.map((ticket) => toDto(ticket, all.filter((reply) => reply.ticketId === ticket.id)));
}
