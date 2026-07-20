import { describe, expect, it, vi } from "vitest";
import { resolveLocationInput } from "../../../src/lib/locationInput.js";
import {
  applyBasketAnswers,
  createBasketContinuationPayload,
  decodeBasketContinuation,
  encodeBasketContinuation,
} from "../../../src/services/basket/continuation.js";
import { optimizeBasketBodySchema } from "../../../src/routes/basket/schemas.js";

const SECRET = "test-only-basket-continuation-secret-ok";
const UUID = "11111111-1111-4111-8111-111111111111";

describe("location field + continuation freeze", () => {
  it("accepts location on the initial basket schema and rejects near+location", () => {
    const ok = optimizeBasketBodySchema.safeParse({
      items: [{ query: "מלח", pack_qty: 1 }],
      location: "נווה עמל, הרצליה",
    });
    expect(ok.success).toBe(true);

    const conflict = optimizeBasketBodySchema.safeParse({
      items: [{ query: "מלח", pack_qty: 1 }],
      near: "32.16,34.84",
      location: "נווה עמל",
    });
    expect(conflict.success).toBe(false);
  });

  it("freezes resolved near + origin into continuation so resume never re-geocodes", async () => {
    const resolveGeocode = vi.fn().mockResolvedValue({
      status: "ok",
      point: { lat: 32.171, lng: 34.841 },
      precision: "neighborhood",
      provider: "nominatim",
      cached: false,
      fallbackApplied: false,
      displayName: "Neve Amal, Herzliya",
      attribution: "© OpenStreetMap contributors",
      warning: null,
    });

    const loc = await resolveLocationInput(
      { location: "נווה עמל", city: "הרצליה" },
      { resolveGeocode },
    );
    expect(resolveGeocode).toHaveBeenCalledTimes(1);

    const payload = createBasketContinuationPayload(
      {
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
        locationOrigin: loc.locationOrigin,
        items: [{ query: "מלח", packQty: 1 }],
      },
      [
        {
          itemIndex: 0,
          selectionEffect: "pin",
          allowedProductIds: [UUID],
        },
      ],
    );
    const continuation = encodeBasketContinuation(payload, SECRET);
    const decoded = decodeBasketContinuation(continuation, SECRET);
    expect(decoded.input.near).toEqual({ lat: 32.171, lng: 34.841 });
    expect(decoded.input.locationOrigin?.precision).toBe("neighborhood");
    // Raw location text must never appear in the signed payload.
    expect(JSON.stringify(decoded)).not.toContain("נווה עמל");

    const resumed = applyBasketAnswers(decoded, [{ itemIndex: 0, productId: UUID }]);
    expect(resumed.near).toEqual(loc.near);
    expect(resumed.locationOrigin).toEqual(loc.locationOrigin);
    expect(resolveGeocode).toHaveBeenCalledTimes(1);
  });
});
