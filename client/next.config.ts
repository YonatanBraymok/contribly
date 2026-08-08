import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone so the production Docker stage ships a minimal
  // server without a second `npm install`.
  output: "standalone",
};

export default nextConfig;
