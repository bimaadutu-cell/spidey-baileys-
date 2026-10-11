import { DiscoverView } from "@/components/discover-view";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; filter?: string }>;
}) {
  const params = await searchParams;
  return <DiscoverView initialSort={params.sort ?? "latest"} initialFilter={params.filter ?? ""} />;
}
