/**
 * In-memory scan progress registry.
 *
 * While `scanPreset` is running, the preset id is registered here so the API
 * can report `SCANNING` ("Sedang scan preset…") to the UI in real time and
 * flip back to the real result the moment the scan finishes.
 *
 * The database row is still the source of truth — this only covers the window
 * where a scan is in flight.
 */

export type ScanPhase =
  | "queued"
  | "deep_scan"
  | "metadata"
  | "caption"
  | "comments"
  | "related_search"
  | "validation"
  | "saving";

export type ActiveScan = {
  presetId: string;
  tiktokId: string | null;
  phase: ScanPhase;
  label: string;
  startedAt: number;
};

const globalForScan = globalThis as typeof globalThis & {
  __presetSpaceScans?: Map<string, ActiveScan>;
};

const active: Map<string, ActiveScan> = globalForScan.__presetSpaceScans ?? new Map();
globalForScan.__presetSpaceScans = active;

const PHASE_LABEL: Record<ScanPhase, string> = {
  queued: "Menunggu giliran scan…",
  deep_scan: "Sedang scan preset…",
  metadata: "Mengambil metadata video…",
  caption: "Menganalisis caption…",
  comments: "Memeriksa komentar…",
  related_search: "Mencari sumber terkait…",
  validation: "Memvalidasi link preset…",
  saving: "Menyimpan hasil…",
};

export function beginScan(presetId: string, tiktokId: string | null): void {
  active.set(presetId, {
    presetId,
    tiktokId,
    phase: "queued",
    label: PHASE_LABEL.queued,
    startedAt: Date.now(),
  });
}

export function setScanPhase(presetId: string, phase: ScanPhase): void {
  const current = active.get(presetId);
  if (!current) return;
  active.set(presetId, { ...current, phase, label: PHASE_LABEL[phase] });
}

export function endScan(presetId: string): void {
  active.delete(presetId);
}

export function isScanning(presetId: string): boolean {
  const entry = active.get(presetId);
  if (!entry) return false;
  // Safety valve: never report a stuck scan forever.
  if (Date.now() - entry.startedAt > 5 * 60_000) {
    active.delete(presetId);
    return false;
  }
  return true;
}

export function scanLabel(presetId: string): string | null {
  return active.get(presetId)?.label ?? null;
}

export function activeScanIds(): string[] {
  const now = Date.now();
  for (const [id, entry] of active) {
    if (now - entry.startedAt > 5 * 60_000) active.delete(id);
  }
  return [...active.keys()];
}

export function activeScans(): ActiveScan[] {
  activeScanIds();
  return [...active.values()];
}
