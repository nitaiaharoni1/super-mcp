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

  it("registers only optimize_basket for shopping lists", () => {
    const registered: string[] = [];
    const server = {
      registerTool: (_name: string, _def: unknown, _handler: unknown) => {
        registered.push(_name);
      },
    } as unknown as Parameters<typeof registerBasketTools>[0];

    registerBasketTools(server);

    expect(registered).toEqual(["optimize_basket"]);
  });

  it("publishes pack_qty / amount+unit and rejects deprecated qty", () => {
    const definitions = new Map<string, { inputSchema: z.ZodObject<z.ZodRawShape> }>();
    const server = {
      registerTool: (name: string, def: { inputSchema: z.ZodObject<z.ZodRawShape> }) => {
        definitions.set(name, def);
      },
    } as unknown as Parameters<typeof registerBasketTools>[0];

    registerBasketTools(server);

    const itemsSchema = definitions.get("optimize_basket")?.inputSchema.shape.items;
    expect(itemsSchema).toBeDefined();
    expect(itemsSchema?.parse([{ query: "pitas", pack_qty: 2 }])).toEqual([
      { query: "pitas", pack_qty: 2 },
    ]);
    expect(itemsSchema?.parse([{ query: "pitas", amount: 20, unit: "יח" }])).toEqual([
      { query: "pitas", amount: 20, unit: "יח" },
    ]);
    expect(() => itemsSchema?.parse([{ query: "pitas", qty: 2 }])).toThrow();
    expect(() =>
      itemsSchema?.parse([{ query: "pitas", pack_qty: 2, qty: 2 }]),
    ).toThrow();
  });

  it("registers every store tool with a strict schema that rejects unknown args", () => {
    const definitions = new Map<string, { inputSchema: z.ZodObject<z.ZodRawShape> }>();
    const server = {
      registerTool: (name: string, def: { inputSchema: z.ZodObject<z.ZodRawShape> }) => {
        definitions.set(name, def);
      },
    } as unknown as Parameters<typeof registerStoreTools>[0];

    registerStoreTools(server);

    const getPromotions = definitions.get("get_promotions");
    expect(getPromotions).toBeDefined();
    const schema = getPromotions!.inputSchema;

    expect(schema.safeParse({ city: "הרצליה", limit: 10 }).success).toBe(true);

    const bad = schema.safeParse({ citty: "הרצליה", limit: 10 });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
    }

    for (const def of definitions.values()) {
      expect(def.inputSchema.safeParse({ __definitely_unknown__: 1 }).success).toBe(false);
    }
  });

  it("directs agents through resumable optimize_basket confirmation", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/optimize_basket/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/needs_confirmation/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/continuation/i);
    expect(MCP_SERVER_INSTRUCTIONS).not.toMatch(/prepare_basket/i);
    expect(MCP_SERVER_INSTRUCTIONS).toContain("pack_qty");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("amount=20, unit=יח");
  });
});
