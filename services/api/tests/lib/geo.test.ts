import { describe, expect, it } from "vitest";
import { geoBoundingBoxSql, haversineKmSql, parseNear } from "../../src/lib/geo.js";

describe("geo SQL helpers", () => {
  it("builds haversine expression with param indexes", () => {
    const sql = haversineKmSql(1, 2, "st.lat", "st.lng");
    expect(sql).toContain("$1");
    expect(sql).toContain("$2");
    expect(sql).toContain("st.lat");
  });

  it("builds bounding-box prefilter using radius param", () => {
    const sql = geoBoundingBoxSql(1, 2, 3, "st.lat", "st.lng");
    expect(sql).toContain("$3");
    expect(sql).toContain("BETWEEN");
    expect(sql).toContain("st.lat <> 0");
  });

  it.each(["0,0", "32.16,0", "40.71,-74.01"])(
    "rejects near points outside the supported Israel region (%s)",
    (near) => {
      expect(() => parseNear(near)).toThrow(/supported Israel region/);
    },
  );
});
