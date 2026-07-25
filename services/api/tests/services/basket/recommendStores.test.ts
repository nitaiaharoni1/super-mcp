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
  distanceAccuracy: km == null ? "unknown" : "branch",
  storeKind: "branch",
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
  // Real per-line totals: ranking is done on comparable totals built from these,
  // so a line without one would make the medians NaN and the fixture meaningless.
  lines: Array.from({ length: covered }, (_, i) =>
    ({
      itemIndex: i,
      lineTotal: covered > 0 ? total / covered : 0,
      clubOnly: false,
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

  it("inside the coverage band, comparable cost decides", () => {
    // Both incomplete relative to completeLineCount=20, both inside the 1-line
    // band. The same 15 items cost ₪200 at "fifteen" against ₪384 at "sixteen", so
    // the missing 16th item (~₪26) plus a second trip is well worth it.
    expect(
      pickBestSingleStore(
        [store("sixteen", 16, 410, 3), store("fifteen", 15, 200, 1)],
        OPTIONS
      )?.storeName,
    ).toBe("fifteen");
  });

  it("does not chase a small nominal saving that costs an extra trip", () => {
    // ₪380 for 15 items vs ₪384 for the same 15 at a store that also has the 16th.
    // A ₪4 saving does not pay for a second stop, so the fuller store wins.
    expect(
      pickBestSingleStore(
        [store("sixteen", 16, 410, 3), store("fifteen", 15, 380, 1)],
        OPTIONS
      )?.storeName,
    ).toBe("sixteen");
  });

  it("prefers the complete store when the price gap does not justify a second trip", () => {
    // Complete ₪410 for 16 vs ₪400 for 15 of them: near-identical value, so the
    // single trip that finishes the list wins.
    expect(
      pickBestSingleStore(
        [store("complete", 16, 410, 3), store("one-short", 15, 400, 1)],
        OPTIONS
      )?.storeName,
    ).toBe("complete");
  });

  it("prefers a much cheaper incomplete store over an expensive complete one", () => {
    // The same 15 items cost ₪200 here against ₪384 at the complete store. Sending
    // the shopper to the ₪410 store to avoid one ₪26 top-up was the old rule and it
    // cost them ₪170. Completeness is priced now, not treated as a veto.
    expect(
      pickBestSingleStore(
        [store("complete", 16, 410, 3), store("one-short", 15, 200, 1)],
        OPTIONS
      )?.storeName,
    ).toBe("one-short");
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
