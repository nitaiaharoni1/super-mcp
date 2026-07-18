import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

const prepareBasket = vi.fn();
const optimizeBasket = vi.fn();

vi.mock("../../src/services/basket/index.js", () => ({
  prepareBasket: (...args: unknown[]) => prepareBasket(...args),
  optimizeBasket: (...args: unknown[]) => optimizeBasket(...args),
}));

import {
  basketComponentSchemas,
  basketMcpTools,
  basketPaths,
} from "../../src/openapi/basket.js";
import { registerBasketRoutes } from "../../src/routes/basket/index.js";
import { basketItemSchema } from "../../src/routes/basket/schemas.js";

describe("basket REST contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts pack_qty and rejects combining it with deprecated qty", () => {
    expect(basketItemSchema.parse({ query: "pitas", pack_qty: 2 })).toMatchObject({
      query: "pitas",
      pack_qty: 2,
    });
    expect(() =>
      basketItemSchema.parse({ query: "pitas", pack_qty: 2, qty: 2 }),
    ).toThrow(/pack_qty.*qty/i);
  });

  it("maps POST /v1/basket/prepare through the shared service contract", async () => {
    prepareBasket.mockResolvedValue({
      items: [],
      completeness: {
        requestedLines: 0,
        resolvedLines: 0,
        needsConfirmationLines: 0,
        unresolvedLines: 0,
        safeResolutionRatio: 0,
        totalsArePartial: true,
      },
      assumptions: [],
      questions: [],
    });
    const app = Fastify();
    await registerBasketRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/basket/prepare",
      payload: {
        items: [
          { query: "20 pitas", amount: 20, unit: "unit" },
          { query: "milk", pack_qty: 2 },
        ],
        city: "Herzliya",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { questions: [] } });
    expect(prepareBasket).toHaveBeenCalledWith({
      items: [
        {
          productId: undefined,
          gtin: undefined,
          query: "20 pitas",
          qty: undefined,
          amount: 20,
          unit: "unit",
        },
        {
          productId: undefined,
          gtin: undefined,
          query: "milk",
          qty: 2,
          amount: undefined,
          unit: undefined,
        },
      ],
      city: "Herzliya",
      near: undefined,
      radiusKm: 10,
    });
    await app.close();
  });

  it("documents prepare request/response and advertises the MCP tool", () => {
    expect(basketPaths).toHaveProperty("/v1/basket/prepare.post");
    expect(basketComponentSchemas).toHaveProperty("BasketPrepareRequest");
    expect(basketComponentSchemas).toHaveProperty("BasketPrepareResponse");
    expect(basketMcpTools).toContain("prepare_basket");
  });
});
