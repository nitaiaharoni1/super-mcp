import { describe, expect, it } from "vitest";
import { getDeliveryTerms, listDeliveryOptions } from "../../../src/services/delivery/deliveryOptions.js";

describe("a coverage verdict needs an address to be about", () => {
  it("returns no verdict from get_delivery_terms, which never sees one", async () => {
    // getDeliveryTerms takes a slug and nothing else, so it cannot test an
    // address. It used to hardcode {serves:false, reason:"address_too_vague"},
    // which reads as "this storefront does not deliver to you" on a tool whose
    // whole job is to describe the storefront's published terms.
    const terms = await getDeliveryTerms("shufersal-online");
    expect(terms.service.coverage).toBeNull();
    // The published rules themselves are still returned, which is the thing the
    // caller actually asked for.
    expect(terms.coverage.length).toBeGreaterThan(0);
  });

  it("still returns a real verdict when an address IS given", async () => {
    const { options } = await listDeliveryOptions({ city: "תל אביב-יפו" });
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.coverage, option.serviceSlug).not.toBeNull();
      expect(option.coverage!.serves).toBe(true);
    }
  });
});
