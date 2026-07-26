/**
 * Out-of-coverage branches must not be recommended.
 *
 * The nightly ingest only refreshes Gush Dan/Sharon, Jerusalem, Haifa and
 * Beersheva. Branches outside that area exist only because the 2026-07-18
 * backfill ran nationally with the region filter off. Measured 2026-07-26: 277 of
 * 888 branches sit outside, frozen at 07-18 prices with no prospect of an update,
 * and the basket was happily quoting them.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

beforeEach(() => {
  vi.resetModules();
  queryMock.mockReset().mockResolvedValue({ rows: [] });
});

async function sqlFor(params: Record<string, unknown>): Promise<string> {
  const { listStores } = await import("../../../src/services/stores/listStores.js");
  await listStores(params as never);
  return String(queryMock.mock.calls[0]?.[0] ?? "");
}

describe("coverage filter on store selection", () => {
  it("excludes frozen branches when picking somewhere to shop", async () => {
    const sql = await sqlFor({ shoppableOnly: true, city: "הרצליה" });
    expect(sql).toContain("in_coverage IS NOT FALSE");
  });

  it("keeps showing everything in the public store directory", async () => {
    // The directory labels each row instead of hiding it, so someone browsing can
    // still see that a branch exists even if we cannot price it freshly.
    const sql = await sqlFor({ city: "אילת" });
    expect(sql).not.toContain("in_coverage");
  });

  it("treats an unevaluated store as visible, never hidden", async () => {
    // NULL means the marking script has not run yet. `IS NOT FALSE` keeps those
    // rows, so adding the column can never blank out the store list; only an
    // explicit false hides a store.
    const sql = await sqlFor({ shoppableOnly: true, city: "הרצליה" });
    expect(sql).toContain("IS NOT FALSE");
    expect(sql).not.toMatch(/in_coverage\s*=\s*true/i);
    expect(sql).not.toMatch(/in_coverage\s+IS\s+TRUE/i);
  });

  it("still filters out non-branch endpoints alongside coverage", async () => {
    // Both guards have to survive together: an online storefront inside the
    // coverage area is still not somewhere you can drive to.
    const sql = await sqlFor({ shoppableOnly: true, city: "הרצליה" });
    expect(sql).toContain("store_kind");
    expect(sql).toContain("in_coverage");
  });
});
