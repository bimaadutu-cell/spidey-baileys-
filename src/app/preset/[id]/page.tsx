import Link from "next/link";
import { notFound } from "next/navigation";
import { getPresetDetail } from "@/server/services/preset-store";
import { STATUS_LABEL } from "@/components/preset";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  metadata: "Tahap A — Metadata video",
  caption: "Tahap B — Analisis caption",
  comments: "Tahap C — Analisis komentar",
  related_search: "Tahap D — Pencarian ulang",
  bimz_resolver: "Tahap D — Resolver Bimz",
  validation: "Tahap E — Validasi URL",
  keyword_search: "Pencarian keyword",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default async function PresetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getPresetDetail(id);
  if (!detail) notFound();
  // Count a view (TikTok-style) — non-blocking
  try {
    const { recordView } = await import("@/server/services/social");
    await recordView(id, null);
  } catch {
    /* ignore */
  }

  const { preset, links, attempts } = detail;
  const xmlLink = links.find((link) => link.kind === "xml");
  const fiveMbLink = links.find((link) => link.kind === "five_mb");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="card-3d overflow-hidden rounded-[28px]">
        <div className="relative aspect-[9/16] w-full bg-black">
          <video
            src={`/api/media/video/${preset.id}`}
            poster={preset.thumbProxyUrl ?? preset.thumbnailUrl ?? undefined}
            controls
            playsInline
                        loop
            preload="metadata"
            className="h-full w-full object-cover"
          >
            <track kind="captions" />
          </video>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            <span className="chip">Confidence {preset.confidence}%</span>
            {preset.categoryLabel ? <span className="chip">{preset.categoryLabel}</span> : null}
            {preset.durationSec ? <span className="chip">{preset.durationSec}s</span> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {xmlLink || preset.xmlUrl ? (
              <a href={preset.xmlUrl || xmlLink?.url || "#"} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-primary !text-xs" title="XML dengan suara otomatis">
                Gunakan XML
              </a>
            ) : (
              <span className="btn !text-xs !text-slate-400">XML belum ditemukan</span>
            )}
            {fiveMbLink ? (
              <a href={fiveMbLink.url} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-primary !text-xs">
                Gunakan 5MB
              </a>
            ) : (
              <span className="btn !text-xs !text-slate-400">5MB belum ditemukan</span>
            )}
          </div>
          <a href={preset.videoUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn w-full !text-xs">
            Sumber TikTok ↗
          </a>
        </div>
      </div>

      <div className="space-y-5">
        <header>
          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Detail Preset</p>
          <h1 className="mt-2 text-2xl font-bold leading-snug neon-text">
            {preset.title ?? preset.caption ?? "Preset Alight Motion"}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Kreator:{" "}
            {preset.creator ? (
              <a href={`https://www.tiktok.com/@${preset.creator}`} target="_blank" rel="noopener noreferrer nofollow" className="text-slate-200 underline">
                @{preset.creator}
              </a>
            ) : (
              "tidak diketahui"
            )}
            {preset.creatorName ? ` · ${preset.creatorName}` : ""}
          </p>
          {preset.sound ? <p className="text-sm text-slate-400">Sound: {preset.sound}</p> : null}
        </header>

        <section className="card-3d rounded-3xl p-5">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Status scanner</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {[
              { label: "Status keseluruhan", value: STATUS_LABEL[preset.overallStatus] ?? preset.overallStatus },
              { label: "XML", value: `${STATUS_LABEL[preset.xmlStatus] ?? preset.xmlStatus} · sumber ${preset.xmlStatus === "FOUND" ? (xmlLink?.sourceType ?? "-") : "-"}` },
              { label: "5MB", value: `${STATUS_LABEL[preset.fiveMbStatus] ?? preset.fiveMbStatus} · sumber ${preset.fiveMbStatus === "FOUND" ? (fiveMbLink?.sourceType ?? "-") : "-"}` },
              { label: "Scan terakhir", value: formatDate(preset.lastScannedAt) },
              { label: "Publikasi", value: formatDate(preset.publishedAt) },
              { label: "Statistik", value: `♥ ${preset.likes ?? "—"} · 💬 ${preset.comments ?? "—"}` },
            ].map((row) => (
              <div key={row.label} className="rounded-2xl border border-white/10 bg-white/4 p-3">
                <dt className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{row.label}</dt>
                <dd className="mt-1 text-sm text-slate-200">{row.value}</dd>
              </div>
            ))}
          </dl>
          {preset.caption ? <p className="mt-4 whitespace-pre-wrap text-sm text-slate-300">{preset.caption}</p> : null}
        </section>

        <section className="card-3d rounded-3xl p-5">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Link terdeteksi</h2>
          {links.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              Belum ada link preset yang ditemukan. Preset ditandai &ldquo;belum terverifikasi&rdquo; dan dijadwalkan
              untuk scan ulang — tidak ada URL palsu yang dibuat.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {links.map((link) => (
                <li key={link.id} className="rounded-2xl border border-white/10 bg-white/4 p-3 text-xs">
                  <p className="text-slate-200">
                    <span className="font-semibold uppercase">{link.kind === "xml" ? "XML" : "5MB"}</span> · {link.hostLabel ?? "host tidak dikenal"} ·
                    confidence {link.confidence}% · sumber {link.sourceType}
                    {link.httpStatus ? ` · HTTP ${link.httpStatus}` : ""}
                  </p>
                  <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block break-all text-slate-400 underline">
                    {link.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card-3d rounded-3xl p-5">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Riwayat scan</h2>
          <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto text-[11px]">
            {attempts.map((attempt, index) => (
              <li key={`${attempt.createdAt}-${index}`} className="rounded-lg border border-white/8 bg-white/4 px-2.5 py-1.5">
                <span className={attempt.ok ? "text-emerald-200" : "text-red-300"}>{attempt.ok ? "OK" : "GAGAL"}</span>{" "}
                <span className="text-slate-300">{STAGE_LABEL[attempt.stage] ?? attempt.stage}</span>
                <span className="text-slate-500"> · {attempt.provider ?? "-"}</span>
                <p className="text-slate-500">{attempt.message}</p>
              </li>
            ))}
            {attempts.length === 0 ? <li className="text-slate-500">Belum ada riwayat scan.</li> : null}
          </ul>
          <Link href="/discover" className="btn mt-4 !text-xs">
            ← Kembali ke feed
          </Link>
        </section>
      </div>
    </div>
  );
}
