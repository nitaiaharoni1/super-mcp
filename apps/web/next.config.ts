import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Required for the Cloud Run / container image (apps/web/Dockerfile).
  output: "standalone",
  // Workspace package — transpile so Next can resolve ESM dist + subpath exports.
  transpilePackages: ["@super-mcp/shared"],
  /*
   * `next dev` and `next build` both write to `.next` by default, so building
   * while a dev server is running overwrites the module graph the dev server is
   * serving from. The browser then dies with a bare
   * `__webpack_modules__[moduleId] is not a function` and the only cure is
   * deleting `.next` and restarting, which looks like a code bug and is not one.
   *
   * `pnpm build:check` sets NEXT_DIST_DIR so a verification build lands
   * somewhere else and leaves the running dev server alone. Deploys leave the
   * variable unset and still build into `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
