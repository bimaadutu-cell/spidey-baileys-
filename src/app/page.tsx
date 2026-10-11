import { Suspense } from "react";
import { HomeView } from "@/components/home-view";
import { PresetSkeletonGrid } from "@/components/preset";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; favorites?: string }>;
}) {
  const params = await searchParams;
  return (
    <Suspense fallback={<PresetSkeletonGrid />}>
      <HomeView initialQuery={params.q ?? ""} favoritesOnly={params.favorites === "1"} />
    </Suspense>
  );
}
