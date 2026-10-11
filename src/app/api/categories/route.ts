import { json } from "@/server/http";
import { categoryCounts } from "@/server/services/preset-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const categories = await categoryCounts();
  return json({ ok: true, items: categories.map((category) => ({ ...category, id: category.slug })) });
}
