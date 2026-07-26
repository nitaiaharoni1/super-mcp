/**
 * A typed street address must be geocoded properly, whatever the resolution mode.
 *
 * Location precision used to follow `resolution_mode`, which controls how
 * carefully PRODUCTS are matched. The two are unrelated, so a shopper on the
 * default fast path had their address silently replaced by the city centre.
 * Measured for "מנדלסון 1, תל אביב": fast gave 32.0853, 34.7818 (mid Tel Aviv),
 * precise gave 32.0820, 34.7766, the real street, roughly 600m away. On a product
 * whose whole point is "which shop is nearest", 600m reorders the answer.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const resolveToolLocation = vi.fn();
const optimizeBasket = vi.fn();

vi.mock("../../src/mcp/tools/shared/location.js", () => ({
  locationShape: {},
  resolveToolLocation: (...a: unknown[]) => resolveToolLocation(...a),
}));
vi.mock("../../src/services/basket/index.js", () => ({
  optimizeBasket: (...a: unknown[]) => optimizeBasket(...a),
}));

interface Registered { handler: (args: Record<string, unknown>) => Promise<unknown> }
const registered = new Map<string, Registered>();
vi.mock("../../src/mcp/tools/register.js", () => ({
  registerTool: (_s: unknown, name: string, _cfg: unknown, handler: Registered["handler"]) => {
    registered.set(name, { handler });
  },
}));

async function callOptimize(args: Record<string, unknown>): Promise<void> {
  const { registerBasketTools } = await import("../../src/mcp/tools/basket/index.js");
  registerBasketTools({} as never);
  const tool = registered.get("optimize_basket");
  if (!tool) throw new Error("optimize_basket was not registered");
  await tool.handler(args).catch(() => undefined);
}

beforeEach(() => {
  vi.resetModules();
  registered.clear();
  resolveToolLocation.mockReset().mockResolvedValue({
    city: "תל אביב-יפו",
    near: { lat: 32.082, lng: 34.7766 },
    radiusKm: 10,
    locationOrigin: {},
    geocodeMs: 1,
  });
  optimizeBasket.mockReset().mockResolvedValue({ status: "complete", items: [], stores: [] });
  process.env.BASKET_CONTINUATION_SECRET = "test-only-basket-continuation-secret-ok-32bytes";
});

const items = [{ query: "חלב", pack_qty: 1 }];

describe("geocode strategy follows the input, not the resolution mode", () => {
  it("uses precise for a typed address even in fast mode", async () => {
    await callOptimize({ items, location: "מנדלסון 1, תל אביב", resolution_mode: "fast" });
    expect(resolveToolLocation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ geocodeStrategy: "precise" }),
    );
  });

  it("uses precise for a typed address in strict mode too", async () => {
    await callOptimize({ items, location: "מנדלסון 1, תל אביב", resolution_mode: "strict" });
    expect(resolveToolLocation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ geocodeStrategy: "precise" }),
    );
  });

  it("keeps the fast path for a bare city, where there is nothing finer to find", async () => {
    await callOptimize({ items, city: "תל אביב", resolution_mode: "fast" });
    expect(resolveToolLocation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ geocodeStrategy: "fast" }),
    );
  });

  it("keeps the fast path for explicit coordinates, which need no lookup", async () => {
    await callOptimize({ items, near: "32.082,34.7766", resolution_mode: "fast" });
    expect(resolveToolLocation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ geocodeStrategy: "fast" }),
    );
  });
});
