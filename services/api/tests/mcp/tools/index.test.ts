import { describe, expect, it } from "vitest";
import { registerProductTools } from "../../../src/mcp/tools/products/index.js";
import { registerBasketTools } from "../../../src/mcp/tools/basket/index.js";
import { registerStoreTools } from "../../../src/mcp/tools/stores/index.js";
import { MCP_SERVER_INSTRUCTIONS } from "../../../src/mcp/server.js";
import type { z } from "zod";

describe("MCP domain tool registrars", () => {
  it("exports one registrar per domain", () => {
    expect(typeof registerProductTools).toBe("function");
    expect(typeof registerBasketTools).toBe("function");
    expect(typeof registerStoreTools).toBe("function");
  });

  it("registers prepare_basket and optimize_basket", () => {
    const registered: string[] = [];
    const server = {
      registerTool: (_name: string, _def: unknown, _handler: unknown) => {
        registered.push(_name);
      },
    } as unknown as Parameters<typeof registerBasketTools>[0];

    registerBasketTools(server);

    expect(registered).toContain("prepare_basket");
    expect(registered).toContain("optimize_basket");
  });

  it("publishes pack_qty while retaining an exclusive deprecated qty alias", () => {
    const definitions = new Map<string, { inputSchema: { items: z.ZodType } }>();
    const server = {
      registerTool: (name: string, def: { inputSchema: { items: z.ZodType } }) => {
        definitions.set(name, def);
      },
    } as unknown as Parameters<typeof registerBasketTools>[0];

    registerBasketTools(server);

    const itemsSchema = definitions.get("prepare_basket")?.inputSchema.items;
    expect(itemsSchema).toBeDefined();
    expect(itemsSchema?.parse([{ query: "pitas", pack_qty: 2 }])).toEqual([
      { query: "pitas", pack_qty: 2 },
    ]);
    expect(() =>
      itemsSchema?.parse([{ query: "pitas", pack_qty: 2, qty: 2 }]),
    ).toThrow(/pack_qty.*qty/i);
  });

  it("directs agents through prepare, confirmation, then optimization", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(
      /prepare_basket.*confirm.*optimize_basket/is,
    );
    expect(MCP_SERVER_INSTRUCTIONS).toContain("pack_qty");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("amount=20, unit=יח");
  });
});
