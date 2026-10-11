"use client";

import Link from "next/link";
import { VideoFeed } from "./video-feed";
import { PresetSkeletonGrid } from "./preset";
import { usePagedQuery, useSession } from "./hooks";
import type { PresetItem } from "./preset";

export function DiscoverView({ initialSort, initialFilter }: { initialSort: string; initialFilter: string }) {
  const { user } = useSession();
  const { items, hasMore, loading, error, locked, loadMore } = usePagedQuery<PresetItem>(
    `/api/discover?sort=${initialSort}&filter=${initialFilter}&limit=6`,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold neon-text">Discover</h1>
          <p className="mt-1 text-sm text-slate-400">
            Scroll vertikal seperti feed Instagram. Video aktif diputar mute otomatis; suara bisa dinyalakan manual.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/discover?sort=trending" className="chip" data-active={initialSort === "trending"}>
            Trending
          </Link>
          <Link href="/discover?sort=latest" className="chip" data-active={initialSort === "latest"}>
            Terbaru
          </Link>
          <Link href="/discover?filter=xml" className="chip" data-active={initialFilter === "xml"}>
            XML
          </Link>
          <Link href="/discover?filter=complete" className="chip" data-active={initialFilter === "complete"}>
            Lengkap
          </Link>
        </div>
      </header>

      {loading && items.length === 0 ? (
        <PresetSkeletonGrid count={3} />
      ) : (
        <VideoFeed
          items={items}
          loading={loading}
          hasMore={hasMore}
          loadMore={loadMore}
          locked={locked}
          authenticated={Boolean(user)}
          error={error}
        />
      )}
    </div>
  );
}
