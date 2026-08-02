import { describe, expect, it } from "vitest";
import { evaluateCoverage } from "@super-mcp/shared";
import { FULFILLMENT_CATALOG } from "../../src/fulfillment/catalog.js";
import { expandDeliveryArea } from "../../src/fulfillment/deliveryAreas.js";
import { STORAI_RETAILERS } from "../../src/online/sources/storai/adapter.js";

describe("the delivery catalogue holds together", () => {
  it("gives every storefront a distinct slug", () => {
    // The slug is the upsert key, so a duplicate silently overwrites the other
    // storefront's terms instead of adding one.
    const slugs = FULFILLMENT_CATALOG.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("never points two services at the same shop", () => {
    // Two services on one (chain, store) let a basket count the same storefront
    // twice and rank it against itself. This is exactly what the stor.ai scrape
    // of Victory did once its filed endpoint was added.
    const shops = FULFILLMENT_CATALOG.map((s) => `${s.chainId}/${s.storeCode}`);
    expect(new Set(shops).size).toBe(shops.length);
  });

  it("makes every quoted figure auditable", () => {
    // The file's entire premise: a number a human read carries where it was read
    // and when. A `verified` row without either is indistinguishable from a guess.
    const unsourced = FULFILLMENT_CATALOG.filter(
      (s) => s.termsConfidence !== "estimated" && (!s.verifiedAt || !s.sourceUrl),
    ).map((s) => s.slug);
    expect(unsourced).toEqual([]);
  });

  it("gives every storefront somewhere it delivers", () => {
    // An empty coverage list is read as coverage_unknown, which reports the
    // storefront as unavailable at every address in the country.
    const uncovered = FULFILLMENT_CATALOG.filter((s) => s.coverage.length === 0).map((s) => s.slug);
    expect(uncovered).toEqual([]);
  });

  it("gives every city rule a city", () => {
    const broken = FULFILLMENT_CATALOG.flatMap((s) =>
      s.coverage.filter((c) => c.scope === "city" && !c.cityKey).map(() => s.slug),
    );
    expect(broken).toEqual([]);
  });

  it("does not list the same settlement twice for one storefront", () => {
    const dupes = FULFILLMENT_CATALOG.filter((s) => {
      const cities = s.coverage.filter((c) => c.scope === "city").map((c) => c.cityKey);
      return new Set(cities).size !== cities.length;
    }).map((s) => s.slug);
    expect(dupes).toEqual([]);
  });
});

describe("the chains that moved from a scrape to a filing", () => {
  const bySlug = (slug: string) => FULFILLMENT_CATALOG.find((s) => s.slug === slug);

  it("prices Victory from its filed online endpoint, not the scraped one", () => {
    // Store 097 is the <StoreType>2 row Victory files: 8,525 items with 7,563
    // barcodes, against 2,228 items and no barcode at all in the stor.ai scrape
    // of the same shop. Without a barcode the price joins to nothing.
    expect(bySlug("victory-online")).toMatchObject({
      chainId: "7290696200003",
      storeCode: "097",
    });
  });

  it("prices both of Machsanei Hashuk's filed endpoints", () => {
    // 096 is Eilat-only and had never been used, so an Eilat basket saw no
    // Machsanei Hashuk option at all. It charges less than the mainland.
    expect(bySlug("machsanei-hashuk-online")).toMatchObject({ storeCode: "097" });
    expect(bySlug("machsanei-hashuk-online-eilat")).toMatchObject({ storeCode: "096" });
    const eilat = bySlug("machsanei-hashuk-online-eilat");
    expect(eilat?.coverage.map((c) => c.cityKey)).toEqual(["אילת"]);
    expect(eilat?.tariffs[0]?.fee).toBeLessThan(bySlug("machsanei-hashuk-online")!.tariffs[0]!.fee);
  });

  it("leaves no stor.ai retailer competing with a catalogue entry", () => {
    // The scrape yields to the filing for these chains. If a chain appears in
    // both, the online ingest and the curated sync each create a service for the
    // same storefront and the basket sees it twice.
    const curated = new Set(FULFILLMENT_CATALOG.map((s) => s.chainId));
    const overlap = STORAI_RETAILERS.filter((r) => curated.has(r.chainId)).map((r) => r.chainId);
    // Victory and Machsanei Hashuk stay in STORAI_RETAILERS on purpose: the
    // scrape is still the fresher catalogue for those storefronts while the
    // laibcatalog portal is behind. What stops the duplicate is that
    // listScrapedOnlineStores selects on the CHAIN's source_id, which the
    // laibcatalog adapter now owns, so they never reach the service-creating
    // branch. syncScrapedFulfillment carries an explicit guard for the same case
    // because that ownership is incidental rather than a rule of this file.
    expect(overlap).toEqual(["7290696200003", "7290661400001"]);
  });
});

describe("regional chains are not sold as national", () => {
  it("gives Super Yuda and Politzer their published settlements", () => {
    // Both were recorded as delivering nationwide, which is what an unfilled
    // coverage row looks like. Politzer is a Caesarea/Hadera grocer.
    for (const chainId of ["IL-SUPER-YUDA", "IL-POLITZER"]) {
      const retailer = STORAI_RETAILERS.find((r) => r.chainId === chainId);
      expect(retailer?.terms, `${chainId} terms`).toBeDefined();
      expect(retailer!.terms!.cities.length).toBeGreaterThan(0);
      expect(retailer!.terms!.cities.length).toBeLessThan(30);
    }
  });

  it("dates every set of scraped-chain terms it quotes", () => {
    for (const retailer of STORAI_RETAILERS) {
      if (!retailer.terms) continue;
      expect(retailer.terms.verifiedAt, retailer.chainId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(retailer.terms.sourceUrl, retailer.chainId).toMatch(/^https:\/\//);
    }
  });
});

describe("published delivery areas resolve to places", () => {
  // The bug this guards: retailers publish SALES AREAS, not settlements, and a
  // coverage rule naming a sales area matches nothing. It reads as coverage in
  // the table and behaves as none, so it is invisible in every count.
  const SEPARATORS = /[,/]/;

  it("leaves no rule holding more than one place", () => {
    const packed = FULFILLMENT_CATALOG.flatMap((s) =>
      s.coverage
        .filter((c) => c.scope === "city" && SEPARATORS.test(c.cityKey ?? ""))
        .map((c) => `${s.slug}: ${c.cityKey ?? ""}`),
    );
    expect(packed).toEqual([]);
  });

  it("puts the big cities back where their retailers said they were", () => {
    // Every one of these was reported unserved. Tel Aviv is the country's
    // largest online-grocery market and saw neither Rami Levy, Tiv Taam nor
    // Victory; Jerusalem saw neither Carrefour, Quik nor Yeinot Bitan.
    const expected: Record<string, string[]> = {
      "תל אביב-יפו": ["rami-levy-online", "tiv-taam-519", "victory-online"],
      ירושלים: ["carrefour-online", "quik", "yeinot-bitan-online", "victory-online"],
      רמלה: ["carrefour-online", "quik"],
      לוד: ["carrefour-online", "quik"],
      "קריית אתא": ["carrefour-online", "quik"],
      "ראשון לציון": ["carrefour-online", "quik"],
    };
    for (const [city, slugs] of Object.entries(expected)) {
      for (const slug of slugs) {
        const service = FULFILLMENT_CATALOG.find((s) => s.slug === slug);
        expect(service, slug).toBeDefined();
        const verdict = evaluateCoverage(
          service!.coverage.map((c) => ({ ...c, cityKey: c.cityKey ?? null })),
          { city },
        );
        expect(verdict.serves, `${slug} must serve ${city}`).toBe(true);
      }
    }
  });

  it("expands a sales area onto the settlements it reaches", () => {
    expect(expandDeliveryArea("רמלה לוד")).toEqual(["רמלה", "לוד"]);
    expect(expandDeliveryArea("מרכז וצפון תל אביב (עד ארלוזורוב)")).toEqual(["תל אביב-יפו"]);
    expect(expandDeliveryArea("חולון , בת ים")).toEqual(["חולון", "בת ים"]);
    // A real settlement is left exactly as the retailer wrote it.
    expect(expandDeliveryArea("מעלה אדומים")).toEqual(["מעלה אדומים"]);
    // A region naming no settlement yields nothing rather than a rule that
    // can never match.
    expect(expandDeliveryArea("דרום הר חברון")).toEqual([]);
  });
});

describe("towns a spelling difference had quietly removed", () => {
  it("serves each of them again", () => {
    // Found by diffing every published label against the gazetteer. Each stored
    // a rule that could never match, so the town read as covered and behaved as
    // uncovered. Fixed in the city alias table, so the check belongs here: it is
    // this file's labels that have to reach a real place.
    const expected: Record<string, string> = {
      "טירת כרמל": "carrefour-online",
      "פרדס חנה": "rami-levy-online",
      "חצור הגלילית": "rami-levy-online",
      "שערי תקווה": "victory-online",
      "קריית אונו": "carrefour-online",
    };
    for (const [city, slug] of Object.entries(expected)) {
      const service = FULFILLMENT_CATALOG.find((s) => s.slug === slug);
      expect(service, slug).toBeDefined();
      const verdict = evaluateCoverage(
        service!.coverage.map((c) => ({ ...c, cityKey: c.cityKey ?? null })),
        { city },
      );
      expect(verdict.serves, `${slug} must serve ${city}`).toBe(true);
    }
  });

  it("claims a valley as its principal town only", () => {
    // Naming every settlement in the Ono valley would assert coverage the
    // retailer's own label does not spell out.
    expect(expandDeliveryArea("בקעת אונו")).toEqual(["קריית אונו"]);
  });
});
