import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell";
import { FpsMeter, PerfTuner } from "@/components/perf";

export const metadata: Metadata = {
  title: "预设空间 | Preset Space — Find it. Preset it. Create it.",
  description:
    "Platform penemuan preset Alight Motion dari konten TikTok: pencarian, deep preset scanner, deteksi link XML & 5MB, video feed, dan Global Chat komunitas. Dikembangkan oleh BimzOfficial ✓",
  applicationName: "Preset Space",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Preset Space" },
  icons: {
    icon: [{ url: "/icon-512.png", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/icon-512.png", sizes: "512x512", type: "image/png" }],
  },
  openGraph: {
    title: "预设空间 | Preset Space",
    description: "Find it. Preset it. Create it. — by BimzOfficial ✓",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased">
        <PerfTuner />
        <FpsMeter />
        <div className="particle-field" aria-hidden />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
