import { describe, expect, it } from "vitest";
import {
  MCP_SURFACES,
  buildOnlineInstructions,
  buildStoresInstructions,
  enabledSurfaces,
} from "../../src/mcp/surfaces.js";
import {
  BASKET_PROTOCOL_ID,
  DELIVERY_PROTOCOL_ID,
  parseProtocolIdentityLine,
} from "../../src/mcp/protocolIdentity.js";

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

describe("the two surfaces answer two different questions", () => {
  it("mounts the physical surface where it has always been", () => {
    // Every key and client already configured against /mcp keeps working; the
    // delivery surface is additive.
    expect(MCP_SURFACES.stores.path).toBe("/mcp");
    expect(MCP_SURFACES.stores.serverName).toBe("super-mcp");
  });

  it("mounts the delivery surface under its own name", () => {
    expect(MCP_SURFACES.online.path).toBe("/mcp/online");
    expect(MCP_SURFACES.online.serverName).toBe("super-mcp-online");
  });

  it("leads each surface with the tool that answers its question in one call", () => {
    expect(toolsOf("stores")[0]).toBe("optimize_basket");
    expect(toolsOf("online")[0]).toBe("optimize_delivery");
  });

  it("never offers a delivery tool on the physical surface, or the reverse", () => {
    const stores = toolsOf("stores");
    const online = toolsOf("online");
    expect(stores).not.toContain("optimize_delivery");
    expect(stores).not.toContain("list_delivery_options");
    expect(online).not.toContain("optimize_basket");
    // list_stores is a radius question; its online counterpart is list_delivery_options.
    expect(online).not.toContain("list_stores");
  });

  it("shares the catalogue tools, because product identity is the same problem", () => {
    for (const shared of ["search_products", "get_product", "get_promotions"]) {
      expect(toolsOf("stores")).toContain(shared);
      expect(toolsOf("online")).toContain(shared);
    }
  });

  it("keeps compare_prices off the delivery surface", () => {
    // It answers "where is this cheapest nearby", which returns shelf prices the
    // shopper cannot get without driving.
    expect(toolsOf("online")).not.toContain("compare_prices");
    expect(toolsOf("stores")).toContain("compare_prices");
  });
});

describe("surface identity", () => {
  it("gives each surface its own protocol id", () => {
    // A canary that accepted either could not tell "the online server is at the
    // wrong revision" from "the online server is not deployed".
    expect(parseProtocolIdentityLine(buildStoresInstructions({}))?.protocol).toBe(
      BASKET_PROTOCOL_ID,
    );
    expect(parseProtocolIdentityLine(buildOnlineInstructions({}))?.protocol).toBe(
      DELIVERY_PROTOCOL_ID,
    );
    expect(BASKET_PROTOCOL_ID).not.toBe(DELIVERY_PROTOCOL_ID);
  });

  it("points each surface at the other for the question it does not answer", () => {
    expect(buildStoresInstructions({})).toContain("super-mcp-online");
    expect(buildOnlineInstructions({})).toContain("optimize_basket");
  });

  it("tells the delivery surface that online prices are not shelf prices", () => {
    // Measured: Rami Levy's online store shares only 22% of its prices with its
    // own branches, and Carrefour's runs ~8% below its shelves.
    expect(buildOnlineInstructions({})).toMatch(/online prices are NOT shelf prices/i);
  });

  it("makes the delivered total the headline, not the item subtotal", () => {
    expect(buildOnlineInstructions({})).toMatch(/deliveredTotal/);
  });

  it("requires the fee's confidence to be read before it is quoted", () => {
    const instructions = buildOnlineInstructions({});
    expect(instructions).toContain("deliveryFeeConfidence");
    expect(instructions).toMatch(/meetsMinimum=false/);
  });
});

describe("which surfaces this process serves", () => {
  it("serves both by default, so one deployment answers both URLs", () => {
    expect(enabledSurfaces({}).map((s) => s.id)).toEqual(["stores", "online"]);
  });

  it("can be narrowed to one, which is how they split across deployments", () => {
    expect(enabledSurfaces({ SUPER_MCP_SURFACES: "online" }).map((s) => s.id)).toEqual(["online"]);
    expect(enabledSurfaces({ SUPER_MCP_SURFACES: "stores" }).map((s) => s.id)).toEqual(["stores"]);
  });

  it("accepts a list, in the order given", () => {
    expect(enabledSurfaces({ SUPER_MCP_SURFACES: "online, stores" }).map((s) => s.id)).toEqual([
      "online",
      "stores",
    ]);
  });

  it("refuses a typo instead of silently serving nothing", () => {
    // Booting with no MCP at all because someone wrote "onlin" is a much worse
    // failure than refusing to boot.
    expect(() => enabledSurfaces({ SUPER_MCP_SURFACES: "onlin" })).toThrow(/unknown surface/i);
  });
});
