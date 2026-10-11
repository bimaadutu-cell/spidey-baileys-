"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  avatarKey: string;
  role: string;
};

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await res.json()) as { user: SessionUser | null };
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { user, loading, reload, setUser };
}

export function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Paginated list fetcher with abort + dedupe of in-flight requests. */
export function usePagedQuery<T>(endpoint: string, enabled = true) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const seen = useRef(new Set<string>());

  const load = useCallback(
    async (nextPage: number, replace = false) => {
      if (!enabled) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${nextPage}`;
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
        const data = (await res.json()) as {
          ok: boolean;
          items?: (T & { id: string })[];
          total?: number;
          hasMore?: boolean;
          locked?: boolean;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          if (data.locked) setLocked(true);
          setError(data.error ?? "Gagal memuat data");
          setHasMore(false);
          return;
        }
        const fresh = (data.items ?? []).filter((item) => {
          if (seen.current.has(item.id)) return false;
          seen.current.add(item.id);
          return true;
        });
        setTotal(data.total ?? 0);
        setHasMore(Boolean(data.hasMore));
        setItems((prev) => (replace ? fresh : [...prev, ...fresh]));
        setLocked(false);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError("Koneksi gagal. Coba lagi.");
      } finally {
        setLoading(false);
      }
    },
    [endpoint, enabled],
  );

  useEffect(() => {
    seen.current = new Set();
    setItems([]);
    setPage(1);
    void load(1, true);
  }, [load]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore || locked) return;
    const next = page + 1;
    setPage(next);
    void load(next);
  }, [hasMore, load, loading, page, locked]);

  return { items, total, hasMore, loading, error, locked, loadMore, refresh: () => load(1, true) };
}

export { avatarSvg } from "@/lib/avatars";

export function useLocalFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ps:favorites");
      if (raw) setFavorites(JSON.parse(raw) as string[]);
    } catch { setFavorites([]); }
  }, []);
  const toggle = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id];
      window.localStorage.setItem("ps:favorites", JSON.stringify(next));
      return next;
    });
  }, []);
  return { favorites, toggle };
}


/**
 * Polls which presets are currently being scanned so cards can flip to
 * "Sedang scan preset…" live and back to the result when finished.
 */
export function useActiveScans(enabled = true) {
  const [ids, setIds] = useState<Record<string, string>>({});
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch("/api/scan/active", { cache: "no-store" });
        const data = (await res.json()) as {
          ok: boolean;
          count: number;
          scans?: { presetId: string; label: string }[];
        };
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const scan of data.scans ?? []) map[scan.presetId] = scan.label;
        setIds(map);
        setCount(data.count ?? 0);
        // Poll fast while scanning, slow when idle.
        timer = setTimeout(tick, data.count > 0 ? 1500 : 6000);
      } catch {
        if (alive) timer = setTimeout(tick, 8000);
      }
    };

    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled]);

  return { scanningIds: ids, scanningCount: count };
}
