import { describe, expect, it } from "vitest";
import { assertPurchaseQtyPreservesRequest } from "../../../src/services/basket/purchaseQtyGuard.js";

describe("assertPurchaseQtyPreservesRequest", () => {
  it("allows weighted kg/L that matches the requested amount", () => {
    expect(() =>
      assertPurchaseQtyPreservesRequest(
        { amount: 1.5, unit: "kg" },
        { qty: 1.5, mode: "weighted_kg_or_l" },
      ),
    ).not.toThrow();
    expect(() =>
      assertPurchaseQtyPreservesRequest(
        { amount: 1, unit: "L" },
        { qty: 1, mode: "weighted_kg_or_l" },
      ),
    ).not.toThrow();
  });

  it("rejects weighted qty that silently differs from requested kg/L", () => {
    expect(() =>
      assertPurchaseQtyPreservesRequest(
        { amount: 1.5, unit: "kg" },
        { qty: 0.3, mode: "weighted_kg_or_l" },
      ),
    ).toThrow(/does not preserve requested/);
  });

  it("rejects amount→packs fractional conversion without integer packs", () => {
    expect(() =>
      assertPurchaseQtyPreservesRequest(
        { amount: 1, unit: "kg" },
        { qty: 0.3, mode: "packs" },
      ),
    ).toThrow(/integer pack count/);
  });

  it("keeps pack_qty as integer packs", () => {
    expect(() =>
      assertPurchaseQtyPreservesRequest({ packQty: 2 }, { qty: 2, mode: "packs" }),
    ).not.toThrow();
    expect(() =>
      assertPurchaseQtyPreservesRequest({ packQty: 2 }, { qty: 1.5, mode: "packs" }),
    ).toThrow(/integer pack count/);
  });

  it("requires conversion metadata when fractional packs somehow occur", () => {
    expect(() =>
      assertPurchaseQtyPreservesRequest(
        { amount: 20, unit: "יח" },
        { qty: 1.5, mode: "packs" },
      ),
    ).toThrow(/conversion metadata/);
    expect(() =>
      assertPurchaseQtyPreservesRequest(
        { amount: 20, unit: "יח" },
        { qty: 1.5, mode: "packs", conversion: { rounded: true } },
      ),
    ).not.toThrow();
  });
});
