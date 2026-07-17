import { describe, expect, it } from "vitest";
import { cosineSimilarity, HE_RETAIL } from "@super-mcp/shared/test-utils";
import { embedTextLocal, LOCAL_EMBED_DIMS } from "../../src/embeddings/localEmbed.js";

describe("embedTextLocal", () => {
  it("returns unit vectors of fixed dims", () => {
    const v = embedTextLocal(HE_RETAIL.query.freshChickenThighs);
    expect(v).toHaveLength(LOCAL_EMBED_DIMS);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("places near-duplicate Hebrew retail names closer than unrelated ones", () => {
    const a = embedTextLocal(HE_RETAIL.query.freshChickenThighs);
    const b = embedTextLocal(HE_RETAIL.product.freshChickenThighsPack);
    const c = embedTextLocal(HE_RETAIL.product.unrelatedMilk);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });
});
