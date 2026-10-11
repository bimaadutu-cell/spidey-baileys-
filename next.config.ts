import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Vercel: allow TikTok/Bimz media through the edge instead of being blocked
  // by hot-link protection.
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "**.tiktokcdn**" },
      { protocol: "https", hostname: "**.tiktok.com" },
      { protocol: "https", hostname: "**.ibyteimg.com" },
      { protocol: "https", hostname: "**.byteoversea.com" },
      { protocol: "https", hostname: "**.tikwm.com" },
    ],
  },
  // Baileys + sharp are native/CJS heavy: keep them out of the bundler so their
  // optional dependencies resolve at runtime instead of breaking the build.
  serverExternalPackages: ["@whiskeysockets/baileys", "sharp", "jimp", "link-preview-js"],
  // Media gateway streams large bodies; keep the connection open long enough.
  experimental: {
    proxyTimeout: 120_000,
  },
  // Never let a CDN cache API/streaming responses.
  headers: async () => [
    {
      source: "/api/:path*",
      headers: [
        { key: "Cache-Control", value: "no-store, must-revalidate" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
  ],
};

export default nextConfig;
