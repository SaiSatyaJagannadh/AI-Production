import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',  // This exports static HTML/JS files
  // Emits out/product/index.html instead of out/product.html, so the FastAPI
  // StaticFiles mount can serve /product (it resolves directories, not .html).
  trailingSlash: true,
  images: {
    unoptimized: true  // Required for static export
  }
};

export default nextConfig;