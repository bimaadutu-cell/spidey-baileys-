import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { clientIp, fail, json, rateLimit, readJson, tooMany } from "@/server/http";
import { listUserUploads, uploadUserPreset } from "@/server/services/social";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function uploadRoot(): string {
  const preferred =
    process.env.UPLOAD_DIR?.trim() ||
    (fs.existsSync("/data") ? "/data/uploads" : path.join(process.cwd(), "public", "uploads"));
  try {
    if (!fs.existsSync(preferred)) fs.mkdirSync(preferred, { recursive: true });
  } catch {
    const fallback = path.join("/tmp", "preset-uploads");
    if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
  return preferred;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  try {
    const items = await listUserUploads(user.id);
    return json({ ok: true, items });
  } catch (error) {
    return json({
      ok: true,
      items: [],
      note: error instanceof Error ? error.message : "tabel upload belum siap",
    });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  if (!rateLimit(`upload:${user.id}:${clientIp(req)}`, 8, 600_000)) return tooMany();

  const contentType = req.headers.get("content-type") || "";

  try {
    // --- Mode A: gallery file (multipart) ---
    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return fail("Gagal membaca file dari galeri", 400);
      }

      const title = String(form.get("title") || "").trim();
      const caption = String(form.get("caption") || "").trim();
      const xmlUrl = String(form.get("xmlUrl") || "").trim();
      const fiveMbUrl = String(form.get("fiveMbUrl") || "").trim();
      const file = form.get("video");

      if (!title) return fail("Judul wajib diisi", 422);
      if (!file || typeof file === "string") return fail("Pilih video dari galeri dulu", 422);

      const blob = file as File;
      const mime = blob.type || "video/mp4";
      if (blob.size > 80 * 1024 * 1024) return fail("Maksimal 80 MB", 422);

      const ext = mime.includes("webm")
        ? "webm"
        : mime.includes("quicktime") || mime.includes("mov")
          ? "mov"
          : "mp4";
      const filename = `${user.id.slice(0, 8)}_${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
      // Always write to public/uploads so URL is always /uploads/<file>
      const pub = path.join(process.cwd(), "public", "uploads");
      try {
        if (!fs.existsSync(pub)) fs.mkdirSync(pub, { recursive: true });
      } catch {
        /* fallback below */
      }
      let fullPath = path.join(pub, filename);
      const buffer = Buffer.from(await blob.arrayBuffer());
      try {
        fs.writeFileSync(fullPath, buffer);
      } catch {
        const dir = uploadRoot();
        fullPath = path.join(dir, filename);
        fs.writeFileSync(fullPath, buffer);
      }
      // Canonical public URL (also works via /api/media/local fallback)
      const videoUrl = `/uploads/${filename}`;
      // Mirror to /data/uploads if available (Railway volume)
      try {
        if (fs.existsSync("/data")) {
          const dataDir = "/data/uploads";
          if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
          fs.copyFileSync(fullPath, path.join(dataDir, filename));
        }
      } catch {
        /* ignore */
      }

      const result = await uploadUserPreset({
        userId: user.id,
        username: user.username,
        title,
        caption: caption || undefined,
        videoUrl,
        xmlUrl: xmlUrl || undefined,
        fiveMbUrl: fiveMbUrl || undefined,
      });

      if (!result.ok) return json(result, { status: 422 });
      return json({ ...result, videoUrl }, { status: 201 });
    }

    // --- Mode B: JSON with external video URL (fallback) ---
    const body = (await readJson<Record<string, unknown>>(req)) ?? {};
    const title = String(body.title || "").trim();
    const videoUrl = String(body.videoUrl || "").trim();
    const xmlUrl = String(body.xmlUrl || "").trim();
    const fiveMbUrl = String(body.fiveMbUrl || "").trim();
    const caption = String(body.caption || "").trim();

    if (!title) return fail("Judul wajib diisi", 422);
    if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
      return fail("Pilih video dari galeri, atau isi URL video https://", 422);
    }

    const result = await uploadUserPreset({
      userId: user.id,
      username: user.username,
      title,
      caption: caption || undefined,
      videoUrl,
      xmlUrl: xmlUrl || undefined,
      fiveMbUrl: fiveMbUrl || undefined,
    });

    return json(result, { status: result.ok ? 201 : 422 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    // Common: relation "user_uploads" does not exist → need drizzle-kit push
    if (/user_uploads|relation|does not exist|column/i.test(msg)) {
      return fail(
        "Database belum punya tabel upload. Jalankan di server: npx drizzle-kit push",
        503,
      );
    }
    return fail(`Upload gagal: ${msg.slice(0, 180)}`, 500);
  }
}
