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
    const definitions = new Map<string, { inputSchema: z.ZodObject<{ items: z.ZodType }> }>();
    const server = {
      registerTool: (name: string, def: { inputSchema: z.ZodObject<{ items: z.ZodType }> }) => {
        definitions.set(name, def);
      },
    } as unknown as Parameters<typeof registerBasketTools>[0];

    registerBasketTools(server);

    const itemsSchema = definitions.get("prepare_basket")?.inputSchema.shape.items;
    expect(itemsSchema).toBeDefined();
    expect(itemsSchema?.parse([{ query: "pitas", pack_qty: 2 }])).toEqual([
      { query: "pitas", pack_qty: 2 },
    ]);
    expect(() =>
      itemsSchema?.parse([{ query: "pitas", pack_qty: 2, qty: 2 }]),
    ).toThrow(/pack_qty.*qty/i);
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

    // A known-good call passes.
    expect(schema.safeParse({ city: "הרצליה", limit: 10 }).success).toBe(true);

    // Misspelled / unknown args are rejected, not silently dropped.
    const bad = schema.safeParse({ citty: "הרצליה", limit: 10 });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
    }

    // Every registered store tool is strict.
    for (const def of definitions.values()) {
      expect(def.inputSchema.safeParse({ __definitely_unknown__: 1 }).success).toBe(false);
    }
  });

  it("directs agents through prepare, confirmation, then optimization", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(
      /prepare_basket.*confirm.*optimize_basket/is,
    );
    expect(MCP_SERVER_INSTRUCTIONS).toContain("pack_qty");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("amount=20, unit=יח");
  });
});
