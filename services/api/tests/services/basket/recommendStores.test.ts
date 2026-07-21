import { describe, expect, it } from "vitest";
import {
  pickBestSingleStore,
  pickCheapestCompleteStore,
} from "../../../src/services/basket/recommendStores.js";
import type { BasketLine, BasketStoreResult } from "../../../src/services/basket/types.js";

const OPTIONS = { distancePenaltyPerKm: 3, distanceReliable: true };

/** Minimal BasketStoreResult with `covered` priced lines. */
const store = (
  name: string,
  covered: number,
  total: number,
  km: number | null,
): BasketStoreResult => ({
  storeId: name,
  storeName: name,
  chainId: `chain-${name}`,
  chainName: name,
  city: null,
  address: null,
  distanceKm: km,
  currency: "ILS",
  total,
  itemsFound: covered,
  itemsRequested: covered,
  lines: Array.from({ length: covered }, (_, i) =>
    ({
      itemIndex: i,
      link: null,
    }) as BasketLine,
  ),
  missingItems: [],
});

describe("pickBestSingleStore / pickCheapestCompleteStore", () => {
  it("bestSingleStore maximizes coverage before effective cost", () => {
    expect(
      pickBestSingleStore(
        [store("cheap-partial", 13, 200, 1), store("fuller", 16, 390, 2)],
        OPTIONS,
      )?.storeName,
    ).toBe("fuller");
  });

  it("uses effective cost only inside the one-line max-coverage band among incomplete stores", () => {
    // Both incomplete relative to completeLineCount=20 — 1-line band still applies.
    expect(
      pickBestSingleStore(
        [store("sixteen", 16, 410, 3), store("fifteen", 15, 380, 1)],
        OPTIONS,
        20,
      )?.storeName,
    ).toBe("fifteen");
  });

  it("complete N-item store always beats cheaper N-1 store", () => {
    expect(
      pickBestSingleStore(
        [store("complete", 16, 410, 3), store("one-short", 15, 200, 1)],
        OPTIONS,
        16,
      )?.storeName,
    ).toBe("complete");
  });

  it("cheapestCompleteStore is null unless a store prices every resolvable line", () => {
    expect(pickCheapestCompleteStore([store("partial", 15, 300, 1)], 16)).toBeNull();
  });

  it("tie-breaks deterministically by store id", () => {
    expect(
      pickBestSingleStore([store("b", 16, 400, 1), store("a", 16, 400, 1)], OPTIONS)?.storeId,
    ).toBe("a");
  });
});
