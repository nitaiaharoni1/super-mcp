import { describe, expect, it } from "vitest";
import {
  MAX_SIGNAL_STORES,
  selectSignalStores,
} from "../../../src/services/basket/signalStores.js";
import type { StoreSummary } from "../../../src/services/stores/index.js";

/** Distance-ordered candidate, as listStores returns them. */
function store(id: string, chainId: string, distanceKm: number): StoreSummary {
  return {
    id,
    chainId,
    chainName: chainId,
    storeCode: id,
    name: id,
    address: null,
    city: null,
    zip: null,
    lat: 32.1,
    lng: 34.8,
    geoSource: "address",
    storeKind: "branch",
    distanceKm,
  };
}

describe("selectSignalStores", () => {
  it("returns everything when the candidate set is already small", () => {
    const stores = [store("a", "c1", 1), store("b", "c2", 2)];
    expect(selectSignalStores(stores)).toEqual(["a", "b"]);
  });

  /**
   * The regression this exists for: a plain nearest-N slice dropped whole chains,
   * and a chain absent from the sample contributes no commodity-coverage peers, so
   * every one of its branches then reports not_carried_by_chain.
   */
  it("represents every chain even when one chain dominates the nearest stores", () => {
    const stores: StoreSummary[] = [];
    // 50 stores of the dominant chain are all nearer than any rival.
    for (let i = 0; i < 50; i += 1) stores.push(store(`big-${i}`, "dominant", i * 0.1));
    stores.push(store("discount-1", "discount", 8));
    stores.push(store("discount-2", "discount", 9));
    stores.push(store("boutique-1", "boutique", 9.5));

    const picked = new Set(selectSignalStores(stores, 10));
    expect(picked.size).toBe(10);
    // A nearest-10 slice would have been all "dominant".
    expect(picked.has("discount-1")).toBe(true);
    expect(picked.has("boutique-1")).toBe(true);
  });

  it("takes each chain's nearest branch before any chain's second", () => {
    const stores = [
      store("a1", "a", 1),
      store("a2", "a", 2),
      store("b1", "b", 3),
      store("b2", "b", 4),
      store("c1", "c", 5),
    ];
    expect(selectSignalStores(stores, 3)).toEqual(["a1", "b1", "c1"]);
    expect(selectSignalStores(stores, 4)).toEqual(["a1", "b1", "c1", "a2"]);
  });

  it("never exceeds the limit and never repeats a store", () => {
    const stores = Array.from({ length: 400 }, (_, i) =>
      store(`s${i}`, `chain${i % 7}`, i * 0.05),
    );
    const picked = selectSignalStores(stores);
    expect(picked.length).toBe(MAX_SIGNAL_STORES);
    expect(new Set(picked).size).toBe(picked.length);
    // All 7 chains represented.
    const chains = new Set(picked.map((id) => `chain${Number(id.slice(1)) % 7}`));
    expect(chains.size).toBe(7);
  });

  /**
   * The cap must never drop a chain outright — that is the failure this module
   * exists to prevent, and a hard cap below the chain count would reintroduce it
   * via chain count instead of distance.
   */
  it("represents every chain even when chains outnumber the limit", () => {
    const stores = Array.from({ length: 120 }, (_, i) => store(`s${i}`, `chain${i}`, i * 0.1));
    const picked = selectSignalStores(stores, 5);
    expect(picked.length).toBe(120);
    expect(new Set(picked).size).toBe(120);
  });

  it("is deterministic, so a resume reproduces the same sample", () => {
    const stores = Array.from({ length: 200 }, (_, i) =>
      store(`s${i}`, `chain${i % 5}`, i * 0.1),
    );
    expect(selectSignalStores(stores)).toEqual(selectSignalStores(stores));
  });
});
