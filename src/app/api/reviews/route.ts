import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { clientIp, fail, json, rateLimit, readJson, tooMany } from "@/server/http";
import { createReview, listReviews } from "@/server/services/reviews";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().min(2, "Nama minimal 2 karakter").max(40),
  rating: z.number().int().min(1, "Rating 1-5").max(5, "Rating 1-5"),
  body: z.string().min(4, "Ulasan minimal 4 karakter").max(800, "Ulasan maksimal 800 karakter"),
});

export async function GET() {
  const items = await listReviews(50);
  return json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!rateLimit(`review:${ip}`, 5, 300_000)) return tooMany();

  const parsed = schema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data ulasan tidak valid", 422);

  const user = await getCurrentUser();
  const review = await createReview({
    username: user?.username ?? parsed.data.username,
    rating: parsed.data.rating,
    body: parsed.data.body,
    userId: user?.id ?? null,
  });

  return json(
    {
      ok: true,
      review,
      delivery: {
        target: process.env.WHATSAPP_DEVELOPER_NUMBER ?? "6283115955196",
        status: "queued",
        note: "Ulasan tersimpan permanen. Notifikasi WhatsApp dikirim oleh bot worker saat sesi bot aktif.",
      },
      imageUrl: `/api/reviews/${review.id}/image`,
    },
    { status: 201 },
  );
}
