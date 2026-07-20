import { describe, expect, it } from "vitest";
import { buildMcpServerInstructions } from "../../src/mcp/server.js";
import {
  BASKET_PROTOCOL_ID,
  parseProtocolIdentityLine,
  protocolIdentityLine,
  resolveBuildRevision,
  validateMcpBasketContract,
} from "../../src/mcp/protocolIdentity.js";

describe("protocol identity", () => {
  it("falls back to dev when no CI revision is set", () => {
    expect(resolveBuildRevision({})).toBe("dev");
    expect(protocolIdentityLine({})).toContain(`protocol=${BASKET_PROTOCOL_ID}`);
    expect(protocolIdentityLine({})).toContain("build=dev");
  });

  it("prefers SUPER_MCP_BUILD_REVISION", () => {
    expect(
      resolveBuildRevision({ SUPER_MCP_BUILD_REVISION: "abc123", GIT_COMMIT_SHA: "other" }),
    ).toBe("abc123");
  });

  it("parses the identity line from instructions", () => {
    const line = protocolIdentityLine({ SUPER_MCP_BUILD_REVISION: "deadbeef" });
    expect(parseProtocolIdentityLine(`prefix ${line} suffix`)).toEqual({
      protocol: BASKET_PROTOCOL_ID,
      build: "deadbeef",
    });
  });

  it("embeds identity in MCP server instructions", () => {
    const instructions = buildMcpServerInstructions({ SUPER_MCP_BUILD_REVISION: "rev1" });
    expect(instructions).toMatch(/optimize_basket/i);
    expect(instructions).not.toMatch(/prepare_basket/i);
    expect(parseProtocolIdentityLine(instructions)).toEqual({
      protocol: BASKET_PROTOCOL_ID,
      build: "rev1",
    });
  });
});

describe("validateMcpBasketContract", () => {
  const goodInstructions = protocolIdentityLine({ SUPER_MCP_BUILD_REVISION: "rev1" });
  const goodTools = [
    {
      name: "optimize_basket",
      inputSchema: {
        properties: {
          items: {},
          continuation: {},
          answers: {},
          city: {},
        },
      },
    },
  ];

  it("accepts the current resumable schema and protocol identity", () => {
    const result = validateMcpBasketContract({
      toolNames: ["optimize_basket", "search_products"],
      tools: goodTools,
      instructions: `hello ${goodInstructions}`,
      expectedBuild: "rev1",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an endpoint exposing prepare_basket", () => {
    const result = validateMcpBasketContract({
      toolNames: ["prepare_basket", "optimize_basket"],
      tools: goodTools,
      instructions: goodInstructions,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/prepare_basket/);
  });

  it("rejects optimize_basket without continuation/answers or with qty", () => {
    const result = validateMcpBasketContract({
      toolNames: ["optimize_basket"],
      tools: [
        {
          name: "optimize_basket",
          inputSchema: { properties: { items: {}, qty: {} } },
        },
      ],
      instructions: goodInstructions,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/continuation/);
    expect(result.errors.join(" ")).toMatch(/answers/);
    expect(result.errors.join(" ")).toMatch(/qty/);
  });

  it("fails deployed environments when build is still dev", () => {
    const result = validateMcpBasketContract({
      toolNames: ["optimize_basket"],
      tools: goodTools,
      instructions: protocolIdentityLine({}),
      requireDeployedRevision: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/dev/);
  });

  it("fails when reported build differs from expected", () => {
    const result = validateMcpBasketContract({
      toolNames: ["optimize_basket"],
      tools: goodTools,
      instructions: goodInstructions,
      expectedBuild: "other-rev",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/build mismatch/);
  });
});
