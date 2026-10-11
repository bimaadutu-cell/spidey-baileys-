import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "预设空间 | Preset Space",
    short_name: "Preset Space",
    description: "Find it. Preset it. Create it. — Penemuan preset Alight Motion dari konten TikTok.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#050505",
    theme_color: "#050505",
    categories: ["productivity", "social", "entertainment"],
    icons: [
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Discover", url: "/discover" },
      { name: "Favorites", url: "/?favorites=1" },
    ],
  };
}
