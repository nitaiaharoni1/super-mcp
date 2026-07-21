import { afterEach, describe, expect, it } from "vitest";
import {
  _resetPostHogClientForTests,
  captureSafe,
  getPostHogClient,
  posthogDistinctId,
} from "../../src/analytics/posthog.js";

describe("posthog client", () => {
  afterEach(() => {
    delete process.env.POSTHOG_KEY;
    _resetPostHogClientForTests();
  });

  it("returns null client when POSTHOG_KEY is unset", () => {
    delete process.env.POSTHOG_KEY;
    _resetPostHogClientForTests();
    expect(getPostHogClient()).toBeNull();
  });

  it("captureSafe never throws without a key", () => {
    delete process.env.POSTHOG_KEY;
    _resetPostHogClientForTests();
    expect(() =>
      captureSafe("api_key:test", "api_operation", { surface: "mcp", operation: "search_products" }),
    ).not.toThrow();
  });

  it("builds stable distinct ids from api key ids", () => {
    expect(posthogDistinctId("abc-123")).toBe("api_key:abc-123");
  });
});
