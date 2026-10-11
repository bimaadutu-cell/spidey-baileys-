import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  creators,
  presetCategories,
  presetLinks,
  presets,
  scanAttempts,
  scanJobs,
  sounds,
  type Preset,
} from "@/db/schema";
import { CATEGORIES, classifyCategory, SEARCH_KEYWORDS, config } from "../config";
import { sanitizeText } from "../http";
import {
  captionAnalyzer,
  commentAnalyzer,
  scoreLinkCandidate,
  validateUrl,
  relevanceScore,
  type LinkCandidate,
} from "./preset-analyzers";
import {
  dedupeVideos,
  fetchVideoMetadata,
  keywordSearch,
  normalizeTikTokUrl,
  type ProviderVideo,
  type ProviderResult,
} from "./tiktok-providers";
import { bimzResolve } from "./bimzLinkResolver";
import type { ProviderPresetLink } from "./bimz-preset-provider";
import { bimzDeepScan } from "./bimz-deep-scanner";
import { beginScan, endScan, setScanPhase, isScanning, scanLabel } from "./scan-progress";

/* =========================================================================
 * Category bootstrap
 * =======================================================================*/

let categoriesReady = false;

export async function ensureCategories(): Promise<void> {
  if (categoriesReady) return;
  await db
    .insert(presetCategories)
    .values(
      CATEGORIES.map((c, index) => ({
        slug: c.slug,
        label: c.label,
        labelCn: c.labelCn,
        description: c.description,
        keywords: c.keywords,
        sortOrder: index,
      })),
    )
    .onConflictDoUpdate({
      target: presetCategories.slug,
      set: {
        label: sql`excluded.label`,
        labelCn: sql`excluded.label_cn`,
        description: sql`excluded.description`,
        keywords: sql`excluded.keywords`,
        sortOrder: sql`excluded.sort_order`,
      },
    });
  categoriesReady = true;
}

/* =========================================================================
 * Persistence — UPSERT based, so re-scans never duplicate rows
 * =======================================================================*/

export async function upsertVideo(video: ProviderVideo, discoverySource: string): Promise<Preset> {
  await ensureCategories();

  let creatorId: number | null = null;
  if (video.creatorUniqueId) {
    const uniqueId = video.creatorUniqueId.toLowerCase();
    const inserted = await db
      .insert(creators)
      .values({
        uniqueId,
        displayName: video.creatorName ?? uniqueId,
        avatarUrl: video.creatorAvatar ?? null,
        profileUrl: `https://www.tiktok.com/@${uniqueId}`,
      })
      .onConflictDoUpdate({
        target: creators.uniqueId,
        set: {
          displayName: sql`coalesce(excluded.display_name, ${creators.displayName})`,
          avatarUrl: sql`coalesce(excluded.avatar_url, ${creators.avatarUrl})`,
          lastSeenAt: new Date(),
        },
      })
      .returning({ id: creators.id });
    creatorId = inserted[0]?.id ?? null;
  }

  let soundId: number | null = null;
  if (video.soundUrl || video.soundId) {
    const soundKey = video.soundUrl ?? `tiktok-music:${video.soundId}`;
    const insertedSound = await db
      .insert(sounds)
      .values({
        tiktokId: video.soundId ?? null,
        title: video.soundTitle ?? null,
        authorName: video.soundAuthor ?? null,
        url: soundKey,
      })
      .onConflictDoUpdate({
        target: sounds.url,
        set: { title: sql`coalesce(excluded.title, ${sounds.title})` },
      })
      .returning({ id: sounds.id });
    soundId = insertedSound[0]?.id ?? null;
  }

  const analysis = captionAnalyzer.analyze(video.caption ?? "");
  const categorySlug = classifyCategory(
    `${analysis.caption} ${analysis.hashtags.join(" ")}`,
  );
  let categoryId: number | null = null;
  if (categorySlug) {
    const cat = await db
      .select({ id: presetCategories.id })
      .from(presetCategories)
      .where(eq(presetCategories.slug, categorySlug))
      .limit(1);
    categoryId = cat[0]?.id ?? null;
  }

  const detectedKeywords = Array.from(
    new Set(
      SEARCH_KEYWORDS.filter((kw) =>
        `${analysis.caption} ${analysis.hashtags.join(" ")}`.toLowerCase().includes(kw.toLowerCase()),
      ).slice(0, 8),
    ),
  );

  const rows = await db
    .insert(presets)
    .values({
      tiktokId: video.tiktokId,
      videoUrl: video.videoUrl,
      embedUrl: `https://www.tiktok.com/embed/v2/${video.tiktokId}`,
      thumbnailUrl: video.thumbnailUrl ?? null,
      playableUrl: video.playableUrl ?? null,
      playableSource: video.playableUrl ? "provider" : null,
      playableExpiresAt: video.playableExpiresAt ?? null,
      title: analysis.caption.split("\n")[0]?.slice(0, 180) ?? null,
      caption: analysis.caption,
      hashtags: analysis.hashtags,
      keywords: detectedKeywords,
      creatorId,
      soundId,
      categoryId,
      durationSec: video.durationSec ?? null,
      stats: video.stats ?? null,
      publishedAt: video.publishedAt ?? null,
      discoverySource,
      overallStatus: "NEW",
    })
    .onConflictDoUpdate({
      target: presets.tiktokId,
      set: {
        caption: sql`coalesce(nullif(excluded.caption, ''), ${presets.caption})`,
        hashtags: sql`case when array_length(excluded.hashtags, 1) > 0 then excluded.hashtags else ${presets.hashtags} end`,
        keywords: sql`case when array_length(excluded.keywords, 1) > 0 then excluded.keywords else ${presets.keywords} end`,
        thumbnailUrl: sql`coalesce(excluded.thumbnail_url, ${presets.thumbnailUrl})`,
        playableUrl: sql`coalesce(excluded.playable_url, ${presets.playableUrl})`,
        playableSource: sql`coalesce(excluded.playable_source, ${presets.playableSource})`,
        playableExpiresAt: sql`coalesce(excluded.playable_expires_at, ${presets.playableExpiresAt})`,
        creatorId: sql`coalesce(excluded.creator_id, ${presets.creatorId})`,
        soundId: sql`coalesce(excluded.sound_id, ${presets.soundId})`,
        categoryId: sql`coalesce(excluded.category_id, ${presets.categoryId})`,
        stats: sql`coalesce(excluded.stats, ${presets.stats})`,
        publishedAt: sql`coalesce(excluded.published_at, ${presets.publishedAt})`,
        embedUrl: sql`coalesce(excluded.embed_url, ${presets.embedUrl})`,
        updatedAt: new Date(),
      },
    })
    .returning();
  const preset = rows[0]!;

  // Provider-discovered preset links (e.g. scraped from the video's comments by
  // the Bimz index) are stored immediately as candidates, then validated by the scanner.
  if (video.presetLinks && video.presetLinks.length > 0) {
    await persistLinks(preset.id, video.presetLinks);

    // Reflect the links immediately: a stored link IS an available link.
    // Leaving the status at PENDING while we already hold a URL is exactly the
    // dishonest "tiba-tiba tidak tersedia" behaviour we must avoid.
    const best = (kind: "xml" | "five_mb") =>
      video
        .presetLinks!.filter((link) => link.kind === kind && link.confidence > 0)
        .sort((a, b) => b.confidence - a.confidence)[0] ?? null;

    const xml = best("xml");
    const fiveMb = best("five_mb");
    const overall =
      xml && fiveMb ? "COMPLETE" : xml ? "XML_FOUND" : fiveMb ? "FIVE_MB_FOUND" : "NEW";

    await db
      .update(presets)
      .set({
        xmlStatus: xml ? "FOUND" : preset.xmlStatus,
        fiveMbStatus: fiveMb ? "FOUND" : preset.fiveMbStatus,
        xmlUrl: xml?.url ?? preset.xmlUrl,
        fiveMbUrl: fiveMb?.url ?? preset.fiveMbUrl,
        xmlSource: xml ? xml.sourceType : preset.xmlSource,
        fiveMbSource: fiveMb ? fiveMb.sourceType : preset.fiveMbSource,
        confidence: Math.max(preset.confidence, xml?.confidence ?? 0, fiveMb?.confidence ?? 0),
        overallStatus: overall,
        updatedAt: new Date(),
      })
      .where(eq(presets.id, preset.id));
  }

  return preset;
}

/* =========================================================================
 * Preset Scanner — stages A..E
 * =======================================================================*/

export type ScanReport = {
  presetId: string;
  tiktokId: string;
  overallStatus: string;
  xmlStatus: string;
  fiveMbStatus: string;
  confidence: number;
  xmlUrl: string | null;
  fiveMbUrl: string | null;
  xmlSource: string | null;
  fiveMbSource: string | null;
  nextRetryAt: string | null;
  stages: {
    stage: string;
    provider?: string;
    ok: boolean;
    message: string;
    evidence?: Record<string, unknown>;
  }[];
};

async function logAttempt(entry: {
  jobId?: string | null;
  presetId?: string | null;
  stage: string;
  provider?: string;
  ok: boolean;
  message: string;
  statusCode?: number;
  durationMs?: number;
  evidence?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(scanAttempts).values({
    jobId: entry.jobId ?? null,
    presetId: entry.presetId ?? null,
    stage: entry.stage,
    provider: entry.provider ?? null,
    ok: entry.ok,
    message: entry.message.slice(0, 500),
    statusCode: entry.statusCode ?? null,
    durationMs: entry.durationMs ?? null,
    evidence: entry.evidence ?? null,
  });
}

function statusFromCandidates(candidates: LinkCandidate[]): {
  xmlStatus: string;
  fiveMbStatus: string;
  xml: LinkCandidate | null;
  fiveMb: LinkCandidate | null;
  confidence: number;
} {
  const xml = candidates.filter((c) => c.kind === "xml" && c.confidence > 0).sort((a, b) => b.confidence - a.confidence)[0] ?? null;
  const fiveMb =
    candidates.filter((c) => c.kind === "five_mb" && c.confidence > 0).sort((a, b) => b.confidence - a.confidence)[0] ??
    null;
  return {
    xmlStatus: xml ? "FOUND" : "PENDING",
    fiveMbStatus: fiveMb ? "FOUND" : "PENDING",
    xml,
    fiveMb,
    confidence: Math.max(xml?.confidence ?? 0, fiveMb?.confidence ?? 0),
  };
}

/** Persists every accepted candidate as preset_links (unique per preset+url). */
async function persistLinks(
  presetId: string,
  candidates: (LinkCandidate | ProviderPresetLink)[],
): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.confidence <= 0) continue;
    await db
      .insert(presetLinks)
      .values({
        presetId,
        kind: candidate.kind,
        url: candidate.url,
        sourceType: candidate.sourceType,
        sourceRef: "sourceRef" in candidate ? (candidate.sourceRef ?? null) : null,
        hostLabel: candidate.hostLabel,
        confidence: candidate.confidence,
        verified: false,
      })
      .onConflictDoUpdate({
        target: [presetLinks.presetId, presetLinks.url],
        set: {
          kind: candidate.kind,
          sourceType: candidate.sourceType,
          hostLabel: candidate.hostLabel,
          confidence: sql`greatest(${presetLinks.confidence}, ${candidate.confidence})`,
        },
      });
  }
}

/** Turns rows already stored in preset_links into candidates for re-validation. */
async function loadStoredLinks(presetId: string): Promise<LinkCandidate[]> {
  const rows = await db.select().from(presetLinks).where(eq(presetLinks.presetId, presetId));
  return rows.map((row) => ({
    url: row.url,
    kind: (row.kind === "xml" || row.kind === "five_mb" ? row.kind : "unknown") as LinkCandidate["kind"],
    confidence: row.confidence,
    hostLabel: row.hostLabel ?? "unknown",
    sourceType: (row.sourceType as LinkCandidate["sourceType"]) ?? "related_search",
    sourceRef: row.sourceRef ?? "tersimpan dari scan sebelumnya",
    reasons: [`Sudah tersimpan dari scan sebelumnya (sumber: ${row.sourceType})`],
  }));
}

export async function scanPreset(presetId: string, jobId?: string): Promise<ScanReport> {
  try {
    return await runScanPreset(presetId, jobId);
  } finally {
    // Never leave a preset stuck on "Sedang scan preset…".
    endScan(presetId);
  }
}

async function runScanPreset(presetId: string, jobId?: string): Promise<ScanReport> {
  const rows = await db.select().from(presets).where(eq(presets.id, presetId)).limit(1);
  const preset = rows[0];
  if (!preset) throw new Error("Preset tidak ditemukan");

  const startedAt = new Date();
  // Mark SCANNING in the DB *and* in the live registry so the UI shows
  // "Sedang scan preset…" until a real result replaces it.
  beginScan(presetId, preset.tiktokId);
  await db.update(presets).set({ overallStatus: "SCANNING", lastScannedAt: startedAt }).where(eq(presets.id, presetId));

  const stages: ScanReport["stages"] = [];
  let candidates: LinkCandidate[] = [];

  /* ---------- Stage 0: Bimz DEEP SCAN (authoritative) ------------------- */
  // The upstream actually downloads and parses each candidate file, so a hit
  // here is hard evidence and short-circuits the cheaper heuristic stages.
  setScanPhase(presetId, "deep_scan");
  const deep = await bimzDeepScan(preset.videoUrl);
  await logAttempt({
    jobId,
    presetId,
    stage: "bimz_deep_scan",
    provider: "restapi-bimz/alight",
    ok: deep.ok && deep.links.length > 0,
    message: deep.message,
    statusCode: deep.httpStatus,
    evidence: {
      status: deep.status,
      xmlFiles: deep.summary.xmlFiles,
      packages: deep.summary.packages,
      project: deep.project ?? undefined,
      links: deep.links.map((l) => ({ kind: l.kind, url: l.url, confidence: l.confidence })),
    },
  });
  stages.push({
    stage: "bimz_deep_scan",
    provider: "restapi-bimz/alight",
    ok: deep.ok,
    message: deep.message,
    evidence: deep.project ? { project: deep.project } : undefined,
  });

  if (deep.links.length > 0) {
    await persistLinks(presetId, deep.links);
    // Mark verified rows so the UI can show "terverifikasi oleh scanner".
    for (const link of deep.links.filter((l) => l.verified)) {
      await db
        .update(presetLinks)
        .set({ verified: true, contentType: String(link.detail?.contentType ?? "") || null })
        .where(and(eq(presetLinks.presetId, presetId), eq(presetLinks.url, link.url)));
    }
  }

  // Deep scan also returns fresh metadata + a direct CDN url: use it.
  if (deep.meta.playableUrl || deep.meta.cover) {
    await db
      .update(presets)
      .set({
        playableUrl: deep.meta.playableUrl ?? preset.playableUrl,
        playableSource: deep.meta.playableUrl ? "bimz-deep-scan" : preset.playableSource,
        playableExpiresAt: deep.meta.playableUrl ? new Date(Date.now() + 3 * 3600_000) : preset.playableExpiresAt,
        thumbnailUrl: deep.meta.cover ?? preset.thumbnailUrl,
        stats: deep.meta.stats ?? preset.stats,
        updatedAt: new Date(),
      })
      .where(eq(presets.id, presetId));
  }

  /* ---------- Stage A + B: metadata + caption analysis ------------------ */
  setScanPhase(presetId, "metadata");
  const meta = await fetchVideoMetadata(preset.videoUrl);
  for (const provider of meta.providers) {
    await logAttempt({
      jobId,
      presetId,
      stage: "metadata",
      provider: provider.provider,
      ok: provider.ok,
      message: provider.message,
      statusCode: provider.httpStatus,
      evidence: { videos: provider.videos.length },
    });
    stages.push({ stage: "metadata", provider: provider.provider, ok: provider.ok, message: provider.message });
  }

  let caption = preset.caption ?? "";
  let creator: string | null = null;
  let sound: string | null = null;
  let comments: { id?: string; author?: string; text: string }[] | null = null;
  let commentsReason = "Provider tidak menyediakan komentar";

  if (meta.video) {
    caption = meta.video.caption || caption;
    creator = meta.video.creatorUniqueId ?? null;
    sound = meta.video.soundTitle ?? null;
    comments = meta.video.comments ?? null;
    commentsReason = meta.video.commentsUnavailableReason ?? commentsReason;
    await db
      .update(presets)
      .set({
        caption: caption || preset.caption,
        thumbnailUrl: meta.video.thumbnailUrl ?? preset.thumbnailUrl,
        playableUrl: meta.video.playableUrl ?? preset.playableUrl,
        playableExpiresAt: meta.video.playableExpiresAt ?? preset.playableExpiresAt,
        stats: meta.video.stats ?? preset.stats,
      })
      .where(eq(presets.id, presetId));
    if (meta.video.playableUrl && !preset.playableUrl) {
      await upsertVideo(meta.video, preset.discoverySource);
    }
  }

  // Seed candidates with links already stored (provider-scraped or from a previous
  // scan) so we validate real evidence instead of starting from zero every time.
  const storedLinks = await loadStoredLinks(presetId);
  candidates.push(...storedLinks);
  stages.push({
    stage: "stored_links",
    ok: storedLinks.length > 0,
    message:
      storedLinks.length > 0
        ? `${storedLinks.length} kandidat dimuat dari database`
        : "Belum ada link tersimpan dari sumber manapun",
    provider: "database",
  });

  setScanPhase(presetId, "caption");
  const analysis = captionAnalyzer.analyze(caption);
  const captionCandidates = analysis.urls.map((evidence) =>
    scoreLinkCandidate({ ...evidence, sourceType: "caption", sourceRef: "caption" }),
  );
  candidates.push(...captionCandidates);
  await logAttempt({
    jobId,
    presetId,
    stage: "caption",
    ok: true,
    message: `Caption dianalisis: ${captionCandidates.length} URL terdeteksi`,
    evidence: {
      mentionsXml: analysis.mentionsXml,
      mentionsFiveMb: analysis.mentionsFiveMb,
      linkInBio: analysis.hints.linkInBio,
      checkComments: analysis.hints.checkComments,
      urls: analysis.urls.map((u) => u.url),
    },
  });
  stages.push({
    stage: "caption",
    ok: true,
    message: `${captionCandidates.length} URL pada caption, hint komentar: ${analysis.hints.checkComments}`,
    evidence: { mentionsXml: analysis.mentionsXml, mentionsFiveMb: analysis.mentionsFiveMb },
  });

  /* ---------- Stage C: comments (only when a source provides them) ------ */
  const commentResult = commentAnalyzer.analyze(comments, commentsReason);
  const commentCandidates = commentResult.urls.map((evidence) =>
    scoreLinkCandidate({
      ...evidence,
      sourceType: "comment",
      sourceRef: evidence.author ? `comment by ${evidence.author}` : "comment",
    }),
  );
  candidates.push(...commentCandidates);
  await logAttempt({
    jobId,
    presetId,
    stage: "comments",
    ok: commentResult.status === "OK",
    message:
      commentResult.status === "OK"
        ? `${commentResult.scanned} komentar diperiksa, ${commentResult.urls.length} URL`
        : commentResult.reason ?? "Komentar tidak tersedia",
    evidence: { status: commentResult.status, scanned: commentResult.scanned },
  });
  stages.push({
    stage: "comments",
    ok: commentResult.status === "OK",
    message:
      commentResult.status === "OK"
        ? `${commentResult.scanned} komentar asli diperiksa`
        : `Komentar tidak tersedia (${commentResult.reason ?? "tidak diminta"})`,
  });

  /* ---------- Stage D: related search + Bimz resolver ------------------- */
  const needMore = !candidates.some((c) => c.kind === "xml" && c.confidence >= 45);

  // Stage D0 — ask the Bimz index for THIS video when we still have no XML lead.
  if (candidates.length === 0) {
    const { bimzResolveVideo } = await import("./bimz-preset-provider");
    const upstream = await bimzResolveVideo(preset.videoUrl);
    const upstreamLinks = upstream.videos[0]?.presetLinks ?? [];
    if (upstreamLinks.length > 0) {
      await persistLinks(presetId, upstreamLinks);
      const seeded = await loadStoredLinks(presetId);
      candidates = [...seeded];
    }
    stages.push({
      stage: "bimz_index_lookup",
      provider: "restapi-bimz",
      ok: upstream.ok,
      message: upstream.message,
    });
  }


  if (needMore) {
    const keyword =
      analysis.hashtags[0]?.replace("#", "") ??
      (creator ? `${creator} preset` : undefined) ??
      caption.split(/\s+/).slice(0, 5).join(" ");
    const search = await keywordSearch(keyword, 6);
    await logAttempt({
      jobId,
      presetId,
      stage: "related_search",
      provider: search.providers[0]?.provider ?? "tikwm-search",
      ok: search.videos.length > 0,
      message: search.providers[0]?.message ?? "Pencarian ulang tidak menghasilkan video",
      statusCode: search.providers[0]?.httpStatus,
      evidence: { keyword, found: search.videos.length },
    });
    stages.push({
      stage: "related_search",
      provider: "tikwm-search",
      ok: search.videos.length > 0,
      message: search.videos.length ? `${search.videos.length} video terkait` : (search.providers[0]?.message ?? "Tidak ada hasil"),
    });
  }

  let resolverStatus = "SKIPPED";
  if (needMore) {
    const resolver = await bimzResolve({
      tiktokUrl: preset.videoUrl,
      tiktokId: preset.tiktokId,
      creator,
      caption,
      keyword: analysis.hashtags[0]?.replace("#", ""),
    });
    resolverStatus = resolver.status;
    candidates.push(...resolver.candidates);
    await logAttempt({
      jobId,
      presetId,
      stage: "bimz_resolver",
      provider: "Bimz Preset Link Resolver",
      ok: resolver.ok && resolver.candidates.length > 0,
      message: resolver.message,
      statusCode: resolver.httpStatus,
      evidence: { status: resolver.status, candidates: resolver.candidates.length },
    });
    stages.push({ stage: "bimz_resolver", provider: "Bimz", ok: resolver.ok, message: resolver.message });
  }

  /* ---------- Stage E: validation -------------------------------------- */
  setScanPhase(presetId, "validation");
  const validated: LinkCandidate[] = [];
  const deepUrls = new Set(deep.links.filter((link) => link.verified).map((link) => link.url));

  for (const candidate of candidates) {
    if (candidate.confidence <= 0) continue;

    // Files already downloaded AND parsed by the Bimz deep scanner are proven;
    // re-probing them from here only produces false negatives (Drive/Alight
    // rate-limit server-side HEAD/Range requests).
    if (deepUrls.has(candidate.url) || candidate.sourceType === "bimz_deep_scan") {
      validated.push({
        ...candidate,
        reasons: [...candidate.reasons, "Terverifikasi deep scanner (file diunduh & diparse upstream)"],
      });
      continue;
    }

    const probe = await validateUrl(candidate.url);
    const finalCandidate: LinkCandidate = { ...candidate };
    if (probe.ok) {
      finalCandidate.confidence = Math.min(100, candidate.confidence + 10);
      finalCandidate.reasons.push(`URL dijawab HTTP ${probe.httpStatus}`);
    } else if (candidate.sourceType === "bimz_resolver") {
      finalCandidate.confidence = 0;
      finalCandidate.reasons.push(`Validasi gagal: ${probe.reason ?? "tidak diketahui"}`);
    } else {
      // A failed probe is NOT proof of absence (hotlink protection, 403, captcha).
      // Keep the link but lower confidence instead of discarding real evidence.
      finalCandidate.reasons.push(`Probe gagal: ${probe.reason ?? "tidak diketahui"} (link tetap disimpan)`);
      finalCandidate.confidence = Math.max(15, candidate.confidence - 12);
    }
    validated.push(finalCandidate);
  }
  await logAttempt({
    jobId,
    presetId,
    stage: "validation",
    ok: validated.some((c) => c.confidence > 0),
    message: `${validated.length} kandidat divalidasi`,
    evidence: { validated: validated.map((c) => ({ url: c.url, confidence: c.confidence })) },
  });
  stages.push({ stage: "validation", ok: true, message: `${validated.length} kandidat diperiksa` });

  setScanPhase(presetId, "saving");
  await persistLinks(presetId, validated);

  const result = statusFromCandidates(validated);
  const overallStatus = (() => {
    if (result.xml && result.fiveMb) return "COMPLETE";
    if (deep.status === "RATE_LIMITED" && !result.xml && !result.fiveMb) return "RETRY_PENDING";
    if (result.xml) return "XML_FOUND";
    if (result.fiveMb) return "FIVE_MB_FOUND";
    if (validated.length > 0) return "PARTIAL";
    if (resolverStatus === "MISSING_API_KEY" || stages.some((s) => !s.ok && s.stage === "metadata"))
      return "SOURCE_UNAVAILABLE";
    return "RETRY_PENDING";
  })();

  // A rate-limited deep scan means the video was NEVER inspected. It must not
  // consume an attempt nor be presented as "tidak tersedia".
  const rateLimited = deep.status === "RATE_LIMITED";
  const attempts = rateLimited ? preset.scanAttempts : preset.scanAttempts + 1;
  const nextRetryAt = rateLimited
    ? new Date(Date.now() + (deep.retryAfterMs ?? 60_000))
    : overallStatus === "COMPLETE"
      ? null
      : attempts >= config.scan.maxPresetAttempts
        ? null
        : new Date(Date.now() + config.scan.retryBackoffMinutes * 60_000);

  await db
    .update(presets)
    .set({
      xmlStatus: result.xmlStatus,
      fiveMbStatus: result.fiveMbStatus,
      overallStatus,
      confidence: result.confidence,
      xmlUrl: result.xml?.url ?? preset.xmlUrl,
      fiveMbUrl: result.fiveMb?.url ?? preset.fiveMbUrl,
      xmlSource: result.xml ? result.xml.sourceType : preset.xmlSource,
      fiveMbSource: result.fiveMb ? result.fiveMb.sourceType : preset.fiveMbSource,
      scanAttempts: attempts,
      nextRetryAt,
      lastScannedAt: new Date(),
      scanError:
        validated.length === 0
          ? stages.filter((s) => !s.ok).map((s) => s.message).join(" | ").slice(0, 400) || null
          : null,
      updatedAt: new Date(),
    })
    .where(eq(presets.id, presetId));

  endScan(presetId);

  return {
    presetId,
    tiktokId: preset.tiktokId,
    overallStatus,
    xmlStatus: result.xmlStatus,
    fiveMbStatus: result.fiveMbStatus,
    confidence: result.confidence,
    xmlUrl: result.xml?.url ?? preset.xmlUrl ?? null,
    fiveMbUrl: result.fiveMb?.url ?? preset.fiveMbUrl ?? null,
    xmlSource: result.xml ? result.xml.sourceType : (preset.xmlSource ?? null),
    fiveMbSource: result.fiveMb ? result.fiveMb.sourceType : (preset.fiveMbSource ?? null),
    nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : null,
    stages,
  };
}

/* =========================================================================
 * Search engine — ingest from keyword / URL, dedupe, schedule
 * =======================================================================*/

export type SearchIngestReport = {
  keyword: string;
  found: number;
  ingested: number;
  duplicates: number;
  scanned: number;
  providers: { provider: string; ok: boolean; message: string }[];
};

export async function ingestVideoUrl(
  rawUrl: string,
  discoverySource: string,
  options: { scan?: boolean; jobId?: string } = {},
): Promise<{ ok: boolean; preset?: Preset; message: string }> {
  const normalized = normalizeTikTokUrl(rawUrl);
  if (!normalized) return { ok: false, message: "URL TikTok tidak valid" };

  let targetUrl = normalized.url;
  let tiktokId = normalized.tiktokId;

  const { video, providers } = await fetchVideoMetadata(targetUrl);
  if (!video) {
    for (const provider of providers) {
      await logAttempt({
        jobId: options.jobId,
        stage: "metadata",
        provider: provider.provider,
        ok: false,
        message: provider.message,
        statusCode: provider.httpStatus,
      });
    }
    return {
      ok: false,
      message: `Metadata tidak dapat diambil: ${providers.map((p) => `${p.provider}: ${p.message}`).join(" | ")}`,
    };
  }
  if (!tiktokId) tiktokId = video.tiktokId;
  targetUrl = video.videoUrl;

  const preset = await upsertVideo(video, discoverySource);
  if (options.scan !== false) await scanPreset(preset.id, options.jobId);
  return { ok: true, preset, message: `Preset ${video.tiktokId} tersimpan` };
}

export async function runKeywordSearch(keyword: string, count = 12, jobId?: string): Promise<SearchIngestReport> {
  const started = Date.now();
  const { videos, providers } = await keywordSearch(keyword, count);
  const unique = dedupeVideos(videos);

  let ingested = 0;
  let duplicates = 0;
  let scanned = 0;

  if (unique.length === 0) {
    await logAttempt({
      jobId,
      stage: "keyword_search",
      provider: providers[0]?.provider ?? "none",
      ok: false,
      message: providers.map((p) => `${p.provider}: ${p.message}`).join(" | ").slice(0, 400),
      statusCode: providers[0]?.httpStatus,
    });
    return {
      keyword,
      found: 0,
      ingested: 0,
      duplicates: 0,
      scanned: 0,
      providers: providers.map((p) => ({ provider: p.provider, ok: p.ok, message: p.message })),
    };
  }

  for (const video of unique) {
    const existing = await db
      .select({ id: presets.id })
      .from(presets)
      .where(eq(presets.tiktokId, video.tiktokId))
      .limit(1);
    if (existing[0]) {
      duplicates += 1;
      continue;
    }
    const preset = await upsertVideo(video, "keyword_search");
    ingested += 1;
    // Incremental scanning: only the newly found presets get a full deep scan.
    await scanPreset(preset.id, jobId);
    scanned += 1;
  }

  await db.insert(scanAttempts).values({
    jobId: jobId ?? null,
    stage: "keyword_search",
    provider: providers[0]?.provider ?? "tikwm-search",
    ok: ingested > 0,
    message: `"${keyword}": ${unique.length} video, ${ingested} baru, ${duplicates} duplikat (${Date.now() - started}ms)`,
    evidence: { keyword, found: unique.length, ingested, duplicates },
  });

  return {
    keyword,
    found: unique.length,
    ingested,
    duplicates,
    scanned,
    providers: providers.map((p) => ({ provider: p.provider, ok: p.ok, message: p.message })),
  };
}

export async function createScanJob(
  type: string,
  payload: Record<string, unknown>,
  provider?: string,
): Promise<string> {
  const rows = await db
    .insert(scanJobs)
    .values({ type, payload, provider: provider ?? null, status: "queued" })
    .returning({ id: scanJobs.id });
  return rows[0]!.id;
}

export async function finishScanJob(
  jobId: string,
  update: Partial<typeof scanJobs.$inferInsert>,
): Promise<void> {
  await db.update(scanJobs).set(update).where(eq(scanJobs.id, jobId));
}

/**
 * Warms the database from the Bimz preset index (newest presets).
 * Real videos + real comment-derived preset links, deduplicated by tiktok id.
 */
export async function runUpstreamWarmup(limit = 24, jobId?: string): Promise<SearchIngestReport> {
  const { bimzLatest } = await import("./bimz-preset-provider");
  const provider = await bimzLatest(limit);
  const unique = dedupeVideos(provider.videos);

  let ingested = 0;
  let duplicates = 0;
  for (const video of unique) {
    const existing = await db.select({ id: presets.id }).from(presets).where(eq(presets.tiktokId, video.tiktokId)).limit(1);
    if (existing[0]) {
      duplicates += 1;
      // Still refresh metadata: keeps live media gateway URLs + stats up to date.
      await upsertVideo(video, "bimz_index");
      continue;
    }
    await upsertVideo(video, "bimz_index");
    ingested += 1;
  }

  await db.insert(scanAttempts).values({
    jobId: jobId ?? null,
    stage: "bimz_warmup",
    provider: "restapi-bimz",
    ok: ingested > 0,
    message: `Bimz index: ${unique.length} preset, ${ingested} baru, ${duplicates} duplikat`,
    evidence: { found: unique.length, ingested, duplicates },
  });

  return {
    keyword: "bimz:index/latest",
    found: unique.length,
    ingested,
    duplicates,
    scanned: 0,
    providers: [{ provider: provider.provider, ok: provider.ok, message: provider.message }],
  };
}

export async function runRetryQueue(limit = 5): Promise<{ retried: number; results: ScanReport[] }> {
  const due = await db
    .select({ id: presets.id })
    .from(presets)
    .where(
      and(
        inArray(presets.overallStatus, ["NEW", "RETRY_PENDING", "PARTIAL", "SOURCE_UNAVAILABLE"]),
        or(sql`${presets.nextRetryAt} is null`, sql`${presets.nextRetryAt} <= now()`),
        sql`${presets.scanAttempts} < ${config.scan.maxPresetAttempts}`,
      ),
    )
    .orderBy(asc(presets.lastScannedAt))
    .limit(limit);

  const results: ScanReport[] = [];
  for (const row of due) {
    results.push(await scanPreset(row.id));
  }
  return { retried: due.length, results };
}

/* =========================================================================
 * Queries used by the API routes
 * =======================================================================*/

export type PresetListItem = {
  id: string;
  tiktokId: string;
  title: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  playableUrl: string | null;
  playableExpiresAt: string | null;
  embedUrl: string | null;
  videoUrl: string;
  durationSec: number | null;
  creator: string | null;
  creatorName: string | null;
  sound: string | null;
  categorySlug: string | null;
  categoryLabel: string | null;
  xmlStatus: string;
  fiveMbStatus: string;
  overallStatus: string;
  confidence: number;
  xmlUrl: string | null;
  fiveMbUrl: string | null;
  likes: number | null;
  comments: number | null;
  publishedAt: string | null;
  lastScannedAt: string | null;
  hashtags: string[];
  streamUrl?: string;
  thumbProxyUrl?: string;
  scanning?: boolean;
  scanLabel?: string | null;
};

const baseSelect = {
  id: presets.id,
  tiktokId: presets.tiktokId,
  title: presets.title,
  caption: presets.caption,
  thumbnailUrl: presets.thumbnailUrl,
  playableUrl: presets.playableUrl,
  playableExpiresAt: presets.playableExpiresAt,
  embedUrl: presets.embedUrl,
  videoUrl: presets.videoUrl,
  durationSec: presets.durationSec,
  creator: creators.uniqueId,
  creatorName: creators.displayName,
  sound: sounds.title,
  categorySlug: presetCategories.slug,
  categoryLabel: presetCategories.label,
  xmlStatus: presets.xmlStatus,
  fiveMbStatus: presets.fiveMbStatus,
  overallStatus: presets.overallStatus,
  confidence: presets.confidence,
  xmlUrl: presets.xmlUrl,
  fiveMbUrl: presets.fiveMbUrl,
  stats: presets.stats,
  publishedAt: presets.publishedAt,
  lastScannedAt: presets.lastScannedAt,
  hashtags: presets.hashtags,
  createdAt: presets.createdAt,
};

type BaseRow = {
  id: string;
  tiktokId: string;
  title: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  playableUrl: string | null;
  playableExpiresAt: Date | null;
  embedUrl: string | null;
  videoUrl: string;
  durationSec: number | null;
  creator: string | null;
  creatorName: string | null;
  sound: string | null;
  categorySlug: string | null;
  categoryLabel: string | null;
  xmlStatus: string;
  fiveMbStatus: string;
  overallStatus: string;
  confidence: number;
  xmlUrl: string | null;
  fiveMbUrl: string | null;
  stats: { plays?: number | null; likes?: number | null; comments?: number | null; shares?: number | null } | null;
  publishedAt: Date | null;
  lastScannedAt: Date | null;
  hashtags: string[];
  createdAt: Date;
};

function mapRow(row: BaseRow): PresetListItem {
  // A scan in flight must be visible immediately, even before the DB row is
  // updated, so the card shows "Sedang scan preset…" instead of a stale value.
  const scanning = isScanning(row.id);
  return {
    scanning,
    scanLabel: scanning ? scanLabel(row.id) : null,
    id: row.id,
    tiktokId: row.tiktokId,
    title: row.title,
    caption: row.caption,
    thumbnailUrl: row.thumbnailUrl,
    playableUrl: row.playableUrl,
    playableExpiresAt: row.playableExpiresAt ? row.playableExpiresAt.toISOString() : null,
    embedUrl: row.embedUrl,
    videoUrl: row.videoUrl,
    durationSec: row.durationSec,
    creator: row.creator,
    creatorName: row.creatorName,
    sound: row.sound,
    categorySlug: row.categorySlug,
    categoryLabel: row.categoryLabel,
    xmlStatus: row.xmlStatus,
    fiveMbStatus: row.fiveMbStatus,
    overallStatus: scanning ? "SCANNING" : row.overallStatus,
    confidence: row.confidence,
    xmlUrl: row.xmlUrl,
    fiveMbUrl: row.fiveMbUrl,
    likes: row.stats?.likes ?? null,
    comments: row.stats?.comments ?? null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    lastScannedAt: row.lastScannedAt ? row.lastScannedAt.toISOString() : null,
    hashtags: row.hashtags ?? [],
  };
}

export type ListFilters = {
  search?: string;
  creator?: string;
  category?: string;
  filter?: string;
  sort?: string;
  page?: number;
  limit?: number;
  ids?: string[];
};

/** Adds the streaming-gateway URLs so the browser never touches TikTok CDN directly. */
export function withMediaGateway(item: PresetListItem): PresetListItem {
  return {
    ...item,
    streamUrl: `/api/media/video/${item.id}`,
    thumbProxyUrl: item.thumbnailUrl
      ? `/api/media/image?u=${encodeURIComponent(item.thumbnailUrl)}`
      : undefined,
  };
}

export async function listPresets(
  filters: ListFilters,
): Promise<{ items: PresetListItem[]; total: number; page: number; limit: number; hasMore: boolean }> {
  const limit = Math.min(Math.max(filters.limit ?? 12, 1), 48);
  const page = Math.max(filters.page ?? 1, 1);
  const conditions: SQL[] = [];

  if (filters.search) {
    const term = `%${filters.search.replace(/[%_]/g, "")}%`;
    const clause = or(
      ilike(presets.caption, term),
      ilike(presets.title, term),
      ilike(creators.uniqueId, term),
      ilike(sounds.title, term),
    );
    if (clause) conditions.push(clause);
  }
  if (filters.creator) conditions.push(ilike(creators.uniqueId, `${filters.creator.replace(/^@/, "").toLowerCase()}%`));
  if (filters.category && filters.category !== "all") conditions.push(eq(presetCategories.slug, filters.category));

  switch (filters.filter) {
    case "xml":
      conditions.push(eq(presets.xmlStatus, "FOUND"));
      break;
    case "five-mb":
      conditions.push(eq(presets.fiveMbStatus, "FOUND"));
      break;
    case "complete":
      conditions.push(and(eq(presets.xmlStatus, "FOUND"), eq(presets.fiveMbStatus, "FOUND"))!);
      break;
    case "old":
      conditions.push(isNotNull(presets.publishedAt));
      conditions.push(sql`${presets.publishedAt} < now() - interval '180 days'`);
      break;
    case "pending":
      conditions.push(inArray(presets.overallStatus, ["NEW", "RETRY_PENDING", "PARTIAL", "SOURCE_UNAVAILABLE"]));
      break;
    default:
      break;
  }

  const orderBy = (() => {
    switch (filters.sort) {
      case "likes":
        return [desc(sql`coalesce((${presets.stats} ->> 'likes')::numeric, 0)`)];
      case "comments":
        return [desc(sql`coalesce((${presets.stats} ->> 'comments')::numeric, 0)`)];
      case "oldest":
        return [asc(sql`coalesce(${presets.publishedAt}, ${presets.createdAt})`)];
      case "confidence":
        return [desc(presets.confidence)];
      case "trending":
        return [
          desc(
            sql`coalesce((${presets.stats} ->> 'likes')::numeric, 0) + coalesce((${presets.stats} ->> 'comments')::numeric, 0) * 3`,
          ),
        ];
      default:
        return [desc(sql`coalesce(${presets.publishedAt}, ${presets.createdAt})`)];
    }
  })();

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select(baseSelect)
    .from(presets)
    .leftJoin(creators, eq(creators.id, presets.creatorId))
    .leftJoin(sounds, eq(sounds.id, presets.soundId))
    .leftJoin(presetCategories, eq(presetCategories.id, presets.categoryId))
    .where(where)
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset((page - 1) * limit);

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(presets)
    .leftJoin(creators, eq(creators.id, presets.creatorId))
    .leftJoin(sounds, eq(sounds.id, presets.soundId))
    .leftJoin(presetCategories, eq(presetCategories.id, presets.categoryId))
    .where(where);

  const total = totalRows[0]?.count ?? 0;
  const hasMore = rows.length > limit;
  return {
    items: (hasMore ? rows.slice(0, limit) : rows)
      .map((row) => mapRow(row as BaseRow))
      .map(withMediaGateway),
    total,
    page,
    limit,
    hasMore,
  };
}

export async function getPresetDetail(id: string): Promise<{
  preset: PresetListItem;
  links: {
    id: string;
    kind: string;
    url: string;
    sourceType: string;
    hostLabel: string | null;
    confidence: number;
    verified: boolean;
    httpStatus: number | null;
    contentType: string | null;
    createdAt: string;
  }[];
  attempts: { stage: string; provider: string | null; ok: boolean; message: string; createdAt: string }[];
} | null> {
  const rows = await db
    .select(baseSelect)
    .from(presets)
    .leftJoin(creators, eq(creators.id, presets.creatorId))
    .leftJoin(sounds, eq(sounds.id, presets.soundId))
    .leftJoin(presetCategories, eq(presetCategories.id, presets.categoryId))
    .where(eq(presets.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const links = await db
    .select()
    .from(presetLinks)
    .where(eq(presetLinks.presetId, id))
    .orderBy(desc(presetLinks.confidence));

  const attempts = await db
    .select({
      stage: scanAttempts.stage,
      provider: scanAttempts.provider,
      ok: scanAttempts.ok,
      message: scanAttempts.message,
      createdAt: scanAttempts.createdAt,
    })
    .from(scanAttempts)
    .where(eq(scanAttempts.presetId, id))
    .orderBy(desc(scanAttempts.createdAt))
    .limit(25);

  return {
    preset: withMediaGateway(mapRow(row as BaseRow)),
    links: links.map((link) => ({
      id: link.id,
      kind: link.kind,
      url: link.url,
      sourceType: link.sourceType,
      hostLabel: link.hostLabel,
      confidence: link.confidence,
      verified: link.verified,
      httpStatus: link.httpStatus,
      contentType: link.contentType,
      createdAt: link.createdAt.toISOString(),
    })),
    attempts: attempts.map((a) => ({ ...a, message: a.message ?? "", createdAt: a.createdAt.toISOString() })),
  };
}

export async function categoryCounts(): Promise<{ slug: string; label: string; labelCn: string | null; count: number }[]> {
  await ensureCategories();
  const cats = await db.select().from(presetCategories).orderBy(asc(presetCategories.sortOrder));
  const counts = await db
    .select({ categoryId: presets.categoryId, count: sql<number>`count(*)::int` })
    .from(presets)
    .groupBy(presets.categoryId);
  const map = new Map(counts.map((c) => [c.categoryId, c.count]));
  return cats.map((c) => ({
    slug: c.slug,
    label: c.label,
    labelCn: c.labelCn,
    count: map.get(c.id) ?? 0,
  }));
}

export async function platformStats(): Promise<{
  presets: number;
  creators: number;
  withXml: number;
  withFiveMb: number;
  complete: number;
  pending: number;
  reviews: number;
  chatMessages: number;
}> {
  const [row] = await db.execute<{
    presets: number;
    creators: number;
    with_xml: number;
    with_five_mb: number;
    complete: number;
    pending: number;
    reviews: number;
    chat_messages: number;
  }>(sql`
    select
      (select count(*)::int from spaceprs.presets) as presets,
      (select count(*)::int from spaceprs.creators) as creators,
      (select count(*)::int from spaceprs.presets where xml_status = 'FOUND') as with_xml,
      (select count(*)::int from spaceprs.presets where five_mb_status = 'FOUND') as with_five_mb,
      (select count(*)::int from spaceprs.presets where overall_status = 'COMPLETE') as complete,
      (select count(*)::int from spaceprs.presets where overall_status in ('NEW','RETRY_PENDING','PARTIAL','SOURCE_UNAVAILABLE')) as pending,
      (select count(*)::int from spaceprs.reviews) as reviews,
      (select count(*)::int from spaceprs.global_chat_messages) as chat_messages
  `).then((res) => res.rows);

  return {
    presets: Number(row?.presets ?? 0),
    creators: Number(row?.creators ?? 0),
    withXml: Number(row?.with_xml ?? 0),
    withFiveMb: Number(row?.with_five_mb ?? 0),
    complete: Number(row?.complete ?? 0),
    pending: Number(row?.pending ?? 0),
    reviews: Number(row?.reviews ?? 0),
    chatMessages: Number(row?.chat_messages ?? 0),
  };
}

export function sanitizeSearchTerm(term: string): string {
  return sanitizeText(term, 120);
}

export { gte };
