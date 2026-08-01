import { fetchAllowedFeed } from "../common/allowedFetch.js";
import { jerusalemDateKeys } from "../publishprice/index.js";
import { DISCOVER_TIMEOUT_MS, LAIB_BASE_URL } from "./types.js";

/**
 * The portal is an ASP.NET WebForms page: the file list only exists in the
 * response to a postback, so discovery has to replay the search form rather
 * than read a static index. There is a documented REST-ish query string
 * (`NBCompetitionRegulations.aspx?code=&date=&fileType=`, see the portal's own
 * Content/instructions.txt) but it renders the "no files" branch for every
 * combination tried on 2026-08-01, so the form post is the working route.
 */
export interface AspNetTokens {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
}

const USER_AGENT = "super-mcp/0.1 (+local-dev)";

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function hiddenField(html: string, id: string): string {
  const byId = html.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`));
  if (byId) return decodeEntities(byId[1]!);
  const byName = html.match(new RegExp(`name="${id}"[^>]*value="([^"]*)"`));
  return byName ? decodeEntities(byName[1]!) : "";
}

export function parseAspNetTokens(html: string): AspNetTokens {
  const tokens = {
    viewState: hiddenField(html, "__VIEWSTATE"),
    viewStateGenerator: hiddenField(html, "__VIEWSTATEGENERATOR"),
    eventValidation: hiddenField(html, "__EVENTVALIDATION"),
  };
  if (!tokens.viewState || !tokens.eventValidation) {
    throw new Error("laibcatalog: landing page carried no __VIEWSTATE/__EVENTVALIDATION");
  }
  return tokens;
}

/**
 * Relative feed paths from a search result page.
 *
 * The portal writes Windows separators for the first two segments
 * (`CompetitionRegulationsFiles\latest\7290455000004/File.xml.gz`), so they are
 * normalised here rather than at every call site.
 */
export function parseFileLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href='([^']*CompetitionRegulationsFiles[^']*)'/g)) {
    out.push(decodeEntities(m[1]!).replace(/\\/g, "/").replace(/^\/+/, ""));
  }
  return out;
}

/**
 * Collapse the duplicate encodings the portal publishes for one filing.
 *
 * Every Stores file is listed twice, once as `.gz` and once as an uncompressed
 * `.XML`. Ingesting both means parsing the same store list twice per run; the
 * compressed copy is the same bytes for a tenth of the transfer.
 */
export function preferCompressed(paths: string[]): string[] {
  const best = new Map<string, string>();
  for (const path of paths) {
    const key = path.replace(/\.(xml|gz)+$/i, "").toLowerCase();
    const prev = best.get(key);
    if (!prev) {
      best.set(key, path);
      continue;
    }
    const prevGz = /\.gz$/i.test(prev);
    const nextGz = /\.gz$/i.test(path);
    if (!prevGz && nextGz) best.set(key, path);
  }
  return [...best.values()];
}

export function laibFileUrl(relativePath: string, baseUrl = LAIB_BASE_URL): string {
  const base = baseUrl.replace(/\/$/, "");
  const segments = relativePath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${base}/${segments}`;
}

/** `dd/MM/yyyy` search keys for Israel calendar days, newest first. */
export function laibSearchDates(lookbackDays: number, now: Date = new Date()): string[] {
  return jerusalemDateKeys(lookbackDays, now).map(
    (key) => `${key.slice(6, 8)}/${key.slice(4, 6)}/${key.slice(0, 4)}`,
  );
}

async function portalRequest(
  url: string,
  init: RequestInit,
  allowedHosts: readonly string[],
): Promise<string> {
  const res = await fetchAllowedFeed(url, allowedHosts, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`laibcatalog ${url} -> ${res.status}`);
  return res.text();
}

export async function fetchSearchTokens(
  allowedHosts: readonly string[],
  baseUrl = LAIB_BASE_URL,
): Promise<AspNetTokens> {
  return parseAspNetTokens(await portalRequest(baseUrl, { method: "GET" }, allowedHosts));
}

/**
 * One day's filings for one chain.
 *
 * `fileType=all` rather than the narrower `pricefull`, because the plain
 * `Stores` file that Victory and Machsanei Hashuk publish is not matched by the
 * `storesfull` option and is the only place their store list appears. Without
 * it `selectRegionalFeedFiles` matches no store codes and drops every price
 * file, so the chain would ingest as zero rows.
 *
 * The tokens are safe to reuse across calls: the portal accepts a __VIEWSTATE
 * from an earlier GET and sets no session cookie, so discovery pays for one
 * landing-page fetch rather than one per query.
 */
export async function searchDay(
  chainId: string,
  date: string,
  tokens: AspNetTokens,
  allowedHosts: readonly string[],
  baseUrl = LAIB_BASE_URL,
): Promise<string[]> {
  const form = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: tokens.viewState,
    __VIEWSTATEGENERATOR: tokens.viewStateGenerator,
    __EVENTVALIDATION: tokens.eventValidation,
    "ctl00$txtSearchProduct": "",
    "ctl00$MainContent$chain": chainId,
    "ctl00$MainContent$subChain": "-1",
    "ctl00$MainContent$branch": "-1",
    "ctl00$MainContent$fileType": "all",
    "ctl00$MainContent$txtDate": date,
    "ctl00$MainContent$btnSearch": "חיפוש",
  });
  const html = await portalRequest(
    baseUrl,
    {
      method: "POST",
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: baseUrl },
    },
    allowedHosts,
  );
  return preferCompressed(parseFileLinks(html));
}
