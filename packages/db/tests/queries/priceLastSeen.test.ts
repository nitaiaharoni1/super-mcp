import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock("../../src/client/index.js", () => ({ getPool: () => ({ query }) }));

import { bulkUpsertStorePrices } from "../../src/queries/batchWrite.js";
import { upsertStorePrice } from "../../src/queries/prices.js";

/**
 * last_seen_at ("was this item on the shelf?") must be decoupled from source_ts
 * ("did the price change?"). The old row-level `WHERE source_ts <= EXCLUDED`
 * gate skipped the entire UPDATE when a feed republished an older
 * PriceUpdateDate, leaving the row looking delisted to reconciliation even
 * though it had just been seen.
 */
describe("store_price last_seen_at decoupling", () => {
  beforeEach(() => {
    query.mockClear();
  });

  for (const [label, run] of [
    [
      "upsertStorePrice",
      () =>
        upsertStorePrice({
          listingId: "11111111-1111-1111-1111-111111111111",
          storeId: "22222222-2222-2222-2222-222222222222",
          price: 7.9,
          unitPrice: 0.79,
          sourceTs: new Date("2026-07-25T06:00:00Z"),
        }),
    ],
    [
      "bulkUpsertStorePrices",
      () =>
        bulkUpsertStorePrices([
          {
            listingId: "11111111-1111-1111-1111-111111111111",
            storeId: "22222222-2222-2222-2222-222222222222",
            price: 7.9,
            unitPrice: 0.79,
            currency: "ILS",
            allowDiscount: null,
            sourceTs: new Date("2026-07-25T06:00:00Z"),
          },
        ]),
    ],
  ] as const) {
    describe(label, () => {
      it("always refreshes last_seen_at, ungated by source_ts", async () => {
        await run();
        const sql = String(query.mock.calls[0]?.[0]);

        expect(sql).toContain("last_seen_at = now()");
        // The row-level gate is gone: it would have skipped the whole UPDATE.
        expect(sql).not.toMatch(/WHERE\s+store_price\.source_ts\s*<=\s*EXCLUDED\.source_ts/);
      });

      it("still advances price and source_ts only forwards", async () => {
        await run();
        const sql = String(query.mock.calls[0]?.[0]);

        // Each mutable column is individually gated on feed monotonicity.
        expect(sql).toContain(
          "price = CASE WHEN store_price.source_ts <= EXCLUDED.source_ts",
        );
        expect(sql).toContain("ELSE store_price.price END");
        expect(sql).toContain("GREATEST(store_price.source_ts, EXCLUDED.source_ts)");
      });

      it("does not refresh ingested_at when the incoming row is older", async () => {
        await run();
        const sql = String(query.mock.calls[0]?.[0]);

        // ingested_at means "when we last applied a price", so it stays gated.
        expect(sql).toContain("ELSE store_price.ingested_at END");
      });

      it("writes last_seen_at on first insert", async () => {
        await run();
        const sql = String(query.mock.calls[0]?.[0]);
        expect(sql).toMatch(/INSERT INTO store_price \([^)]*last_seen_at/s);
      });
    });
  }
});
