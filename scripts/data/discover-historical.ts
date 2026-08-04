import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface SearchDocument {
  data?: { titleO?: string; url?: string; docDate?: string };
}

interface SearchResponse {
  ok: boolean;
  resultDocs?: SearchDocument[];
}

interface DiscoveredPage {
  title: string;
  href: string;
  discovered_via?: string;
  official_doc_date?: string | null;
}

const OFFICIAL_RELEASE_PATHS = ["/sj/zxfb/", "/xxgk/sjfb/zxfb2020/"];

function normalizeOfficialReleaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname !== "www.stats.gov.cn" || !url.pathname.endsWith(".html")) return null;
    if (!OFFICIAL_RELEASE_PATHS.some((prefix) => url.pathname.startsWith(prefix))) return null;
    url.protocol = "https:";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function searchOfficialSite(query: string): Promise<SearchResponse> {
  const body = new URLSearchParams({ qt: query, siteCode: "bm36000002", tab: "", page: "1", pageSize: "20", sort: "relevance", keyplace: "0" });
  const response = await fetch("https://api.so-gov.cn/query/s", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "HousingPriceIndexBot/0.1 (+local development)" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`官方搜索接口返回 HTTP ${response.status}`);
  return await response.json() as SearchResponse;
}

const discoveryPath = resolve("data", "discovered-official-pages.json");
const targetStart = process.env.HISTORICAL_COVERAGE_START ?? "2011-07";
const discovery = JSON.parse(await readFile(discoveryPath, "utf8")) as {
  pages: DiscoveredPage[];
  historical_search_missing?: string[];
  [key: string]: unknown;
};
const existingMonths = new Set(discovery.pages.map((page) => page.title.match(/(20\d{2})年(\d{1,2})月份/)?.slice(1, 3)).filter(Boolean).map((parts) => `${parts![0]}-${parts![1].padStart(2, "0")}`));

function previousMonth(value: string): string {
  const date = new Date(`${value}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function monthRange(start: string, end: string): string[] {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(start) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(end) || start > end) {
    throw new Error(`Invalid historical coverage range: ${start} -> ${end}`);
  }
  const months: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    months.push(cursor);
    const next = new Date(`${cursor}-01T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    cursor = next.toISOString().slice(0, 7);
  }
  return months;
}

const firstExistingMonth = [...existingMonths].sort().at(0);
if (!firstExistingMonth) throw new Error("Official discovery contains no statistical months");
const targetEnd = process.env.HISTORICAL_COVERAGE_END ?? previousMonth(firstExistingMonth);
const missing = [...new Set([...(discovery.historical_search_missing ?? []), ...monthRange(targetStart, targetEnd)])]
  .filter((value) => !existingMonths.has(value))
  .sort();
const found: DiscoveredPage[] = [];
const unresolved: string[] = [];

for (const [index, value] of missing.entries()) {
  if (existingMonths.has(value)) continue;
  const [year, monthText] = value.split("-");
  const month = Number(monthText);
  const prefix = `${year}年${month}月份70个大中城市`;
  const queries = [
    `${prefix}商品住宅销售价格变动情况`,
    `${prefix}住宅销售价格变动情况`,
    prefix,
  ];
  let match: SearchDocument["data"] | undefined;
  let href: string | null = null;
  for (const query of queries) {
    const payload = await searchOfficialSite(query);
    match = payload.resultDocs?.map((item) => item.data).find((item) => {
      const candidateUrl = normalizeOfficialReleaseUrl(item?.url);
      if (!candidateUrl || !item?.titleO) return false;
      return item.titleO.includes(prefix) && item.titleO.includes("住宅销售价格") && item.titleO.includes("变动情况");
    });
    href = normalizeOfficialReleaseUrl(match?.url);
    if (payload.ok && match?.titleO && href) break;
  }
  if (match?.titleO && href) {
    found.push({ title: match.titleO, href, discovered_via: "official-site-search-api", official_doc_date: match.docDate ?? null });
    console.log(`[${index + 1}/${missing.length}] ${value} -> ${href}`);
  } else {
    unresolved.push(value);
    console.warn(`[${index + 1}/${missing.length}] ${value} unresolved`);
  }
  if (index + 1 < missing.length) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
}

const merged = [...new Map([...discovery.pages, ...found].map((item) => [`${item.title}|${item.href}`, item])).values()].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
await writeFile(discoveryPath, JSON.stringify({ ...discovery, historical_official_search_checked_at: new Date().toISOString(), historical_search_missing: unresolved, pages: merged }, null, 2) + "\n", "utf8");
console.log(`Official search discovered ${found.length}; unresolved ${unresolved.length}; total ${merged.length}`);
