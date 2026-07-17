export interface PublishPricePortal {
  /** Adapter source id, e.g. il-carrefour */
  sourceId: string;
  /** Portal home page that embeds `const path` + `const files` */
  baseUrl: string;
  chainId: string;
  name: string;
}

/**
 * HTTP portals that embed a day's file list in the HTML (PublishPrice-style).
 * Built from the public portal contract — not from third-party scraper code.
 */
export const PUBLISHPRICE_PORTALS: PublishPricePortal[] = [
  {
    sourceId: "il-carrefour",
    baseUrl: "https://prices.carrefour.co.il",
    chainId: "7290055700007",
    name: "Carrefour",
  },
];

export interface ParsedPublishPricePage {
  path: string;
  files: Array<{ name: string; size?: number }>;
  /** Optional branch id → Hebrew label from portal HTML (city often in the label). */
  branches?: Record<string, string>;
}

export interface DayFileEntry {
  dayPath: string;
  name: string;
  size?: number;
}

export const DISCOVER_TIMEOUT_MS = 45_000;
export const FETCH_TIMEOUT_MS = 120_000;
/** How many Israel calendar days to merge (today + N-1 prior). */
export const DISCOVER_DAY_LOOKBACK = 3;
