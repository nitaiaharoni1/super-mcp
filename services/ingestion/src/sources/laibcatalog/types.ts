/**
 * laibcatalog.co.il — the Nibit-built transparency portal.
 *
 * It is the only public filing point for Victory and Machsanei Hashuk, the two
 * chains this repo had previously been reading off their stor.ai storefronts.
 * That scrape carries no barcodes (`ItemType` 0 throughout), so those chains
 * could not join the cross-chain GTIN index at all; the filings here are ~90%
 * `ItemType` 1, which is the whole reason for preferring the feed.
 */
export interface LaibChainConfig {
  chainId: string;
  /** Hebrew label as the portal's own dropdown spells it. */
  name: string;
}

/** Chains the portal's `MainContent_chain` dropdown offers, read 2026-08-01. */
export const LAIB_CHAINS: LaibChainConfig[] = [
  { chainId: "7290696200003", name: "ויקטורי" },
  { chainId: "7290455000004", name: "ח. כהן" },
  { chainId: "7290661400001", name: "מחסני השוק" },
];

export const LAIB_SOURCE_ID = "il-laibcatalog";
export const LAIB_BASE_URL = "https://laibcatalog.co.il/";

/**
 * How many Israel calendar days back to look for a chain's newest filing.
 *
 * Deliberately far longer than the 3 days the PublishPrice portals use. This
 * portal goes quiet for stretches: Victory and Machsanei Hashuk last filed
 * prices on 2026-07-24 and had published nothing for the eight days to
 * 2026-08-01, while H. Cohen kept posting a Stores file every morning. A
 * 3-day window would have discovered nothing and reported the source `empty`,
 * which reads as "portal is gone" rather than "portal is behind".
 *
 * The walk stops at the first day that yields prices, so a healthy portal
 * costs one request per chain and only a stalled one pays for the rest.
 */
export const DISCOVER_DAY_LOOKBACK = 14;

/**
 * Age past which a chain's newest filing is reported as a stall rather than
 * accepted quietly. Filings are daily when the portal is healthy.
 */
export const STALE_FILING_WARN_DAYS = 2;

export const DISCOVER_TIMEOUT_MS = 60_000;
export const FETCH_TIMEOUT_MS = 120_000;
