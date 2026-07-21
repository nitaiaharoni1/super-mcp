import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Required for the Cloud Run / container image (apps/web/Dockerfile).
  output: "standalone",
  // Workspace package — transpile so Next can resolve ESM dist + subpath exports.
  transpilePackages: ["@super-mcp/shared"],
};

export default nextConfig;
