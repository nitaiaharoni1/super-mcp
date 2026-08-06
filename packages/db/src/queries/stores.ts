import { query } from "./query.js";

export interface KnownStoreLocation {
  storeId: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  name: string | null;
  address: string | null;
  /** The chain's own `<StoreType>` as last filed. */
  storeType: number | null;
  /** What the last classification made of it: branch / online / pickup / warehouse. */
  storeKind: string | null;
}

/**
 * Store locations already known for a chain, as discovery-filter hints.
 *
 * Some chains publish price files but no Stores file at all: Fresh Market
 * publishes 51 PriceFull and 51 PromoFull files and zero Stores files. The
 * region filter derives its allow-list from the feed's Stores file, so with none
 * available it matched no stores and dropped every price file, silently and
 * permanently. The chain had 45 branches in the database the whole time,
 * including Tel Aviv, Herzliya, Petah Tikva and Haifa.
 *
 * Losing a Stores file should not blind us to shops we already know about.
 *
 * Carries the store kind as well as the location because the online filter runs
 * on the same hints: without it, a chain whose Stores file broke would fall back
 * to guessing from the name, and a delivery depot whose name reads like a
 * warehouse ("מרלוג אינטרנט") would stop being priced the moment its feed
 * hiccuped.
 *
 * Bounded by `updated_at`, because this is a memory of a working feed and not a
 * permanent record. Every store in today's Stores file is upserted on every run,
 * so a store that is still open keeps its timestamp fresh. One that closed stops
 * being written and ages out. Without the bound a closed store is hinted, and
 * logged as restored, on every run forever, which buries the one night the
 * backstop actually mattered.
 */
/** How long a vanished store stays trusted as a hint. Long enough to outlast any
 *  realistic feed regression, short enough that a real closure drops out. */
const KNOWN_STORE_MEMORY_DAYS = 30;

export async function knownStoreLocationsForChain(
  chainId: string,
): Promise<KnownStoreLocation[]> {
  const res = await query<{
    store_code: string;
    city: string | null;
    lat: number | null;
    lng: number | null;
    name: string | null;
    address: string | null;
    feed_store_type: number | null;
    store_kind: string | null;
  }>(
    `SELECT store_code, city, lat, lng, name, address, feed_store_type, store_kind
       FROM store
      WHERE chain_id = $1
        AND updated_at > now() - make_interval(days => $2::int)`,
    [chainId, KNOWN_STORE_MEMORY_DAYS],
  );
  return res.rows.map((r) => ({
    storeId: r.store_code,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    name: r.name,
    address: r.address,
    storeType: r.feed_store_type,
    storeKind: r.store_kind,
  }));
}
