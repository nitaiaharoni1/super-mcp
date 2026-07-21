/**
 * Basket lines that exist in `pnpm db:seed` + `pnpm ingest:fixture`.
 * Use these for CI live flows; use canary Tel Aviv / BBQ fixtures only on full dumps.
 */
export const FIXTURE_CITY = "תל אביב";
export const FIXTURE_LOCATION = "דיזנגוף, תל אביב";

export const FIXTURE_STAPLES_MCP_ITEMS = [
  { query: "חלב", pack_qty: 2 },
  { query: "לחם", pack_qty: 1 },
  { query: "קוטג'", pack_qty: 1 },
  { query: "ביצים", pack_qty: 1 },
  { query: "אורז", pack_qty: 1 },
  { query: "עגבניות", amount: 1, unit: "kg" },
] as const;

export const FIXTURE_FORBIDDEN_NAMES = [
  "עגבניות מרוסקות",
  "קמח תפוחי אדמה",
  "חלב בטעם אגוזי לוז",
] as const;
