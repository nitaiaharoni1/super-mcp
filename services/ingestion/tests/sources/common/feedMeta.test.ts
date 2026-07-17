import { describe, expect, it } from "vitest";
import { classifyFeedFile, parseFeedFileMeta } from "../../../src/sources/common/feedMeta.js";

describe("classifyFeedFile", () => {
  it("classifies common Israeli feed names", () => {
    expect(classifyFeedFile("PriceFull7290055700007-001-416-20260717-000012.gz")).toBe(
      "pricesfull",
    );
    expect(classifyFeedFile("PromoFull7290058140886-001-202403280000.xml.gz")).toBe(
      "promosfull",
    );
    expect(classifyFeedFile("Stores7290027600007-000-20260717.xml")).toBe("stores");
    expect(classifyFeedFile("readme.txt")).toBe("other");
  });
});

describe("parseFeedFileMeta", () => {
  it("parses classic Cerberus/Shufersal filenames as Israel-local time", () => {
    const meta = parseFeedFileMeta("PriceFull7290058140886-042-202403281530.xml.gz");
    expect(meta.storeId).toBe("042");
    // 2024-03-28 15:30 Asia/Jerusalem (UTC+2 winter) → 13:30Z
    expect(meta.publishedAt!.toISOString()).toBe("2024-03-28T13:30:00.000Z");
  });

  it("parses Carrefour PublishPrice 5-part filenames (store is 3rd segment)", () => {
    const meta = parseFeedFileMeta("PriceFull7290055700007-001-416-20260717-000012.gz");
    expect(meta.storeId).toBe("416");
    // 2026-07-17 00:00:12 Asia/Jerusalem (UTC+3 DST) → 2026-07-16 21:00:12Z
    expect(meta.publishedAt!.toISOString()).toBe("2026-07-16T21:00:12.000Z");
  });

  it("returns empty meta when filename does not match known shapes", () => {
    expect(parseFeedFileMeta("notes.txt")).toEqual({});
  });
});
