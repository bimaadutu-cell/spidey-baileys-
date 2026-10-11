import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/server/auth";
import { fail, json, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  avatarKey: z.string().regex(/^neon-0[1-8]$/, "Avatar tidak tersedia"),
  displayName: z.string().min(2).max(40).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  return json({ ok: true, user });
}

export async function POST(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return fail("Login diperlukan", 401);

  const parsed = schema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid", 422);

  await db
    .update(users)
    .set({
      avatarKey: parsed.data.avatarKey,
      ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
    })
    .where(eq(users.id, current.id));

  const updated = await getCurrentUser();
  return json({ ok: true, user: updated });
}
