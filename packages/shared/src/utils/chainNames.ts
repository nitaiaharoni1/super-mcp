export interface ChainDisplayNames {
  he: string;
  en: string;
}

const CHAIN_NAMES: Record<string, ChainDisplayNames> = {
  "7290027600007": { he: "שופרסל", en: "Shufersal" },
  "7290058140886": { he: "רמי לוי", en: "Rami Levy" },
  "7290803800003": { he: "יוחננוף", en: "Yohananof" },
  "7290103152017": { he: "אושר עד", en: "Osher Ad" },
  "7290873255550": { he: "טיב טעם", en: "Tiv Taam" },
  "7290700100008": { he: "חצי חינם", en: "Hazi Hinam" },
  "7290696200003": { he: "ויקטורי", en: "Victory" },
  "7290661400001": { he: "מחסני השוק", en: "Machsanei Hashuk" },
  "7290455000004": { he: "ח. כהן", en: "H. Cohen" },
  "7290055700007": { he: "קרפור", en: "Carrefour" },
  "7290526500006": { he: "סלח דבאח", en: "Salach Dabach" },
  "7290876100000": { he: "פרשמרקט", en: "Fresh Market" },
  "7290639000004": { he: "סטופ מרקט", en: "Stop Market" },
  "7290785400000": { he: "קשת טעמים", en: "Keshet Taamim" },
  // Marketplaces are chains in their own right here, because they set their own
  // prices rather than passing a chain's through. See the Wolt adapter.
  // One chain per Wolt BRAND, not one "Wolt". A Wolt venue sets Wolt's price, not
  // the chain's (about +25% on the venue that also files a feed), so
  // "Victory on Wolt" is a different price book from "Victory" and a shopper has
  // to see them as two named options. "IL-WOLT" is the retired single-chain id.
  "IL-WOLT": { he: "וולט", en: "Wolt" },
  "IL-WOLT-MARKET": { he: "וולט מרקט", en: "Wolt Market" },
  "IL-WOLT-VICTORY": { he: "ויקטורי-וולט", en: "Victory (Wolt)" },
  "IL-WOLT-MACHSANEI": { he: "מחסני השוק-וולט", en: "Machsanei Hashuk (Wolt)" },
  "IL-SUPER-YUDA": { he: "סופר יודה", en: "Super Yuda" },
  "IL-POLITZER": { he: "פוליצר", en: "Politzer" },
};

export function lookupChainNames(chainId: string): ChainDisplayNames {
  return CHAIN_NAMES[chainId] ?? { he: chainId, en: chainId };
}
