import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { config } from "./config";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = "preset_space_session";
const SESSION_TTL_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SafeUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  avatarKey: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  createdAt: string;
};

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    avatarKey: user.avatarKey,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    userAgent: meta.userAgent?.slice(0, 250) ?? null,
    ipHash: meta.ip ? hashToken(meta.ip).slice(0, 32) : null,
    expiresAt,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SafeUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.status !== "active") return null;
  return toSafeUser(row.user);
}

export async function isAdmin(user: SafeUser | null): Promise<boolean> {
  if (!user) return false;
  if (user.role === "admin" || user.role === "developer") return true;
  const { config } = await import("./config");
  if (config.admin.username && user.username === config.admin.username) return true;
  return false;
}

/** First account that matches ADMIN_USERNAME becomes admin (bootstrap, server-side only). */
export function matchesAdminBootstrap(username: string): boolean {
  const { config } = require("./config") as typeof import("./config");
  return Boolean(config.admin.username) && username.toLowerCase() === config.admin.username.toLowerCase();
}

export function internalTokenOk(headerValue: string | null): boolean {
  const { config } = require("./config") as typeof import("./config");
  if (!config.internalToken) return false;
  if (!headerValue) return false;
  const provided = headerValue.replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(config.internalToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
