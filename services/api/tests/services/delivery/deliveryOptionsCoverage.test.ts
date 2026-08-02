import { describe, expect, it } from "vitest";
import { getDeliveryTerms, listDeliveryOptions } from "../../../src/services/delivery/deliveryOptions.js";
import { optimizeDelivery } from "../../../src/services/delivery/optimizeDelivery.js";

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
    const { options, destinationKnown } = await listDeliveryOptions({ city: "תל אביב-יפו" });
    expect(destinationKnown).toBe(true);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.coverage, option.serviceSlug).not.toBeNull();
      expect(option.coverage!.serves).toBe(true);
    }
  });

  it("does not claim to have placed a destination nothing recognised", async () => {
    // The old test was `destination.city != null`, and an unknown name was
    // echoed straight back into that field. So a typo came back
    // destinationKnown:true carrying exactly one storefront, and an agent would
    // report "only Shufersal delivers to you" about an address it never placed.
    // That one hit was the NATIONAL rule, which serves everyone and is
    // therefore no evidence at all.
    const { options, destinationKnown } = await listDeliveryOptions({ city: "זזזזזזז" });
    expect(destinationKnown).toBe(false);
    // Not a refusal: without a verdict to give, every storefront is listed with
    // its coverage explicitly unknown.
    expect(options.length).toBeGreaterThan(1);
    for (const option of options) {
      expect(option.coverage, option.serviceSlug).toBeNull();
    }
  });

  it("keeps a town the canonical list has never heard of", async () => {
    // Roughly 1,200 Israeli localities against 135 canonical ones, so the raw
    // name has to stay in play or every small town falls back to national-only.
    const { destinationKnown, options } = await listDeliveryOptions({ city: "תל אביב" });
    expect(destinationKnown).toBe(true);
    expect(options.some((o) => o.coverage?.matchedScope !== "national")).toBe(true);
  });

  it("optimize_delivery says when a priced plan is for an address it never placed", async () => {
    // The same hole on the pricing surface, where it costs more: an unplaceable
    // city returned status "complete" with one plan, no warning and no note, so
    // an agent would tell a shopper Shufersal is delivering their basket to an
    // address that does not exist.
    const result = await optimizeDelivery(
      { items: [{ query: "חלב 3%", packQty: 1 }], city: "זזזזזזז" },
      { continuationSecret: "test-secret" },
    );
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.address.lat).toBeNull();
    expect(result.notes.join(" ")).toMatch(/could not place/i);
    // Every storefront still standing got there on national coverage alone.
    for (const plan of result.plans) {
      expect(plan.coverage.matchedScope, plan.serviceSlug).toBe("national");
    }
  });
});
