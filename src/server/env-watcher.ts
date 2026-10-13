/**
 * Live env watcher.
 *
 * Reads the env files a developer edits (`.env`, `.env.local`, `.env.production`
 * and the plain `env` file shipped in this repo), applies the values to
 * `process.env` and notifies listeners when a database URL changes — no restart
 * required.
 *
 * Precedence (lowest -> highest): env, .env, .env.production, .env.local.
 * Real platform variables (Railway/Vercel dashboard) are the baseline: a key is
 * only overridden by a file if the file defined it (or it was set by us earlier).
 */
import fs from "node:fs";
import path from "node:path";

const WATCHED_FILES = ["env", ".env", ".env.production", ".env.local"];
const WATCHED_KEYS = ["NEON_DATABASE_URL", "DATABASE_URL"] as const;
const POLL_MS = 2000;

type Listener = (change: { key: string; value: string }) => void;

type WatcherState = {
  started: boolean;
  listeners: Set<Listener>;
  fileSignatures: Map<string, string>;
  /** keys we have written into process.env from files (so we may overwrite them again) */
  managedKeys: Set<string>;
  /** values of process.env before we first overrode them (restored when a key is removed from files) */
  originalValues: Map<string, string | undefined>;
  timer?: NodeJS.Timeout;
  watchers: fs.FSWatcher[];
};

const g = globalThis as typeof globalThis & { __presetSpaceEnvWatcher?: WatcherState };
const state: WatcherState = (g.__presetSpaceEnvWatcher ??= {
  started: false,
  listeners: new Set(),
  fileSignatures: new Map(),
  managedKeys: new Set(),
  originalValues: new Map(),
  watchers: [],
});

/** Minimal dotenv-compatible parser (no dependency on file location). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      // strip trailing inline comment ("value # comment")
      value = value.replace(/\s+#.*$/, "");
    }
    out[key] = value.trim();
  }
  return out;
}

function resolveFiles(): string[] {
  const roots = Array.from(new Set([process.cwd(), path.resolve(process.cwd(), ".."), __dirnameSafe()]));
  const found: string[] = [];
  for (const name of WATCHED_FILES) {
    for (const root of roots) {
      const full = path.join(root, name);
      if (!found.includes(full)) found.push(full);
    }
  }
  return found;
}

function __dirnameSafe(): string {
  try {
    return path.resolve(process.cwd());
  } catch {
    return ".";
  }
}

function signature(file: string): string {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return "missing";
  }
}

function readMerged(): Record<string, string> {
  const merged: Record<string, string> = {};
  // WATCHED_FILES order = increasing priority; within one name the cwd copy wins.
  for (const name of WATCHED_FILES) {
    const candidates = resolveFiles().filter((f) => path.basename(f) === name).reverse();
    for (const file of candidates) {
      try {
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
        Object.assign(merged, parseEnv(fs.readFileSync(file, "utf8")));
      } catch {
        /* unreadable file: ignore, keep previous values */
      }
    }
  }
  return merged;
}

export function reloadEnv(reason = "manual"): string[] {
  const merged = readMerged();
  const changed: string[] = [];

  for (const [key, value] of Object.entries(merged)) {
    if (value === "") continue;
    const current = process.env[key];
    if (current === value) continue;
    if (!state.managedKeys.has(key)) state.originalValues.set(key, current);
    state.managedKeys.add(key);
    process.env[key] = value;
    changed.push(key);
  }

  // A key that we managed and that was removed from every file goes back to its original value.
  for (const key of Array.from(state.managedKeys)) {
    if (key in merged && merged[key] !== "") continue;
    const original = state.originalValues.get(key);
    state.managedKeys.delete(key);
    state.originalValues.delete(key);
    if (process.env[key] === original) continue;
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
    changed.push(key);
  }

  if (changed.length) {
    console.log(`[env-watcher] reloaded (${reason}): ${changed.join(", ")}`);
    for (const key of changed) {
      if ((WATCHED_KEYS as readonly string[]).includes(key)) {
        const value = (process.env[key] ?? "").trim();
        for (const listener of state.listeners) {
          try {
            listener({ key, value });
          } catch (error) {
            console.error("[env-watcher] listener failed:", error);
          }
        }
      }
    }
  }
  return changed;
}

function checkFiles(reason: string) {
  let dirty = false;
  for (const file of resolveFiles()) {
    const sig = signature(file);
    if (state.fileSignatures.get(file) !== sig) {
      state.fileSignatures.set(file, sig);
      dirty = true;
    }
  }
  if (dirty) reloadEnv(reason);
}

/** Subscribe to NEON_DATABASE_URL / DATABASE_URL changes. Returns an unsubscribe function. */
export function onDatabaseUrlChange(listener: Listener): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/** Current effective database URL (NEON_DATABASE_URL wins over DATABASE_URL). */
export function currentDatabaseUrl(): string {
  return (process.env.NEON_DATABASE_URL ?? "").trim() || (process.env.DATABASE_URL ?? "").trim();
}

export function startEnvWatcher(): void {
  if (state.started) return;
  state.started = true;

  // Prime signatures + load once.
  for (const file of resolveFiles()) state.fileSignatures.set(file, signature(file));
  reloadEnv("startup");

  // 1) fs.watch on the directories (instant on most hosts) ...
  const dirs = Array.from(new Set(resolveFiles().map((f) => path.dirname(f))));
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
        if (!filename || WATCHED_FILES.includes(String(filename))) checkFiles("fs.watch");
      });
      watcher.on("error", () => undefined);
      state.watchers.push(watcher);
    } catch {
      /* some container filesystems do not support watch: polling below covers it */
    }
  }

  // 2) ... plus polling as a safety net (Docker volumes, NFS, editors that replace files).
  state.timer = setInterval(() => checkFiles("poll"), POLL_MS);
  state.timer.unref?.();

  console.log("[env-watcher] watching env files for DATABASE_URL changes");
}
