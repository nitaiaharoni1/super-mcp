import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

const optimizeBasket = vi.fn();

vi.mock("../../src/services/basket/index.js", () => ({
  optimizeBasket: (...args: unknown[]) => optimizeBasket(...args),
}));

import {
  basketMcpTools,
  basketPaths,
} from "../../src/openapi/basket.js";
import { registerBasketRoutes } from "../../src/routes/basket/index.js";
import {
  basketInitialBodySchema,
  basketItemSchema,
  optimizeBasketBodySchema,
} from "../../src/routes/basket/schemas.js";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("basket REST contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("defaults resolution_mode to fast and response_detail to summary", () => {
    expect(
      basketInitialBodySchema.parse({
        items: [{ query: "חלב", pack_qty: 1 }],
        city: "תל אביב",
      }),
    ).toMatchObject({
      resolution_mode: "fast",
      response_detail: "summary",
    });

    expect(
      basketInitialBodySchema.parse({
        items: [{ query: "חלב", pack_qty: 1 }],
        city: "תל אביב",
        resolution_mode: "strict",
        response_detail: "debug",
      }),
    ).toMatchObject({
      resolution_mode: "strict",
      response_detail: "debug",
    });
  });

  it("maps verbose true to response_detail debug only when response_detail is absent", () => {
    expect(
      basketInitialBodySchema.parse({
        items: [{ query: "חלב", pack_qty: 1 }],
        city: "תל אביב",
        verbose: true,
      }),
    ).toMatchObject({
      response_detail: "debug",
    });

    expect(
      basketInitialBodySchema.parse({
        items: [{ query: "חלב", pack_qty: 1 }],
        city: "תל אביב",
        response_detail: "summary",
        verbose: true,
      }),
    ).toMatchObject({
      response_detail: "summary",
    });
  });

  it("accepts exactly one identifier and one quantity source", () => {
    expect(basketItemSchema.parse({ query: "פיתות", amount: 20, unit: "יח" })).toBeDefined();
    expect(() =>
      basketItemSchema.parse({ query: "פיתות", product_id: UUID, pack_qty: 2 }),
    ).toThrow(/exactly one identifier/i);
    expect(() => basketItemSchema.parse({ query: "פיתות", qty: 2 })).toThrow();
  });

  it("accepts a resume request without items or location", () => {
    expect(
      optimizeBasketBodySchema.parse({
        continuation: "body.signature",
        answers: [{ item_index: 3, product_id: UUID }],
      }),
    ).toBeDefined();
  });

  it("does not register prepare REST or MCP surfaces", () => {
    expect(basketPaths).not.toHaveProperty("/v1/basket/prepare");
    expect(basketMcpTools).toEqual(["optimize_basket"]);
  });

  it("maps POST /v1/basket/optimize through the resumable service contract", async () => {
    optimizeBasket.mockResolvedValue({
      status: "complete",
      bestSingleStore: null,
      cheapestCompleteStore: null,
      multiStore: null,
      items: [],
      stores: [],
      storesCompared: 0,
      storesTruncated: false,
      location: { city: "Herzliya", distanceReliable: true },
    });
    process.env.BASKET_CONTINUATION_SECRET = "test-only-basket-continuation-secret-ok";
    const app = Fastify();
    await registerBasketRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/basket/optimize",
      payload: {
        items: [
          { query: "20 pitas", amount: 20, unit: "unit" },
          { query: "milk", pack_qty: 2 },
        ],
        city: "Herzliya",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(optimizeBasket).toHaveBeenCalledWith(
      {
        items: [
          {
            productId: undefined,
            gtin: undefined,
            query: "20 pitas",
            packQty: undefined,
            amount: 20,
            unit: "unit",
          },
          {
            productId: undefined,
            gtin: undefined,
            query: "milk",
            packQty: 2,
            amount: undefined,
            unit: undefined,
          },
        ],
        city: "Herzliya",
        near: undefined,
        radiusKm: 10,
        locationOrigin: undefined,
        includeClub: true,
        storesLimit: undefined,
        distancePenaltyPerKm: undefined,
        verbose: undefined,
        resolutionMode: "fast",
        responseDetail: "summary",
      },
      { continuationSecret: "test-only-basket-continuation-secret-ok" },
    );
    await app.close();
  });
});
