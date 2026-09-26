import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // lucide-react ships 6,329 icons; this page imports 12. Without this, the
    // dev build pulls the whole barrel file on every reload.
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
