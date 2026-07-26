import { query } from "./query.js";
/**
 * Store locations already known for a chain, as region-filter hints.
 *
 * Some chains publish price files but no Stores file at all: Fresh Market
 * publishes 51 PriceFull and 51 PromoFull files and zero Stores files. The
 * region filter derives its allow-list from the feed's Stores file, so with none
 * available it matched no stores and dropped every price file, silently and
 * permanently. The chain had 45 branches in the database the whole time,
 * including Tel Aviv, Herzliya, Petah Tikva and Haifa.
 *
 * Losing a Stores file should not blind us to shops we already know about.
 */
export async function knownStoreLocationsForChain(
  chainId: string,
): Promise<Array<{ storeId: string; city: string | null; lat: number | null; lng: number | null }>> {
  const res = await query<{
    store_code: string;
    city: string | null;
    lat: number | null;
    lng: number | null;
  }>(
    `SELECT store_code, city, lat, lng FROM store WHERE chain_id = $1`,
    [chainId],
  );
  return res.rows.map((r) => ({
    storeId: r.store_code,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
  }));
}
