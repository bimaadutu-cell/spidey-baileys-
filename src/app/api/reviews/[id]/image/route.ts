import { fail } from "@/server/http";
import { getReview } from "@/server/services/reviews";
import { renderReviewImage } from "@/server/services/review-image";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("ID ulasan tidak valid", 400);
  const review = await getReview(id);
  if (!review) return fail("Ulasan tidak ditemukan", 404);

  try {
    const png = await renderReviewImage({
      reviewId: review.id,
      username: review.username,
      rating: review.rating,
      body: review.body,
      createdAt: review.createdAt,
    });
    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "content-length": String(png.length),
        "cache-control": "public, max-age=3600, immutable",
      },
    });
  } catch (error) {
    return fail(
      `Gagal merender gambar ulasan: ${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`,
      500,
    );
  }
}
