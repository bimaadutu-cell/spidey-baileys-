import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "./shell";
import { FpsMeter, PerfTuner } from "./perf";
import { WelcomeSplash } from "@/components/welcome-splash";

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
    <html lang="id" suppressHydrationWarning>
      <head>
        {/* Sesi yang sudah melihat splash tidak melihatnya lagi (jalan sebelum paint). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(sessionStorage.getItem('ps_welcome')==='1')document.documentElement.setAttribute('data-welcomed','1')}catch(e){}",
          }}
        />
      </head>
      <body className="antialiased">
        <WelcomeSplash />
        <PerfTuner />
        <FpsMeter />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
