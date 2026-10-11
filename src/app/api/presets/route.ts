import { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { config } from "@/server/config";
import { fail, json } from "@/server/http";
import { listPresets } from "@/server/services/preset-store";

export const dynamic = "force-dynamic";

/**
 * Preset listing. Anonymous visitors are hard-capped server-side at
 * ANON_PRESET_LIMIT presets — the cap is not a CSS trick.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const user = await getCurrentUser();

  // A freshly deployed/empty database fills itself instead of showing nothing.
  // This is what keeps presets from "disappearing" after a new deploy.
  try {
    const { ensureSeeded, backfillStatuses } = await import("@/server/services/bulk-harvest");
    const seed = await ensureSeeded();
    // Keep statuses in sync with the links we already hold (cheap, idempotent).
    if (seed.seeded) await backfillStatuses();
  } catch {
    /* seeding is best-effort; the query below still reports real state */
  }

  const requestedLimit = Number(params.get("limit") ?? 12);
  const requestedPage = Number(params.get("page") ?? 1);

  // Anonymous visitors: page 1 is served but clamped to ANON_PRESET_LIMIT rows,
  // any deeper page requires a session (enforced here, in the backend).
  if (!user && requestedPage > 1) {
    return json(
      {
        ok: false,
        locked: true,
        error: "Login untuk membuka semua preset.",
        requiredAction: "login",
        anonLimit: config.anonPresetLimit,
      },
      { status: 401 },
    );
  }

  const limit = user ? Math.min(Math.max(requestedLimit, 1), 48) : Math.min(Math.max(requestedLimit, 1), config.anonPresetLimit);

  const idsParam = params.get("ids");
  const ids = idsParam
    ? idsParam
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        .slice(0, 60)
    : undefined;

  const result = await listPresets({
    ids,
    search: params.get("q") ?? undefined,
    creator: params.get("creator") ?? undefined,
    category: params.get("category") ?? undefined,
    filter: params.get("filter") ?? undefined,
    sort: params.get("sort") ?? undefined,
    page: page(requestedPage),
    limit,
  });

  return json({
    ok: true,
    ...result,
    authenticated: Boolean(user),
    anonLimit: config.anonPresetLimit,
    locked: false,
  });
}

function page(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export async function POST() {
  return fail("Gunakan /api/search untuk mencari preset", 405);
}
