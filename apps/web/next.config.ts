import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace package — transpile so Next can resolve ESM dist + subpath exports.
  transpilePackages: ["@super-mcp/shared"],
};

export default nextConfig;
