/**
 * Metadata-only extractors for analytics. Never include free-text queries,
 * product names, GTINs, cities, or coordinates as string values.
 */

export type RequestAnalyticsMeta = {
  item_count?: number;
  has_city?: boolean;
  has_near?: boolean;
  has_location?: boolean;
};

export type ResultAnalyticsMeta = {
  basket_status?: "complete" | "needs_confirmation" | "error";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function extractRequestMeta(input: unknown): RequestAnalyticsMeta {
  if (!isRecord(input)) return {};

  const meta: RequestAnalyticsMeta = {};
  if (Array.isArray(input.items)) {
    meta.item_count = input.items.length;
  }

  if ("city" in input) meta.has_city = input.city != null && String(input.city).length > 0;
  if ("near" in input) meta.has_near = input.near != null && String(input.near).length > 0;
  if ("location" in input) {
    meta.has_location = input.location != null && String(input.location).length > 0;
  }

  return meta;
}

function mergeRequestMeta(a: RequestAnalyticsMeta, b: RequestAnalyticsMeta): RequestAnalyticsMeta {
  const out: RequestAnalyticsMeta = {};
  if (a.item_count != null || b.item_count != null) {
    out.item_count = a.item_count ?? b.item_count;
  }
  if (a.has_city != null || b.has_city != null) {
    out.has_city = Boolean(a.has_city || b.has_city);
  }
  if (a.has_near != null || b.has_near != null) {
    out.has_near = Boolean(a.has_near || b.has_near);
  }
  if (a.has_location != null || b.has_location != null) {
    out.has_location = Boolean(a.has_location || b.has_location);
  }
  return out;
}

/** REST may carry location on body (POST) and/or query (GET). */
export function extractRestRequestMeta(body: unknown, query: unknown): RequestAnalyticsMeta {
  return mergeRequestMeta(extractRequestMeta(body), extractRequestMeta(query));
}

/** @deprecated prefer extractRestRequestMeta — kept for tests/clarity */
export function extractRestBodyMeta(body: unknown): RequestAnalyticsMeta {
  return extractRequestMeta(body);
}

export function extractResultMeta(result: unknown): ResultAnalyticsMeta {
  if (!isRecord(result)) return {};
  const status = result.status;
  if (status === "complete" || status === "needs_confirmation" || status === "error") {
    return { basket_status: status };
  }
  return {};
}

export function shouldTrackRestPath(path: string): boolean {
  const clean = path.split("?")[0] ?? path;
  if (!clean.startsWith("/v1/")) return false;
  if (clean.startsWith("/v1/admin")) return false;
  return true;
}
