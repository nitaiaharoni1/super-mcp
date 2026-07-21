import { fetchAllowedFeed } from "../common/allowedFetch.js";
import { BROWSER_UA, DISCOVER_TIMEOUT_MS, SHUFERSAL_ALLOWED_HOSTS } from "./constants.js";

export async function fetchText(url: string, timeoutMs: number = DISCOVER_TIMEOUT_MS): Promise<string> {
  const res = await fetchAllowedFeed(url, SHUFERSAL_ALLOWED_HOSTS, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status}`);
  }
  return res.text();
}
