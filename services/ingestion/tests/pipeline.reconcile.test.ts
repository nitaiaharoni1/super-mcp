import type { FeedFile, SourceAdapter } from "@super-mcp/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reconcileStorePrices = vi.fn();
const normalizeRecords = vi.fn();
const parseFeedFile = vi.fn();

vi.mock("@super-mcp/db", () => ({
  reconcileStorePrices: (...args: unknown[]) => reconcileStorePrices(...args),
}));
vi.mock("../src/pipeline/normalize.js", () => ({
  normalizeRecords: (...args: unknown[]) => normalizeRecords(...args),
}));
vi.mock("../src/pipeline/parse.js", () => ({
  parseFeedFile: (...args: unknown[]) => parseFeedFile(...args),
}));

import { processFeedFile } from "../src/pipeline/processFile.js";

const adapter = { sourceId: "il-cerberus", market: "IL" } as unknown as SourceAdapter;

function file(kind: FeedFile["kind"], storeId = "001"): FeedFile {
  return {
    sourceId: "il-cerberus",
    kind,
    chainId: "7290058140886",
    storeId,
    remotePath: `/${kind}`,
    fileName: `${kind}-${storeId}.gz`,
  };
}

function normalizeResult(over: Record<string, unknown> = {}) {
  return {
    rowsOk: 900,
    rowsError: 0,
    errors: [],
    promoOther: 0,
    unitUnparseable: 0,
    regionFiltered: 0,
    storeCityFromName: 0,
    pricesByStore: new Map([["store-uuid-1", 900]]),
    ...over,
  };
}

beforeEach(() => {
  reconcileStorePrices.mockReset().mockResolvedValue({
    deleted: 12,
    totalBefore: 1000,
    staleFound: 12,
    skipped: null,
  });
  normalizeRecords.mockReset().mockResolvedValue(normalizeResult());
  parseFeedFile.mockReset().mockResolvedValue({ records: [] });
});

describe("delisting reconciliation gate", () => {
  it("reconciles after a clean full price snapshot", async () => {
    const stats = await processFeedFile(adapter, file("pricesfull"), "/tmp");

    expect(reconcileStorePrices).toHaveBeenCalledTimes(1);
    expect(reconcileStorePrices).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: "store-uuid-1", rowsSeen: 900 }),
    );
    expect(stats.pricesReconciled).toBe(12);
  });

  it("NEVER reconciles from a delta price file", async () => {
    // A delta lists only changed items; deleting the rest would wipe the store.
    const stats = await processFeedFile(adapter, file("prices"), "/tmp");

    expect(reconcileStorePrices).not.toHaveBeenCalled();
    expect(stats.pricesReconciled).toBe(0);
  });

  it("does not reconcile from a promo or stores file", async () => {
    await processFeedFile(adapter, file("promosfull"), "/tmp");
    await processFeedFile(adapter, file("stores"), "/tmp");
    expect(reconcileStorePrices).not.toHaveBeenCalled();
  });

  it("does not reconcile when the file reported row errors", async () => {
    // Errored rows may be items we simply failed to write, not delisted ones.
    normalizeRecords.mockResolvedValue(normalizeResult({ rowsError: 3 }));
    const stats = await processFeedFile(adapter, file("pricesfull"), "/tmp");

    expect(reconcileStorePrices).not.toHaveBeenCalled();
    expect(stats.pricesReconciled).toBe(0);
  });

  it("does not reconcile when the snapshot wrote no price rows at all", async () => {
    normalizeRecords.mockResolvedValue(normalizeResult({ pricesByStore: new Map() }));
    await processFeedFile(adapter, file("pricesfull"), "/tmp");
    expect(reconcileStorePrices).not.toHaveBeenCalled();
  });

  it("passes a cutoff captured before any row was written", async () => {
    const before = new Date();
    await processFeedFile(adapter, file("pricesfull"), "/tmp");
    const after = new Date();

    const seenSince = reconcileStorePrices.mock.calls[0]?.[0].seenSince as Date;
    // Rows refreshed by THIS file must sort after the cutoff, so it has to be
    // taken before parsing starts.
    expect(seenSince.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
    expect(seenSince.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("reconciles every store the file touched", async () => {
    normalizeRecords.mockResolvedValue(
      normalizeResult({
        pricesByStore: new Map([
          ["store-a", 500],
          ["store-b", 700],
        ]),
      }),
    );
    const stats = await processFeedFile(adapter, file("pricesfull"), "/tmp");

    expect(reconcileStorePrices).toHaveBeenCalledTimes(2);
    expect(stats.pricesReconciled).toBe(24);
  });

  it("records why reconciliation declined without failing the file", async () => {
    reconcileStorePrices.mockResolvedValue({
      deleted: 0,
      totalBefore: 1000,
      staleFound: 600,
      skipped: "delete_ratio_exceeded",
    });
    const stats = await processFeedFile(adapter, file("pricesfull"), "/tmp");

    expect(stats.processed).toBe(true);
    expect(stats.pricesReconciled).toBe(0);
    expect(stats.reconcileSkips).toEqual({ delete_ratio_exceeded: 1 });
  });

  it("survives a reconciliation error — hygiene never fails an ingested file", async () => {
    reconcileStorePrices.mockRejectedValue(new Error("deadlock detected"));
    const stats = await processFeedFile(adapter, file("pricesfull"), "/tmp");

    expect(stats.processed).toBe(true);
    expect(stats.ok).toBe(900);
    expect(stats.pricesReconciled).toBe(0);
  });
});
