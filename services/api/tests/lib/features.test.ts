import { afterEach, describe, expect, it } from "vitest";
import {
  semanticBasketEnabled,
  semanticBasketShadow,
  semanticV2PolicyEnabled,
  semanticV2RecallEnabled,
  semanticV2Shadow,
} from "../../src/lib/features.js";
import { snapshotEnv } from "../../test/helpers/env.js";

describe("semantic basket feature flags", () => {
  const restoreEnv = snapshotEnv([
    "SUPER_MCP_SEMANTIC_BASKET",
    "SUPER_MCP_SEMANTIC_SHADOW",
    "SUPER_MCP_SEMANTIC_V2_SHADOW",
    "SUPER_MCP_SEMANTIC_V2_RECALL",
    "SUPER_MCP_SEMANTIC_V2_POLICY",
  ]);

  afterEach(() => {
    restoreEnv();
  });

  it("defaults semantic basket on", () => {
    delete process.env.SUPER_MCP_SEMANTIC_BASKET;
    expect(semanticBasketEnabled()).toBe(true);
  });

  it("disables with 0/false/off", () => {
    process.env.SUPER_MCP_SEMANTIC_BASKET = "0";
    expect(semanticBasketEnabled()).toBe(false);
    process.env.SUPER_MCP_SEMANTIC_BASKET = "false";
    expect(semanticBasketEnabled()).toBe(false);
  });

  it("enables shadow only when explicitly on", () => {
    delete process.env.SUPER_MCP_SEMANTIC_SHADOW;
    expect(semanticBasketShadow()).toBe(false);
    process.env.SUPER_MCP_SEMANTIC_SHADOW = "1";
    expect(semanticBasketShadow()).toBe(true);
  });

  it("defaults V2 recall/policy on when basket is on", () => {
    delete process.env.SUPER_MCP_SEMANTIC_BASKET;
    delete process.env.SUPER_MCP_SEMANTIC_V2_RECALL;
    delete process.env.SUPER_MCP_SEMANTIC_V2_POLICY;
    expect(semanticV2RecallEnabled()).toBe(true);
    expect(semanticV2PolicyEnabled()).toBe(true);
  });

  it("defaults V2 recall/policy off when basket is off", () => {
    process.env.SUPER_MCP_SEMANTIC_BASKET = "0";
    delete process.env.SUPER_MCP_SEMANTIC_V2_RECALL;
    delete process.env.SUPER_MCP_SEMANTIC_V2_POLICY;
    expect(semanticV2RecallEnabled()).toBe(false);
    expect(semanticV2PolicyEnabled()).toBe(false);
  });

  it("disables V2 recall/policy with 0/false/off", () => {
    delete process.env.SUPER_MCP_SEMANTIC_BASKET;
    process.env.SUPER_MCP_SEMANTIC_V2_RECALL = "0";
    process.env.SUPER_MCP_SEMANTIC_V2_POLICY = "false";
    expect(semanticV2RecallEnabled()).toBe(false);
    expect(semanticV2PolicyEnabled()).toBe(false);
  });

  it("keeps basket as master kill switch even if V2 flags are forced on", () => {
    process.env.SUPER_MCP_SEMANTIC_BASKET = "0";
    process.env.SUPER_MCP_SEMANTIC_V2_RECALL = "1";
    process.env.SUPER_MCP_SEMANTIC_V2_POLICY = "on";
    process.env.SUPER_MCP_SEMANTIC_V2_SHADOW = "1";
    expect(semanticV2RecallEnabled()).toBe(false);
    expect(semanticV2PolicyEnabled()).toBe(false);
    expect(semanticV2Shadow()).toBe(false);
  });

  it("enables V2 shadow only when basket is on and shadow is explicit", () => {
    delete process.env.SUPER_MCP_SEMANTIC_BASKET;
    delete process.env.SUPER_MCP_SEMANTIC_V2_SHADOW;
    expect(semanticV2Shadow()).toBe(false);
    process.env.SUPER_MCP_SEMANTIC_V2_SHADOW = "1";
    expect(semanticV2Shadow()).toBe(true);
  });
});
