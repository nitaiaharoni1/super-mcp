/**
 * A Wolt venue must land under its BRAND's chain, never a single "Wolt".
 *
 * Wolt sets its own price rather than passing a chain's through (about +25% on the
 * one venue that also files a regulated feed), so "Victory on Wolt" is a different
 * price book from "Victory". Collapsing every venue into one IL-WOLT chain made
 * the two indistinguishable in results, and would let a Wolt price be mistaken for
 * a shelf price.
 *
 * The allowlist is also the venue gate. Wolt's own product_line is far too coarse:
 * grocery + convenience alone admits 517 venues across 276 brands, 211 of them a
 * single corner shop, and the wider set admitted Adidas and a hookah shop. Because
 * a store row alone becomes an active delivery storefront, those went live as
 * storefronts stocking nothing.
 */
import { describe, expect, it } from "vitest";
import {
  WOLT_BRANDS,
  WOLT_CHAIN_IDS,
  woltBrandForVenue,
} from "../../src/online/sources/wolt/brands.js";
import { lookupChainNames } from "@super-mcp/shared";

describe("woltBrandForVenue", () => {
  it("routes each allowlisted brand to its own chain", () => {
    expect(woltBrandForVenue("Wolt Market | Ben Yehuda")?.chainId).toBe("IL-WOLT-MARKET");
    expect(woltBrandForVenue("Victory | Ashdod")?.chainId).toBe("IL-WOLT-VICTORY");
    expect(woltBrandForVenue("Machsanei HaShuk | Netanya")?.chainId).toBe("IL-WOLT-MACHSANEI");
  });

  it("matches the Hebrew spelling too, since the name is user-facing text", () => {
    expect(woltBrandForVenue("ויקטורי | אשדוד")?.chainId).toBe("IL-WOLT-VICTORY");
    expect(woltBrandForVenue("מחסני השוק | נתניה")?.chainId).toBe("IL-WOLT-MACHSANEI");
    expect(woltBrandForVenue("וולט מרקט | בן יהודה")?.chainId).toBe("IL-WOLT-MARKET");
  });

  // These four already have their own priced online storefronts, so their Wolt
  // venues would only add a reliably dearer duplicate that can never win.
  it("excludes chains that already sell online directly", () => {
    for (const name of [
      "Shufersal | מרמורק",
      "Carrefour | רמת אביב",
      "Rami Levy In The Neighborhood | חולון",
      "Tiv Ta'am | רמת החייל",
    ]) {
      expect(woltBrandForVenue(name)).toBeNull();
    }
  });

  // The venues that actually reached the live delivery options with zero prices.
  it("excludes the venues that caused the incident", () => {
    for (const name of [
      "123 יין ואלכוהול | ת״א מרכז",
      "אדידס | פתח תקווה",
      "אדיר הנרגילות | טירת הכרמל",
      "אפרודיטה | חיפה",
      "אלמה מרקט | דיזנגוף",
      "פור טוונטי אנד קו | דיזינגוף",
    ]) {
      expect(woltBrandForVenue(name)).toBeNull();
    }
  });

  // Only the brand segment is matched, so a branch that merely mentions another
  // chain in its own name cannot be misrouted to it.
  it("matches the brand segment, not the whole name", () => {
    expect(woltBrandForVenue("am:pm | ויקטוריה")).toBeNull();
    expect(woltBrandForVenue("Sweetime | Victory Mall")).toBeNull();
  });

  it("every allowlisted chain has a display name in both languages", () => {
    for (const brand of WOLT_BRANDS) {
      const names = lookupChainNames(brand.chainId);
      // lookupChainNames echoes the id back when it has no entry.
      expect(names.he).not.toBe(brand.chainId);
      expect(names.en).not.toBe(brand.chainId);
      expect(names.he).toBe(brand.he);
    }
  });

  it("names make the Wolt origin visible to a shopper", () => {
    expect(lookupChainNames("IL-WOLT-VICTORY").he).toContain("וולט");
    expect(lookupChainNames("IL-WOLT-MACHSANEI").he).toContain("וולט");
    // And stay distinct from the feed-based chain of the same retailer.
    expect(lookupChainNames("IL-WOLT-VICTORY").he).not.toBe(lookupChainNames("7290696200003").he);
  });

  it("exposes every brand chain id for the pipeline's expected-chain check", () => {
    expect([...WOLT_CHAIN_IDS].sort()).toEqual(
      ["IL-WOLT-MACHSANEI", "IL-WOLT-MARKET", "IL-WOLT-VICTORY"].sort(),
    );
    expect(WOLT_CHAIN_IDS).not.toContain("IL-WOLT");
  });
});
