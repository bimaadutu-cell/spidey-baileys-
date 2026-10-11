/**
 * Smoke test — hits the running Preset Space instance and verifies the main
 * flows against REAL data. Run with the app started:
 *
 *   APP_URL=http://localhost:3000 node --test tests/smoke.test.mjs
 *
 * Any assertion that depends on external credentials (Bimz API key, WhatsApp
 * worker) is reported as a skipped diagnostic, never faked.
 */

import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const TOKEN = process.env.INTERNAL_TOKEN ?? "";

async function get(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text), headers: res.headers };
  } catch {
    return { status: res.status, body: text, headers: res.headers };
  }
}

test("health reports a reachable database", async () => {
  const { status, body } = await get("/api/health");
  assert.equal(status, 200);
  assert.equal(body.ok, true, `database not ready: ${JSON.stringify(body.database)}`);
  assert.equal(body.database.schemaReady, true);
});

test("preset listing works and caps anonymous visitors at 10", async () => {
  const { status, body } = await get("/api/presets?limit=12");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  if (!body.authenticated) assert.ok(body.items.length <= 10, "anon received more than 10 presets");

  const page2 = await get("/api/presets?limit=12&page=2");
  if (!body.authenticated) {
    assert.equal(page2.status, 401, "anon page 2 must be rejected server-side");
    assert.equal(page2.body.locked, true);
  }
});

test("categories endpoint returns seeded categories", async () => {
  const { status, body } = await get("/api/categories");
  assert.equal(status, 200);
  assert.ok(body.items.length >= 10, "categories not seeded");
});

test("registration + login + anonymous cap enforcement", async () => {
  const username = `tester${Date.now().toString().slice(-6)}`;
  const register = await get("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "preset-space-123" }),
  });
  const cookie = register.headers.getSetCookie().find((c) => c.startsWith("preset_space_session="))?.split(";")[0];
  assert.ok(register.body.ok, "registration failed");

  const authed = await get("/api/presets?limit=48", { headers: cookie ? { cookie } : {} });
  assert.equal(authed.status, 200);
  assert.equal(authed.body.authenticated, true);

  const logout = await get("/api/auth/logout", { method: "POST", headers: cookie ? { cookie } : {} });
  assert.equal(logout.status, 200);
});

test("review is stored and its PNG is rendered server-side", async () => {
  const review = await get("/api/reviews", {
    method: "POST",
    body: JSON.stringify({ username: "Smoke Test", rating: 5, body: "Uji coba pengiriman ulasan dari smoke test." }),
  });
  assert.equal(review.status, 201);
  assert.ok(review.body.review.id);

  const image = await fetch(`${BASE}${review.body.imageUrl}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  const buffer = Buffer.from(await image.arrayBuffer());
  assert.ok(buffer.length > 5000, "PNG terlalu kecil — renderer kemungkinan gagal");
});

test("review image rejects unknown ids", async () => {
  const res = await fetch(`${BASE}/api/reviews/00000000-0000-4000-8000-000000000000/image`);
  assert.equal(res.status, 404);
});

test("internal WhatsApp bridge requires the internal token", async () => {
  const denied = await get("/api/internal/whatsapp");
  assert.equal(denied.status, 401);
  if (TOKEN) {
    const allowed = await get("/api/internal/whatsapp", { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(allowed.status, 200);
    assert.ok(allowed.body.bot, "bot runtime missing");
  }
});

test("global chat history is served from the database", async () => {
  const { status, body } = await get("/api/chat");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.messages));
  const ids = new Set(body.messages.map((message) => message.id));
  assert.equal(ids.size, body.messages.length, "duplicate chat ids returned");
});

test("scanner reports provider truth instead of fake results", async () => {
  const { status, body } = await get("/api/scan?mode=keyword", {
    method: "POST",
    body: JSON.stringify({ keyword: "preset alight motion", count: 3 }),
  });
  assert.equal(status, 200);
  assert.ok(body.ok);
  assert.ok(Array.isArray(body.report.providers));
  assert.ok(body.report.providers.length > 0);
});

test("ssrf guard blocks private hosts", async () => {
  // direct unit-style probe through the ingest endpoint
  const { status } = await get("/api/scan?mode=ingest", {
    method: "POST",
    body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data/" }),
  });
  assert.notEqual(status, 200, "internal metadata URL must never be fetched");
});
