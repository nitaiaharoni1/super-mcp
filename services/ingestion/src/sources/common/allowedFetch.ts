/**
 * SSRF guard for HTTP feed downloads: only absolute http(s) URLs whose host
 * matches an allowlist (exact or subdomain) may be fetched.
 */
export function assertAllowedFeedUrl(urlString: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`Invalid feed URL: ${urlString}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing non-http(s) feed URL: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  const ok = allowedHosts.some((allowed) => {
    const a = allowed.toLowerCase();
    return host === a || host.endsWith(`.${a}`);
  });
  if (!ok) {
    throw new Error(`Refusing fetch to disallowed host: ${host}`);
  }
  return url;
}

export async function fetchAllowedFeed(
  urlString: string,
  allowedHosts: readonly string[],
  init?: RequestInit,
): Promise<Response> {
  const url = assertAllowedFeedUrl(urlString, allowedHosts);
  return fetch(url, init);
}
