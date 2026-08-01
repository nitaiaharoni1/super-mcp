import { normalizeStoreCoordinates, type RawStoreRecord } from "@super-mcp/shared";
import { asArray, num, text } from "./helpers.js";
import { feedParser } from "./parser.js";

export function parseStoresXml(xml: string, chainId: string): RawStoreRecord[] {
  const doc = feedParser.parse(xml);
  // Shufersal uses <Chain>; Cerberus/Carrefour use <Root> / <Stores>.
  const root = (doc.Root ?? doc.Stores ?? doc.Chain ?? doc) as Record<string, unknown>;
  const subChains = asArray(
    (root.SubChains as Record<string, unknown> | undefined)?.SubChain ?? root.SubChain,
  );
  const stores: RawStoreRecord[] = [];

  const pushStore = (s: Record<string, unknown>) => {
    const storeId = text(s.StoreId ?? s.StoreID);
    if (!storeId) return;
    const lat = num(s.Latitude ?? s.Lat ?? s.StoreLatitude);
    const lng = num(s.Longitude ?? s.Lng ?? s.Lon ?? s.StoreLongitude);
    const geo = normalizeStoreCoordinates(lat, lng);
    // The chain's own declaration of physical (1) / online (2) / both (3).
    // Every chain we ingest populates it; it just was not being read.
    const storeType = num(s.StoreType ?? s.StoreTypeId ?? s.STORETYPE);
    stores.push({
      kind: "store",
      chainId: text(s.ChainId ?? s.ChainID ?? root.ChainId ?? root.ChainID) || chainId,
      storeId,
      name: text(s.StoreName ?? s.Name) || `Store ${storeId}`,
      address: text(s.Address) || undefined,
      city: text(s.City) || undefined,
      zip: text(s.ZipCode ?? s.ZIPCode) || undefined,
      geo: geo ?? undefined,
      storeType: storeType ?? undefined,
      raw: s,
    });
  };

  if (subChains.length) {
    for (const sc of subChains) {
      const scObj = sc as Record<string, unknown>;
      const storesNode = scObj.Stores as Record<string, unknown> | undefined;
      for (const s of asArray(storesNode?.Store ?? scObj.Store)) {
        pushStore(s as Record<string, unknown>);
      }
    }
  } else {
    const storesNode = root.Stores as Record<string, unknown> | undefined;
    // H. Cohen files <Store><Branches><Branch>… : the document root is a single
    // <Store> element that carries no store of its own, so the usual root.Store
    // lookup finds one entry with no StoreID and yields nothing. Branches win
    // only when present, to leave every other shape alone.
    const branches = [
      ...asArray(root.Store).flatMap((s) =>
        asArray(
          ((s as Record<string, unknown>).Branches as Record<string, unknown> | undefined)?.Branch,
        ),
      ),
      ...asArray((root.Branches as Record<string, unknown> | undefined)?.Branch),
    ];
    const entries = branches.length ? branches : asArray(root.Store ?? storesNode?.Store);
    for (const s of entries) {
      pushStore(s as Record<string, unknown>);
    }
  }
  return stores;
}
