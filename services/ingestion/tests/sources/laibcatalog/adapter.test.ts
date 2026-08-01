import { describe, expect, it } from "vitest";
import {
  laibFileUrl,
  laibSearchDates,
  parseAspNetTokens,
  parseFileLinks,
  preferCompressed,
} from "../../../src/sources/laibcatalog/index.js";
import { classifyFeedFile, parseFeedFileMeta } from "../../../src/sources/common/feedMeta.js";

describe("laibcatalog postback tokens", () => {
  const page = `<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="abc&#39;def" />
    <input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="CA0B0334" />
    <input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="xyz&amp;123" />`;

  it("reads the three fields the search postback requires", () => {
    expect(parseAspNetTokens(page)).toEqual({
      viewState: "abc'def",
      viewStateGenerator: "CA0B0334",
      eventValidation: "xyz&123",
    });
  });

  it("throws rather than posting a form the portal will reject", () => {
    // An empty __VIEWSTATE still POSTs fine and comes back as the unfiltered
    // landing page, which parses as zero files — indistinguishable from "the
    // chain filed nothing today". Failing here keeps that from reading as a
    // quiet blackout.
    expect(() => parseAspNetTokens("<html><body>no form</body></html>")).toThrow(
      /__VIEWSTATE/,
    );
  });
});

describe("laibcatalog result links", () => {
  // Real markup from the 2026-08-01 search response: the first two segments use
  // Windows separators and the third does not.
  const html = `<td>
      <a href='CompetitionRegulationsFiles\\latest\\7290455000004/StoresFull7290455000004-000-202608010627-000.xml.gz'><u>לחץ כאן להורדה</u></a>
    </td>
    <td>
      <a href='CompetitionRegulationsFiles\\archive\\7290696200003/PriceFull7290696200003-001-001-20260724-050955.gz'><u>לחץ כאן להורדה</u></a>
    </td>`;

  it("normalises the mixed separators into one path shape", () => {
    expect(parseFileLinks(html)).toEqual([
      "CompetitionRegulationsFiles/latest/7290455000004/StoresFull7290455000004-000-202608010627-000.xml.gz",
      "CompetitionRegulationsFiles/archive/7290696200003/PriceFull7290696200003-001-001-20260724-050955.gz",
    ]);
  });

  it("ignores the sort-header postbacks that share the row markup", () => {
    const sortable = `<a href="javascript:__doPostBack('ctl00$MainContent$lblTableHeaderName','')">שם הקובץ</a>`;
    expect(parseFileLinks(sortable)).toEqual([]);
  });

  it("builds an absolute URL under the portal host", () => {
    expect(
      laibFileUrl("CompetitionRegulationsFiles/archive/7290696200003/PriceFull7290696200003-001-001-20260724-050955.gz"),
    ).toBe(
      "https://laibcatalog.co.il/CompetitionRegulationsFiles/archive/7290696200003/PriceFull7290696200003-001-001-20260724-050955.gz",
    );
  });
});

describe("laibcatalog duplicate encodings", () => {
  it("keeps the gzip copy when the portal lists the same filing twice", () => {
    // Every Stores filing appears as both `.gz` and `.XML`. Ingesting both
    // parses the same store list twice per run for no extra data.
    const paths = preferCompressed([
      "CompetitionRegulationsFiles/archive/7290696200003/Stores7290696200003-000-20260724060100-060100.XML",
      "CompetitionRegulationsFiles/archive/7290696200003/Stores7290696200003-000-20260724060100-060100.gz",
    ]);
    expect(paths).toEqual([
      "CompetitionRegulationsFiles/archive/7290696200003/Stores7290696200003-000-20260724060100-060100.gz",
    ]);
  });

  it("keeps distinct filings apart", () => {
    const paths = preferCompressed([
      "a/PriceFull7290696200003-001-001-20260724-050955.gz",
      "a/PriceFull7290696200003-001-076-20260724-050939.gz",
    ]);
    expect(paths).toHaveLength(2);
  });
});

describe("laibcatalog search dates", () => {
  it("asks the portal for Israel calendar days in its own dd/MM/yyyy format", () => {
    // 22:00 UTC on Jul 16 is already Jul 17 in Israel; querying the UTC day
    // would skip the newest filings for three hours every night.
    expect(laibSearchDates(3, new Date("2026-07-16T22:00:00.000Z"))).toEqual([
      "17/07/2026",
      "16/07/2026",
      "15/07/2026",
    ]);
  });
});

describe("laibcatalog filenames route through the shared feed helpers", () => {
  // The portal uses two naming shapes and both have to resolve to a store id,
  // because selectRegionalFeedFiles drops any price file whose store it cannot
  // place — silently, and the chain then ingests as zero rows.
  it("reads store and publish time from a PriceFull filing", () => {
    const name = "PriceFull7290696200003-001-001-20260724-050955.gz";
    expect(classifyFeedFile(name)).toBe("pricesfull");
    const meta = parseFeedFileMeta(name);
    expect(meta.storeId).toBe("001");
    expect(meta.publishedAt?.toISOString()).toBe("2026-07-24T02:09:55.000Z");
  });

  it("recognises the plain Stores file the storesfull filter does not match", () => {
    // Victory and Machsanei Hashuk publish `Stores`, never `StoresFull`, so a
    // discovery pass narrowed to fileType=storesfull finds no store list for
    // them at all.
    const name = "Stores7290696200003-000-20260724060100-060100.gz";
    expect(classifyFeedFile(name)).toBe("stores");
  });

  it("recognises the StoresFull file H. Cohen publishes", () => {
    expect(classifyFeedFile("StoresFull7290455000004-000-202608010627-000.xml.gz")).toBe(
      "stores",
    );
  });

  it("classifies PromoFull filings", () => {
    expect(classifyFeedFile("PromoFull7290661400001-003-205-20260724-162546.gz")).toBe(
      "promosfull",
    );
  });
});
