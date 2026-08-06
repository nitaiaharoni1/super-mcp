/**
 * Metadata-only extractors for analytics. Never include free-text queries,
 * product names, GTINs, cities, or coordinates as string values.
 */

import {
  deriveGeocodeTelemetryStrategy,
  type GeocodeTelemetryStrategy,
} from "../lib/locationInput.js";

export type RequestAnalyticsMeta = {
  item_count?: number;
  has_city?: boolean;
  has_near?: boolean;
  has_location?: boolean;
  resolution_mode?: "fast" | "strict";
  response_detail?: "summary" | "standard" | "debug";
};

export type ResultAnalyticsMeta = {
  basket_status?: "complete" | "needs_confirmation" | "error";
  geocode_ms?: number;
  geocode_strategy?: GeocodeTelemetryStrategy;
  resolution_mode?: "fast" | "strict";
  response_detail?: "summary" | "standard" | "debug";
  response_bytes?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asResolutionMode(value: unknown): "fast" | "strict" | undefined {
  if (value === "fast" || value === "strict") return value;
  return undefined;
}

function asResponseDetail(value: unknown): "summary" | "standard" | "debug" | undefined {
  if (value === "summary" || value === "standard" || value === "debug") return value;
  return undefined;
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

  const resolutionMode = asResolutionMode(input.resolution_mode ?? input.resolutionMode);
  if (resolutionMode) meta.resolution_mode = resolutionMode;

  const responseDetail = asResponseDetail(input.response_detail ?? input.responseDetail);
  if (responseDetail) meta.response_detail = responseDetail;

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
  if (a.resolution_mode != null || b.resolution_mode != null) {
    out.resolution_mode = b.resolution_mode ?? a.resolution_mode;
  }
  if (a.response_detail != null || b.response_detail != null) {
    out.response_detail = b.response_detail ?? a.response_detail;
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

function originFromResult(result: Record<string, unknown>): {
  provider: "nominatim" | "city_centroid" | "coordinates";
  cached: boolean;
  fallbackApplied: boolean;
} | undefined {
  const location = result.location;
  if (!isRecord(location)) return undefined;
  const origin = location.origin;
  if (!isRecord(origin)) return undefined;
  const provider = origin.provider;
  if (provider !== "nominatim" && provider !== "city_centroid" && provider !== "coordinates") {
    return undefined;
  }
  return {
    provider,
    cached: Boolean(origin.cached),
    fallbackApplied: Boolean(origin.fallbackApplied),
  };
}

export function extractResultMeta(result: unknown): ResultAnalyticsMeta {
  if (!isRecord(result)) return {};
  const meta: ResultAnalyticsMeta = {};

  const status = result.status;
  if (status === "complete" || status === "needs_confirmation" || status === "error") {
    meta.basket_status = status;
  }

  const geocodeMs = result.geocodeMs ?? result.geocode_ms;
  if (typeof geocodeMs === "number" && Number.isFinite(geocodeMs)) {
    meta.geocode_ms = geocodeMs;
  }

  const strategyRaw = result.geocodeStrategy ?? result.geocode_strategy;
  if (
    strategyRaw === "cache" ||
    strategyRaw === "city_fallback" ||
    strategyRaw === "nominatim" ||
    strategyRaw === "coordinates" ||
    strategyRaw === "none"
  ) {
    meta.geocode_strategy = strategyRaw;
  } else {
    const origin = originFromResult(result);
    if (origin) {
      meta.geocode_strategy = deriveGeocodeTelemetryStrategy(origin);
    }
  }

  const resolutionMode = asResolutionMode(result.resolutionMode ?? result.resolution_mode);
  if (resolutionMode) meta.resolution_mode = resolutionMode;

  const responseDetail = asResponseDetail(result.responseDetail ?? result.response_detail);
  if (responseDetail) meta.response_detail = responseDetail;

  const responseBytes = result.responseBytes ?? result.response_bytes;
  if (typeof responseBytes === "number" && Number.isFinite(responseBytes)) {
    meta.response_bytes = responseBytes;
  }

  return meta;
}

/**
 * Which assistant is calling, as a low-cardinality bucket whose values are the same ids the
 * install cards report in `mcp_install_clicked.target`. That is what lets "Cursor installs" and
 * "calls from Cursor" line up as cohorts without putting any per-person id in the published URL.
 *
 * A guess from strings the client controls, so it is a cohort label and never an access decision.
 * Order matters: Claude Code must be tested before the bare Claude match. VS Code clients use
 * names such as `vscode` or `Visual Studio Code`, both handled below.
 */
export type AnalyticsClientName =
  | "cursor"
  | "vscode"
  | "claude-code"
  | "claude"
  | "chatgpt"
  | "gemini-cli"
  | "lmstudio"
  | "other"
  | "unknown";

const CLIENT_PATTERNS: ReadonlyArray<[RegExp, AnalyticsClientName]> = [
  [/cursor/, "cursor"],
  [/claude[\s_-]?code/, "claude-code"],
  [/(vs[\s_-]?code|visual\s?studio\s?code|github[\s_-]?copilot)/, "vscode"],
  [/(claude|anthropic)/, "claude"],
  [/(chatgpt|openai)/, "chatgpt"],
  [/gemini/, "gemini-cli"],
  [/lm[\s_-]?studio/, "lmstudio"],
];

function matchClient(value: string | undefined): AnalyticsClientName | undefined {
  const haystack = value?.trim().toLowerCase();
  if (!haystack) return undefined;
  for (const [pattern, name] of CLIENT_PATTERNS) {
    if (pattern.test(haystack)) return name;
  }
  return undefined;
}

export function deriveClientName(
  userAgent: string | undefined,
  mcpClientName?: string,
): AnalyticsClientName {
  // The handshake name is the client naming itself, so it is tried alone and first. Merging both
  // into one haystack would let the HTTP stack's user-agent outvote it whenever the agent happens
  // to match an earlier pattern, which is how a Gemini CLI run behind a Cursor-branded agent
  // would have been filed as Cursor.
  const named = matchClient(mcpClientName) ?? matchClient(userAgent);
  if (named) return named;
  // Something identified itself, we just do not recognise it. That is not the same as silence.
  return mcpClientName?.trim() || userAgent?.trim() ? "other" : "unknown";
}

export function shouldTrackRestPath(path: string): boolean {
  const clean = path.split("?")[0] ?? path;
  if (!clean.startsWith("/v1/")) return false;
  if (clean.startsWith("/v1/admin")) return false;
  return true;
}
