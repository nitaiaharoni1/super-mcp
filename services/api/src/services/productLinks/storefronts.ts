import type { Storefront } from "./types.js";

const enc = encodeURIComponent;

/**
 * chain.id → storefront URL builders.
 *   - a Storefront object: has an online store.
 *   - null: chain has no online store (return no_online_store).
 *   - absent: not mapped yet (return unmapped_chain).
 */
export const STOREFRONTS: Record<string, Storefront | null> = {
  // Rami Levy — Nuxt SPA; product modal keyed by barcode via ?item=.
  "7290058140886": {
    barcodeUrl: (g) => `https://www.rami-levy.co.il/he/online/search?item=${g}`,
    nameUrl: (n) => `https://www.rami-levy.co.il/he/online/search?q=${enc(n)}`,
  },
  // Yohananof — stor.ai Next.js; barcode search resolves to a single product.
  "7290803800003": {
    barcodeUrl: (g) => `https://yochananof.co.il/category?search=${g}`,
    nameUrl: (n) => `https://yochananof.co.il/category?search=${enc(n)}`,
  },
  // Shufersal — SAP Hybris; search indexes SKU/מק"ט, not barcode, so name search only.
  "7290027600007": {
    nameUrl: (n) => `https://www.shufersal.co.il/online/he/search?text=${enc(n)}`,
  },
  // stor.ai storefronts all share the same barcode-search deep link: /search/<barcode>.
  // Carrefour.
  "7290055700007": {
    barcodeUrl: (g) => `https://www.carrefour.co.il/search/${g}`,
    nameUrl: (n) => `https://www.carrefour.co.il/search/${enc(n)}`,
  },
  // Tiv Taam.
  "7290873255550": {
    barcodeUrl: (g) => `https://www.tivtaam.co.il/search/${g}`,
    nameUrl: (n) => `https://www.tivtaam.co.il/search/${enc(n)}`,
  },
  // Salach Dabach — trades online as "דבאח ביג מרקט" at bigdabach.co.il.
  "7290526500006": {
    barcodeUrl: (g) => `https://www.bigdabach.co.il/search/${g}`,
    nameUrl: (n) => `https://www.bigdabach.co.il/search/${enc(n)}`,
  },
  // Keshet Taamim.
  "7290785400000": {
    barcodeUrl: (g) => `https://www.keshet-teamim.co.il/search/${g}`,
    nameUrl: (n) => `https://www.keshet-teamim.co.il/search/${enc(n)}`,
  },
  // Osher Ad — no online store.
  "7290103152017": null,
  // Stop Market — stopmarket.co.il is a marketing site only, no online store.
  // (nonstopmarket.co.il is a different, unrelated chain — do not conflate.)
  "7290639000004": null,
};
