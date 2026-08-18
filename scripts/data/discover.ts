import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as cheerio from "cheerio";

const LIST_URL = "https://www.stats.gov.cn/sj/zxfb/index.html";
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;
export type OfficialPageDiscovery = {
  checked_at: string;
  list_url: string;
  pages_checked: number;
  pages: Array<{ title: string; href: string }>;
};

export type OfficialDiscoveryOptions = {
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
};

class OfficialListResponseError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function isTransientNetworkFailure(error: unknown, seen = new Set<object>()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  const candidate = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof candidate.code === "string" && ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"].includes(candidate.code)) return true;
  if (Array.isArray(candidate.errors) && candidate.errors.some((nestedError) => isTransientNetworkFailure(nestedError, seen))) return true;
  return isTransientNetworkFailure(candidate.cause, seen);
}

function shouldRetry(error: unknown): boolean {
  return error instanceof OfficialListResponseError ? error.retryable : isTransientNetworkFailure(error);
}

async function fetchListPage(pageIndex: number, fetchImpl: typeof fetch, retryDelayMs: number): Promise<string> {
  const url = pageIndex === 0 ? LIST_URL : new URL(`index_${pageIndex}.html`, LIST_URL).href;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { "User-Agent": "HousingPriceIndexBot/0.1 (+local development)" }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        throw new OfficialListResponseError(
          `官方发布列表 ${url} 返回 HTTP ${response.status}`,
          response.status === 408 || response.status === 429 || response.status >= 500,
        );
      }
      return response.text();
    } catch (error) {
      if (attempt === MAX_FETCH_ATTEMPTS || !shouldRetry(error)) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs * attempt));
    }
  }
  throw new Error(`官方发布列表 ${url} 在 ${MAX_FETCH_ATTEMPTS} 次尝试后仍不可用`);
}

export async function discoverOfficialPages(requestedLimit = 0, options: OfficialDiscoveryOptions = {}): Promise<OfficialPageDiscovery> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  const firstHtml = await fetchListPage(0, fetchImpl, retryDelayMs);
  const declaredPageCount = Number(firstHtml.match(/createPageHTML\((\d+),/)?.[1] ?? "1");
  const pageCount = requestedLimit > 0 ? Math.min(requestedLimit, declaredPageCount) : declaredPageCount;
  const discovered: Array<{ title: string; href: string }> = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const html = pageIndex === 0 ? firstHtml : await fetchListPage(pageIndex, fetchImpl, retryDelayMs);
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
