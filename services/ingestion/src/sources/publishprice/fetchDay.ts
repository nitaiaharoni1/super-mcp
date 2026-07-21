import { fetchAllowedFeed } from "../common/allowedFetch.js";
import { parsePublishPriceHtml } from "./parseHtml.js";
import { DISCOVER_TIMEOUT_MS, type ParsedPublishPricePage, type PublishPricePortal } from "./types.js";

function portalAllowedHosts(portal: PublishPricePortal): string[] {
  return [new URL(portal.baseUrl).hostname];
}

export async function fetchPublishPriceDay(
  portal: PublishPricePortal,
  dateKey: string,
): Promise<ParsedPublishPricePage | null> {
  const url = `${portal.baseUrl.replace(/\/$/, "")}/?date=${encodeURIComponent(dateKey)}`;
  try {
    const res = await fetchAllowedFeed(url, portalAllowedHosts(portal), {
      headers: { "User-Agent": "super-mcp/0.1 (+local-dev)" },
      redirect: "follow",
      signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        JSON.stringify({
          event: "publishprice_day_fetch_failed",
          sourceId: portal.sourceId,
          dateKey,
          status: res.status,
        }),
      );
      return null;
    }
    const html = await res.text();
    return parsePublishPriceHtml(html);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        event: "publishprice_day_fetch_failed",
        sourceId: portal.sourceId,
        dateKey,
        error: msg,
      }),
    );
    return null;
  }
}
