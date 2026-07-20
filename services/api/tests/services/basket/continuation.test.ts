import { describe, expect, it } from "vitest";
import {
  applyBasketAnswers,
  assertBasketContinuationSecret,
  decodeBasketContinuation,
  encodeBasketContinuation,
} from "../../../src/services/basket/continuation.js";
import type { BasketContinuationV1 } from "../../../src/services/basket/types.js";
import { optimizeBasketBodySchema } from "../../../src/routes/basket/schemas.js";

const SECRET = "test-only-basket-continuation-secret-ok";
const UUID = "11111111-1111-4111-8111-111111111111";

const PAYLOAD: BasketContinuationV1 = {
  version: 1,
  issuedAt: 1_000,
  expiresAt: 1_000 + 30 * 60 * 1000,
  input: {
    city: "Herzliya",
    items: [
      { query: "עגבניות", amount: 1, unit: "kg" },
      { query: "מלפפונים", amount: 1, unit: "kg" },
      { query: "בצלים", amount: 3, unit: "יח" },
      { query: "פיתות", amount: 20, unit: "יח" },
    ],
  },
  questions: [
    {
      itemIndex: 3,
      selectionEffect: "representative",
      allowedProductIds: ["pita-10", "pita-8"],
    },
  ],
};

const PIN_PAYLOAD: BasketContinuationV1 = {
  version: 1,
  issuedAt: 1_000,
  expiresAt: 1_000 + 30 * 60 * 1000,
  input: {
    city: "Herzliya",
    items: [{ query: "קולה זירו", packQty: 2 }],
  },
  questions: [
    {
      itemIndex: 0,
      selectionEffect: "pin",
      allowedProductIds: ["coke-zero"],
    },
  ],
};

const BRAND_FAMILY_PAYLOAD: BasketContinuationV1 = {
  version: 1,
  issuedAt: 1_000,
  expiresAt: 1_000 + 30 * 60 * 1000,
  input: {
    city: "Herzliya",
    items: [{ query: "טייסטרס צ׳ויס", packQty: 1 }],
  },
  questions: [
    {
      itemIndex: 0,
      selectionEffect: "brand_family",
      allowedProductIds: ["tasters-95", "tasters-200"],
    },
  ],
};

const DUPLICATES = [
  { itemIndex: 3, productId: "pita-10" },
  { itemIndex: 3, productId: "pita-8" },
];
const UNKNOWN = [
  { itemIndex: 3, productId: "pita-10" },
  { itemIndex: 99, productId: "pita-10" },
];
const UNOFFERED = [{ itemIndex: 3, productId: "pita-unoffered" }];

describe("basket continuation codec", () => {
  it("round-trips an authenticated continuation", () => {
    const encoded = encodeBasketContinuation(PAYLOAD, SECRET);
    expect(decodeBasketContinuation(encoded, SECRET, 1_001)).toEqual(PAYLOAD);
  });

  it("rejects tampering", () => {
    const encoded = encodeBasketContinuation(PAYLOAD, SECRET);
    const tampered = `${encoded.slice(0, -1)}${encoded.endsWith("a") ? "b" : "a"}`;
    expect(() => decodeBasketContinuation(tampered, SECRET, 1_001)).toThrow(
      /invalid basket continuation/i,
    );
  });

  it("rejects expiry and unsupported versions", () => {
    const encoded = encodeBasketContinuation(PAYLOAD, SECRET);
    expect(() => decodeBasketContinuation(encoded, SECRET, PAYLOAD.expiresAt + 1)).toThrow(
      /expired/i,
    );
    const unsupported = encodeBasketContinuation(
      { ...PAYLOAD, version: 2 as never },
      SECRET,
    );
    expect(() => decodeBasketContinuation(unsupported, SECRET, 1_001)).toThrow(
      /unsupported.*version/i,
    );
  });

  it("requires at least 32 secret bytes", () => {
    expect(() => assertBasketContinuationSecret("short")).toThrow(/32 bytes/i);
  });
});

describe("applyBasketAnswers", () => {
  it("representative answer retains query, amount/unit, selected productId, and commodity override", () => {
    const resumed = applyBasketAnswers(PAYLOAD, [{ itemIndex: 3, productId: "pita-10" }]);
    expect(resumed.city).toBe("Herzliya");
    expect(resumed.items).toHaveLength(4);
    expect(resumed.items[0]).toEqual({ query: "עגבניות", amount: 1, unit: "kg" });
    expect(resumed.items[3]).toEqual({
      productId: "pita-10",
      query: "פיתות",
      amount: 20,
      unit: "יח",
      gtin: undefined,
      intentModeOverride: "commodity",
    });
  });

  it("pin answer retains query and quantity with exact intent override", () => {
    const resumed = applyBasketAnswers(PIN_PAYLOAD, [{ itemIndex: 0, productId: "coke-zero" }]);
    expect(resumed.items[0]).toEqual({
      productId: "coke-zero",
      query: "קולה זירו",
      packQty: 2,
      gtin: undefined,
      intentModeOverride: "exact",
    });
  });

  it("brand_family answer retains query with brand_family intent override", () => {
    const resumed = applyBasketAnswers(BRAND_FAMILY_PAYLOAD, [
      { itemIndex: 0, productId: "tasters-95" },
    ]);
    expect(resumed.items[0]).toEqual({
      productId: "tasters-95",
      query: "טייסטרס צ׳ויס",
      packQty: 1,
      gtin: undefined,
      intentModeOverride: "brand_family",
    });
  });

  it("rejects missing, duplicate, unknown, and unoffered answers", () => {
    expect(() => applyBasketAnswers(PAYLOAD, [])).toThrow(/missing required answer/i);
    expect(() => applyBasketAnswers(PAYLOAD, DUPLICATES)).toThrow(/duplicate answer/i);
    expect(() => applyBasketAnswers(PAYLOAD, UNKNOWN)).toThrow(/unknown item index/i);
    expect(() => applyBasketAnswers(PAYLOAD, UNOFFERED)).toThrow(/not offered/i);
  });
});

describe("resume boundary rejects reconstructed baskets", () => {
  it("rejects mixed initial fields with continuation", () => {
    const mixed = optimizeBasketBodySchema.safeParse({
      continuation: "body.signature",
      answers: [{ item_index: 0, product_id: UUID }],
      items: [{ query: "פיתות", amount: 20, unit: "יח" }],
      city: "Herzliya",
    });
    expect(mixed.success).toBe(false);

    const resumeOnly = optimizeBasketBodySchema.safeParse({
      continuation: "body.signature",
      answers: [{ item_index: 0, product_id: UUID }],
    });
    expect(resumeOnly.success).toBe(true);
  });
});
