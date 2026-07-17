import { describe, expect, it } from "vitest";
import { registerProductTools } from "../../../src/mcp/tools/products/index.js";
import { registerBasketTools } from "../../../src/mcp/tools/basket/index.js";
import { registerStoreTools } from "../../../src/mcp/tools/stores/index.js";

describe("MCP domain tool registrars", () => {
  it("exports one registrar per domain", () => {
    expect(typeof registerProductTools).toBe("function");
    expect(typeof registerBasketTools).toBe("function");
    expect(typeof registerStoreTools).toBe("function");
  });
});
