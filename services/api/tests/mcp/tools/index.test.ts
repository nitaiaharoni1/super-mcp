import { afterEach, describe, expect, it, vi } from "vitest";

const optimizeBasket = vi.fn();

vi.mock("../../../src/services/basket/index.js", () => ({
  optimizeBasket: (...args: unknown[]) => optimizeBasket(...args),
}));

import { registerProductTools } from "../../../src/mcp/tools/products/index.js";
import { registerBasketTools } from "../../../src/mcp/tools/basket/index.js";
import { registerStoreTools } from "../../../src/mcp/tools/stores/index.js";
import { MCP_SERVER_INSTRUCTIONS } from "../../../src/mcp/server.js";
import {
  BASKET_PROTOCOL_ID,
  parseProtocolIdentityLine,
} from "../../../src/mcp/protocolIdentity.js";
import type { z } from "zod";

describe("MCP domain tool registrars", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

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

  it("publishes resolution_mode and response_detail with fast/summary defaults", () => {
    const definitions = new Map<string, { inputSchema: z.ZodObject<z.ZodRawShape> }>();
    const server = {
      registerTool: (name: string, def: { inputSchema: z.ZodObject<z.ZodRawShape> }) => {
        definitions.set(name, def);
      },
    } as unknown as Parameters<typeof registerBasketTools>[0];

    registerBasketTools(server);

    const shape = definitions.get("optimize_basket")?.inputSchema.shape;
    expect(shape?.resolution_mode).toBeDefined();
    expect(shape?.response_detail).toBeDefined();
    expect(shape?.resolution_mode?.parse(undefined)).toBe("fast");
    // response_detail stays undefined when omitted so verbose→debug can run in the mapper.
    expect(shape?.response_detail?.parse(undefined)).toBeUndefined();
    expect(shape?.resolution_mode?.parse("strict")).toBe("strict");
    expect(shape?.response_detail?.parse("debug")).toBe("debug");
  });

  it("maps verbose true to responseDetail debug only when response_detail is absent", async () => {
    optimizeBasket.mockResolvedValue({ status: "complete", assumptions: [] });

    const definitions = new Map<
      string,
      {
        inputSchema: z.ZodObject<z.ZodRawShape>;
        handler: (args: Record<string, unknown>) => Promise<unknown>;
      }
    >();
    const server = {
      registerTool: (
        name: string,
        def: { inputSchema: z.ZodObject<z.ZodRawShape> },
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        definitions.set(name, { inputSchema: def.inputSchema, handler });
      },
    } as unknown as Parameters<typeof registerBasketTools>[0];

    registerBasketTools(server);
    const tool = definitions.get("optimize_basket");
    expect(tool).toBeDefined();

    const base = {
      items: [{ query: "חלב", pack_qty: 1 }],
      city: "תל אביב",
    };

    const parsedVerbose = tool!.inputSchema.parse({ ...base, verbose: true });
    expect(parsedVerbose).toMatchObject({ verbose: true });
    expect(parsedVerbose).not.toHaveProperty("response_detail");

    await tool!.handler(parsedVerbose as Record<string, unknown>);
    expect(optimizeBasket).toHaveBeenCalledWith(
      expect.objectContaining({ responseDetail: "debug", verbose: true }),
      expect.anything(),
    );

    optimizeBasket.mockClear();
    const parsedExplicit = tool!.inputSchema.parse({
      ...base,
      response_detail: "summary",
      verbose: true,
    });
    expect(parsedExplicit).toMatchObject({
      response_detail: "summary",
      verbose: true,
    });

    await tool!.handler(parsedExplicit as Record<string, unknown>);
    expect(optimizeBasket).toHaveBeenCalledWith(
      expect.objectContaining({ responseDetail: "summary", verbose: true }),
      expect.anything(),
    );
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
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/location/i);
    expect(MCP_SERVER_INSTRUCTIONS).toContain("נווה עמל");
    const identity = parseProtocolIdentityLine(MCP_SERVER_INSTRUCTIONS);
    expect(identity?.protocol).toBe(BASKET_PROTOCOL_ID);
    expect(identity?.build).toBeTruthy();
  });

  it("advertises location on optimize_basket / list_stores / search_products", () => {
    const definitions = new Map<string, { inputSchema: { shape: Record<string, unknown> } }>();
    const server = {
      registerTool: (name: string, def: { inputSchema: { shape: Record<string, unknown> } }) => {
        definitions.set(name, def);
      },
    } as unknown as Parameters<typeof registerBasketTools>[0];

    registerBasketTools(server);
    registerStoreTools(server);
    registerProductTools(server);

    for (const name of ["optimize_basket", "list_stores", "search_products"] as const) {
      const shape = definitions.get(name)?.inputSchema.shape;
      expect(shape?.location, `${name} missing location`).toBeDefined();
      expect(shape?.near, `${name} missing near`).toBeDefined();
      expect(shape?.city, `${name} missing city`).toBeDefined();
    }
  });

  it("rejects mixed resume/initial optimize_basket args", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = {
      registerTool: (
        name: string,
        _def: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        handlers.set(name, handler);
      },
    } as unknown as Parameters<typeof registerBasketTools>[0];

    registerBasketTools(server);
    const handler = handlers.get("optimize_basket");
    expect(handler).toBeDefined();

    const mixed = await handler!({
      continuation: "body.sig",
      answers: [{ item_index: 0, product_id: "11111111-1111-4111-8111-111111111111" }],
      items: [{ query: "מלח", pack_qty: 1 }],
      city: "הרצליה",
    });
    expect(JSON.stringify(mixed)).toMatch(/only continuation and answers/i);

    const answersOnly = await handler!({
      answers: [{ item_index: 0, product_id: "11111111-1111-4111-8111-111111111111" }],
      city: "הרצליה",
      items: [{ query: "מלח", pack_qty: 1 }],
    });
    expect(JSON.stringify(answersOnly)).toMatch(/answers require continuation/i);
  });
});
