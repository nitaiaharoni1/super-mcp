import { describe, expect, it } from "vitest";
import {
  bindAnalyticsContext,
  resolveAnalyticsContext,
  runWithAnalyticsContext,
} from "../../src/analytics/context.js";

describe("analytics context", () => {
  it("resolves server-bound context without ALS", () => {
    const server = { id: "mcp-server" };
    bindAnalyticsContext(server, { apiKeyId: "key-1", role: "standard" });
    expect(resolveAnalyticsContext(server)).toEqual({
      apiKeyId: "key-1",
      role: "standard",
    });
  });

  it("falls back to AsyncLocalStorage when server has no binding", async () => {
    const server = { id: "unbound" };
    await runWithAnalyticsContext({ apiKeyId: "key-als", role: "master" }, async () => {
      expect(resolveAnalyticsContext(server)).toEqual({
        apiKeyId: "key-als",
        role: "master",
      });
    });
  });

  it("prefers server binding over ALS", async () => {
    const server = { id: "bound" };
    bindAnalyticsContext(server, { apiKeyId: "key-bound", role: "standard" });
    await runWithAnalyticsContext({ apiKeyId: "key-als", role: "master" }, async () => {
      expect(resolveAnalyticsContext(server)?.apiKeyId).toBe("key-bound");
    });
  });
});
