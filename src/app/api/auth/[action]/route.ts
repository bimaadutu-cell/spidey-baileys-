import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  destroySession,
  getCurrentUser,
  hashPassword,
  matchesAdminBootstrap,
  toSafeUser,
  verifyPassword,
} from "@/server/auth";
import { clientIp, fail, json, rateLimit, readJson, tooMany } from "@/server/http";

export const dynamic = "force-dynamic";

const credentials = z.object({
  username: z
    .string()
    .min(3, "Username minimal 3 karakter")
    .max(24, "Username maksimal 24 karakter")
    .regex(/^[a-zA-Z0-9_.]+$/, "Username hanya boleh huruf, angka, titik, underscore"),
  password: z.string().min(8, "Password minimal 8 karakter").max(128),
  email: z.string().email().max(120).optional().nullable(),
});

type Ctx = { params: Promise<{ action: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  if (action !== "me") return fail("Endpoint tidak ditemukan", 404);
  const user = await getCurrentUser();
  return json({ ok: true, user });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  const ip = clientIp(req);

  if (action === "logout") {
    await destroySession();
    return json({ ok: true });
  }

  if (!rateLimit(`auth:${ip}`, 12, 60_000)) return tooMany();

  const body = await readJson<unknown>(req);
  const parsed = credentials.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid", 422);
  }
  const { username, password, email } = parsed.data;

  if (action === "register") {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (existing[0]) return fail("Username sudah digunakan", 409);
    const role = matchesAdminBootstrap(username) ? "admin" : "user";
    const inserted = await db
      .insert(users)
      .values({
        username,
        email: email ?? null,
        displayName: username,
        passwordHash: await hashPassword(password),
        role,
      })
      .returning();
    await createSession(inserted[0]!.id, { userAgent: req.headers.get("user-agent"), ip });
    return json({ ok: true, user: toSafeUser(inserted[0]!) }, { status: 201 });
  }

  if (action === "login") {
    const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return fail("Username atau password salah", 401);
    }
    if (user.status !== "active") return fail("Akun dinonaktifkan", 403);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await createSession(user.id, { userAgent: req.headers.get("user-agent"), ip });
    return json({ ok: true, user: toSafeUser(user) });
  }

  return fail("Endpoint tidak ditemukan", 404);
}
