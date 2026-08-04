import { describe, expect, it } from "vitest";
import {
  MCP_SURFACES,
  buildOnlineInstructions,
  buildStoresInstructions,
  enabledSurfaces,
} from "../../src/mcp/surfaces.js";
import { getOpenApiSpec } from "../../src/openapi/index.js";
import {
  BASKET_PROTOCOL_ID,
  DELIVERY_PROTOCOL_ID,
  parseProtocolIdentityLine,
} from "../../src/mcp/protocolIdentity.js";
import { DELIVERY_PLAN_FIELDS } from "../../src/services/delivery/types.js";

/** camelCase words in the prose that name something other than a plan field. */
const ALLOWED_NON_PLAN_TERMS = new Set([
  "optimize_delivery", "optimize_basket", "search_products", "get_promotions",
  "list_delivery_options", "get_delivery_terms",
  // Nested paths and sibling response fields, checked by the assertions above.
  "deliveryTerms.confidence", "deliveryTerms.verifiedAt", "unavailableStores",
  // Result-level recommendations, not per-plan fields.
  "cheapestDelivered", "bestSingleOrder",
  "slot_type", "resolution_mode", "pack_qty", "product_id",
  "worthTopUp", "clubOnly", "couponOnly", "itemIndex",
]);

function toolsOf(surface: keyof typeof MCP_SURFACES): string[] {
  const registered: string[] = [];
  const server = {
    registerTool: (name: string) => {
      registered.push(name);
    },
  } as unknown as Parameters<(typeof MCP_SURFACES)[typeof surface]["registerTools"]>[0];
  MCP_SURFACES[surface].registerTools(server);
  return registered;
}

function toolDescriptionsOf(surface: keyof typeof MCP_SURFACES): Map<string, string> {
  const descriptions = new Map<string, string>();
  const server = {
    registerTool: (name: string, definition: { description?: string }) => {
      descriptions.set(name, definition.description ?? "");
    },
  } as unknown as Parameters<(typeof MCP_SURFACES)[typeof surface]["registerTools"]>[0];
  MCP_SURFACES[surface].registerTools(server);
  return descriptions;
}

describe("online supermarket is the only live MCP", () => {
  it("mounts online delivery at the canonical /mcp path as super-mcp", () => {
    expect(MCP_SURFACES.online.path).toBe("/mcp");
    expect(MCP_SURFACES.online.serverName).toBe("super-mcp");
  });

  it("leads the live surface with optimize_delivery", () => {
    expect(toolsOf("online")[0]).toBe("optimize_delivery");
  });

  it("never offers physical basket tools on the online surface", () => {
    const online = toolsOf("online");
    expect(online).not.toContain("optimize_basket");
    expect(online).not.toContain("list_stores");
    expect(online).not.toContain("compare_prices");
  });

  it("includes the shared catalogue tools", () => {
    for (const shared of ["search_products", "get_product", "get_promotions"]) {
      expect(toolsOf("online")).toContain(shared);
    }
  });

  it("does not steer models toward disabled physical tools", () => {
    const descriptions = toolDescriptionsOf("online");
    expect(descriptions.get("search_products")).toContain("optimize_delivery");
    expect(descriptions.get("search_products")).not.toContain("optimize_basket");
    expect(descriptions.get("get_promotions")).toContain("optimize_delivery");
    expect(descriptions.get("get_promotions")).not.toMatch(/compare_prices|optimize_basket/);
  });
});

describe("surface identity", () => {
  it("gives each surface definition its own protocol id", () => {
    expect(parseProtocolIdentityLine(buildStoresInstructions({}))?.protocol).toBe(
      BASKET_PROTOCOL_ID,
    );
    expect(parseProtocolIdentityLine(buildOnlineInstructions({}))?.protocol).toBe(
      DELIVERY_PROTOCOL_ID,
    );
    expect(BASKET_PROTOCOL_ID).not.toBe(DELIVERY_PROTOCOL_ID);
  });

  it("describes itself as the SuperMCP online delivery server", () => {
    expect(buildOnlineInstructions({})).toMatch(/SuperMCP server/i);
    expect(buildOnlineInstructions({})).toMatch(/delivery/i);
  });

  it("tells the delivery surface that online prices are not shelf prices", () => {
    expect(buildOnlineInstructions({})).toMatch(/online prices are NOT shelf prices/i);
  });

  it("makes the delivered total the headline, not the item subtotal", () => {
    expect(buildOnlineInstructions({})).toMatch(/deliveredTotal/);
  });

  it("requires the fee's confidence to be read before it is quoted", () => {
    const instructions = buildOnlineInstructions({});
    expect(instructions).toContain("deliveryTerms.confidence");
    expect(instructions).toMatch(/meetsMinimum=false/);
  });

  it("names only fields a plan actually carries", () => {
    const instructions = buildOnlineInstructions({});
    const planFields = new Set(Object.keys(DELIVERY_PLAN_FIELDS));
    const referenced = instructions.match(/\b[a-z][A-Za-z]{4,}(?=[ .,=])/g) ?? [];
    const camel = referenced.filter((w) => /[A-Z]/.test(w));
    const unknown = [...new Set(camel)].filter(
      (w) => !planFields.has(w) && !ALLOWED_NON_PLAN_TERMS.has(w),
    );
    expect(unknown).toEqual([]);
  });
});

describe("which surfaces this process serves", () => {
  it("serves online at /mcp and the /mcp/online alias", () => {
    expect(enabledSurfaces({}).map((s) => s.path)).toEqual(["/mcp", "/mcp/online"]);
    expect(enabledSurfaces({}).every((s) => s.id === "online")).toBe(true);
    expect(enabledSurfaces({}).every((s) => s.serverName === "super-mcp")).toBe(true);
  });

  it("accepts SUPER_MCP_SURFACES=online as the same mounts", () => {
    expect(enabledSurfaces({ SUPER_MCP_SURFACES: "online" }).map((s) => s.path)).toEqual([
      "/mcp",
      "/mcp/online",
    ]);
  });

  it("refuses to enable the physical stores surface", () => {
    expect(() => enabledSurfaces({ SUPER_MCP_SURFACES: "stores" })).toThrow(/disabled/i);
    expect(() => enabledSurfaces({ SUPER_MCP_SURFACES: "online, stores" })).toThrow(/disabled/i);
  });

  it("refuses a typo instead of silently serving nothing", () => {
    expect(() => enabledSurfaces({ SUPER_MCP_SURFACES: "onlin" })).toThrow(/unknown surface/i);
  });

  it("documents /mcp as online delivery in OpenAPI, keeps BasketLine for delivery", () => {
    const previous = process.env.SUPER_MCP_SURFACES;
    delete process.env.SUPER_MCP_SURFACES;
    try {
      const spec = getOpenApiSpec() as {
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      };
      expect(spec.paths).toHaveProperty("/mcp");
      expect(spec.paths).toHaveProperty("/mcp/online");
      expect(spec.paths).not.toHaveProperty("/v1/basket/optimize");
      expect(spec.paths).toHaveProperty("/v1/delivery/optimize");
      expect(spec.components.schemas).toHaveProperty("BasketLine");
      expect(spec.components.schemas).not.toHaveProperty("BasketOptimizeRequest");
      expect(spec.components.schemas).not.toHaveProperty("BasketOptimizeResponse");
      const mcp = spec.paths["/mcp"] as { post: { summary: string } };
      expect(mcp.post.summary).toMatch(/online|delivery/i);
    } finally {
      if (previous === undefined) delete process.env.SUPER_MCP_SURFACES;
      else process.env.SUPER_MCP_SURFACES = previous;
    }
  });
});
