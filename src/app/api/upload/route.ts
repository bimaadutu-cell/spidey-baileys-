import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { fail, json, readJson, rateLimit, clientIp, tooMany } from "@/server/http";
import { listUserUploads, uploadUserPreset } from "@/server/services/social";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  const items = await listUserUploads(user.id);
  return json({ ok: true, items });
}

const schema = z.object({
  title: z.string().min(1).max(120),
  caption: z.string().max(2000).optional(),
  videoUrl: z.string().url().max(900),
  thumbnailUrl: z.string().url().max(900).optional(),
  xmlUrl: z.string().url().max(900).optional().or(z.literal("")),
  fiveMbUrl: z.string().url().max(900).optional().or(z.literal("")),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  if (!rateLimit(`upload:${user.id}:${clientIp(req)}`, 8, 600_000)) return tooMany();
  const parsed = schema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid", 422);
  const result = await uploadUserPreset({
    userId: user.id,
    username: user.username,
    title: parsed.data.title,
    caption: parsed.data.caption,
    videoUrl: parsed.data.videoUrl,
    thumbnailUrl: parsed.data.thumbnailUrl,
    xmlUrl: parsed.data.xmlUrl || undefined,
    fiveMbUrl: parsed.data.fiveMbUrl || undefined,
  });
  return json(result, { status: result.ok ? 201 : 422 });
}
