import { BROWSER_UA, DISCOVER_TIMEOUT_MS } from "./constants.js";

export async function fetchText(url: string, timeoutMs: number = DISCOVER_TIMEOUT_MS): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status}`);
  }
  return res.text();
}
