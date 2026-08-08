import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone so the production Docker stage ships a minimal
  // server without a second `npm install`.
  output: "standalone",

  images: {
    // GitHub avatars, shown once a user signs in. Rendered with `unoptimized`
    // so no sharp binary is needed in the standalone image — they arrive
    // already sized and CDN-cached, so there is nothing to gain by resizing.
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
