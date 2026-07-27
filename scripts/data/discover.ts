import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as cheerio from "cheerio";

const LIST_URL = "https://www.stats.gov.cn/sj/zxfb/index.html";
export type OfficialPageDiscovery = {
  checked_at: string;
  list_url: string;
  pages_checked: number;
  pages: Array<{ title: string; href: string }>;
};

async function fetchListPage(pageIndex: number): Promise<string> {
  const url = pageIndex === 0 ? LIST_URL : new URL(`index_${pageIndex}.html`, LIST_URL).href;
  const response = await fetch(url, { headers: { "User-Agent": "HousingPriceIndexBot/0.1 (+local development)" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`官方发布列表 ${url} 返回 HTTP ${response.status}`);
  return response.text();
}

export async function discoverOfficialPages(requestedLimit = 0): Promise<OfficialPageDiscovery> {
  const firstHtml = await fetchListPage(0);
  const declaredPageCount = Number(firstHtml.match(/createPageHTML\((\d+),/)?.[1] ?? "1");
  const pageCount = requestedLimit > 0 ? Math.min(requestedLimit, declaredPageCount) : declaredPageCount;
  const discovered: Array<{ title: string; href: string }> = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const html = pageIndex === 0 ? firstHtml : await fetchListPage(pageIndex);
    const $ = cheerio.load(html);
    discovered.push(...$("a[href]").toArray().map((node) => ({ title: $(node).attr("title")?.trim() || $(node).text().replace(/\s+/g, " ").trim(), href: new URL($(node).attr("href")!, LIST_URL).href })).filter((item) => /70个大中城市.*住宅销售价格.*变动情况/.test(item.title)));
    if (pageIndex + 1 < pageCount) await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }
  const pages = [...new Map(discovered.map((item) => [`${item.title}|${item.href}`, item])).values()].sort((a, b) => a.href.localeCompare(b.href));
  return { checked_at: new Date().toISOString(), list_url: LIST_URL, pages_checked: pageCount, pages };
}

async function main() {
  const requestedOutput = process.argv.find((arg) => arg.startsWith("--output="))?.split("=").slice(1).join("=");
  const output = resolve(requestedOutput || resolve("data", "discovered-official-pages.json"));
  const requestedLimit = Number(process.argv.find((arg) => arg.startsWith("--max-pages="))?.split("=")[1] ?? "0");
  const result = await discoverOfficialPages(requestedLimit);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Discovered ${result.pages.length} official housing-price pages from ${result.pages_checked} list pages -> ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
