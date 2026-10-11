import { PremiumAlight } from "@/components/premium-alight";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "PremiumAlight — 预设空间 | Preset Space",
  description:
    "Aktifkan Alight Motion Premium langsung dari Preset Space lewat RestAPI Bimz. Terbuka setelah mengirim 3 ulasan bintang 5 ke developer.",
};

export default function PremiumAlightPage() {
  return <PremiumAlight />;
}
