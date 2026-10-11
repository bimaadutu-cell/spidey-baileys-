import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function candidates(name: string): string[] {
  const safe = path.basename(name);
  return [
    path.join(process.cwd(), "public", "uploads", safe),
    path.join("/data/uploads", safe),
    path.join("/tmp/preset-uploads", safe),
    process.env.UPLOAD_DIR ? path.join(process.env.UPLOAD_DIR, safe) : "",
  ].filter(Boolean);
}

export async function GET(req: NextRequest) {
  const f = req.nextUrl.searchParams.get("f") || "";
  if (!f || f.includes("..") || f.includes("/") || f.includes("\\")) {
    return new Response("Bad request", { status: 400 });
  }
  for (const filePath of candidates(f)) {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const type = ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : "video/mp4";
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": type,
          "Content-Length": String(data.length),
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  }
  return new Response("Not found", { status: 404 });
}
