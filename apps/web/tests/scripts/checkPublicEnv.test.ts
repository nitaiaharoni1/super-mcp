import { describe, expect, it } from "vitest";
// @ts-expect-error -- build tooling, deliberately plain .mjs so the Dockerfile runs it with bare node
import { publicEnvProblems, publicEnvWarnings } from "../../src/scripts/checkPublicEnv.mjs";

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
