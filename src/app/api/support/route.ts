import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { clientIp, fail, json, rateLimit, readJson, tooMany } from "@/server/http";
import { createTicket, listTickets, markRead, unreadCount } from "@/server/services/support";

export const dynamic = "force-dynamic";

/** GET — this user's tickets + unread developer replies (green light). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json({ ok: true, authenticated: false, tickets: [], unread: 0 });

  const [tickets, unread] = await Promise.all([listTickets(user.id), unreadCount(user.id)]);
  return json({ ok: true, authenticated: true, tickets, unread });
}

const createSchema = z.object({
  action: z.literal("create"),
  category: z.enum(["kendala", "saran", "lainnya"]).default("kendala"),
  subject: z.string().min(4, "Judul minimal 4 karakter").max(120),
  body: z.string().min(10, "Deskripsi minimal 10 karakter").max(1500),
});

const readSchema = z.object({ action: z.literal("read"), ticketId: z.string().uuid() });

const bodySchema = z.discriminatedUnion("action", [createSchema, readSchema]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan untuk mengirim laporan", 401);
  if (!rateLimit(`support:${user.id}:${clientIp(req)}`, 6, 600_000)) return tooMany();

  const parsed = bodySchema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid", 422);

  if (parsed.data.action === "read") {
    await markRead(user.id, parsed.data.ticketId);
    return json({ ok: true });
  }

  const ticket = await createTicket({
    userId: user.id,
    username: user.displayName || user.username,
    category: parsed.data.category,
    subject: parsed.data.subject,
    body: parsed.data.body,
  });

  return json(
    {
      ok: true,
      ticket,
      note: `Laporan tersimpan (tiket ${ticket.shortId}). Bot meneruskan ke developer; balasan akan muncul di Kontak Masuk.`,
    },
    { status: 201 },
  );
}
