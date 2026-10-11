import { FeedbackView } from "@/components/feedback-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ulasan & Laporan Kendala — 预设空间 | Preset Space",
  description: "Kirim ulasan, laporkan kendala, dan baca balasan developer di Kontak Masuk.",
};

export default function UlasanPage() {
  return <FeedbackView />;
}
