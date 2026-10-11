import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { clientIp, fail, json, rateLimit, tooMany } from "@/server/http";
import { listUserUploads, uploadUserPreset } from "@/server/services/social";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function uploadRoot(): string {
  const preferred = process.env.UPLOAD_DIR?.trim() || path.join(process.cwd(), "public", "uploads");
  if (!fs.existsSync(preferred)) fs.mkdirSync(preferred, { recursive: true });
  return preferred;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  const items = await listUserUploads(user.id);
  return json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  if (!rateLimit(`upload:${user.id}:${clientIp(req)}`, 6, 600_000)) return tooMany();

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return fail("Upload harus multipart (pilih video dari galeri)", 400);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Gagal membaca file upload", 400);
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
  if (!mime.startsWith("video/")) return fail("File harus video", 422);
  if (blob.size > 80 * 1024 * 1024) return fail("Maksimal 80 MB", 422);

  const ext =
    mime.includes("webm") ? "webm" : mime.includes("quicktime") || mime.includes("mov") ? "mov" : "mp4";
  const filename = `${user.id.slice(0, 8)}_${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
  const dir = uploadRoot();
  const fullPath = path.join(dir, filename);
  const buffer = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(fullPath, buffer);

  // Public URL — files under public/uploads are served as /uploads/...
  // If UPLOAD_DIR is outside public, media route can still serve them later.
  const videoUrl = `/uploads/${filename}`;

  const result = await uploadUserPreset({
    userId: user.id,
    username: user.username,
    title,
    caption: caption || undefined,
    videoUrl,
    xmlUrl: xmlUrl || undefined,
    fiveMbUrl: fiveMbUrl || undefined,
  });

  if (!result.ok) {
    try {
      fs.unlinkSync(fullPath);
    } catch {
      /* ignore */
    }
    return json(result, { status: 422 });
  }

  return json({ ...result, videoUrl }, { status: 201 });
}
