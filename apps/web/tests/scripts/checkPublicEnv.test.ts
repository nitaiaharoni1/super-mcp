import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
// @ts-expect-error -- build tooling, deliberately plain .mjs so the Dockerfile runs it with bare node
import { publicEnvProblems, publicEnvWarnings } from "../../src/scripts/checkPublicEnv.mjs";

const run = promisify(execFile);
const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/scripts/checkPublicEnv.mjs",
);

/*
 * Run the guard exactly as apps/web/Dockerfile does: a fresh process with only the
 * variables under test. PATH and NODE_ENV are the floor rather than a convenience, because
 * Next's ProcessEnv type makes NODE_ENV required and node needs PATH to start at all.
 */
async function runGuard(
  publicEnv: Record<string, string>,
): Promise<{ code: number; stderr: string }> {
  const env = { PATH: process.env.PATH, NODE_ENV: "production" as const, ...publicEnv };
  try {
    const { stderr } = await run(process.execPath, [SCRIPT], { env });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: e.code ?? 1, stderr: e.stderr ?? "" };
  }
}

const GOOD = {
  NEXT_PUBLIC_MCP_URL: "https://example.com/mcp",
  NEXT_PUBLIC_SITE_URL: "https://example.com",
  NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
};

describe("public env guard", () => {
  it("passes a fully configured deploy build", () => {
    expect(publicEnvProblems(GOOD)).toEqual([]);
    expect(publicEnvWarnings(GOOD)).toEqual([]);
  });

  it("names every missing variable rather than the first", () => {
    const problems = publicEnvProblems({});

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("NEXT_PUBLIC_MCP_URL");
    expect(problems[1]).toContain("NEXT_PUBLIC_SITE_URL");
  });

  it("rejects the localhost defaults that a forgotten build arg falls back to", () => {
    const problems = publicEnvProblems({
      ...GOOD,
      NEXT_PUBLIC_MCP_URL: "http://localhost:8787/mcp",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    });

    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/development host/);
    expect(problems[1]).toMatch(/development host/);
  });

  it("rejects a plaintext or malformed origin", () => {
    expect(publicEnvProblems({ ...GOOD, NEXT_PUBLIC_SITE_URL: "http://example.com" })[0]).toMatch(
      /must be https/,
    );
    expect(publicEnvProblems({ ...GOOD, NEXT_PUBLIC_SITE_URL: "example.com" })[0]).toMatch(
      /not an absolute URL/,
    );
  });

  it("treats whitespace as unset, because a blank substitution arrives as spaces", () => {
    expect(publicEnvProblems({ ...GOOD, NEXT_PUBLIC_MCP_URL: "   " })[0]).toContain("is not set");
  });

  it("warns about missing analytics without blocking the build", () => {
    const env = { ...GOOD, NEXT_PUBLIC_POSTHOG_KEY: "" };

    expect(publicEnvProblems(env)).toEqual([]);
    expect(publicEnvWarnings(env)[0]).toMatch(/no analytics/);
  });
});

/*
 * The functions above being correct proves nothing about whether the Dockerfile's
 * `node checkPublicEnv.mjs` ever calls them. If the entrypoint check fails to match, the
 * script exits 0 without running and the guard is silently void, which is the exact
 * failure it was written to prevent. So run it the way the image does.
 */
describe("the guard as the Dockerfile invokes it", () => {
  it("exits non-zero and explains itself when values are missing", async () => {
    const { code, stderr } = await runGuard({});

    expect(code).toBe(1);
    expect(stderr).toContain("Refusing to build the web image");
    expect(stderr).toContain("NEXT_PUBLIC_MCP_URL");
    expect(stderr).toContain("cloudbuild.web.yaml");
  });

  it("exits zero on a fully configured build", async () => {
    const { code } = await runGuard(GOOD);

    expect(code).toBe(0);
  });

  it("rejects the localhost fallback rather than building it in", async () => {
    const { code, stderr } = await runGuard({
      ...GOOD,
      NEXT_PUBLIC_MCP_URL: "http://localhost:8787/mcp",
    });

    expect(code).toBe(1);
    expect(stderr).toMatch(/development host/);
  });
});
