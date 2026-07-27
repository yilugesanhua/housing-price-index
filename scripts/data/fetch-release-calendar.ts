import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as cheerio from "cheerio";

export const RELEASE_CALENDAR_URL = "https://www.stats.gov.cn/sj/fbrc/bnxxfb/";
export const MONTH_GRID_CALENDAR_URL = "https://www.stats.gov.cn/sj/fbrc/index_fbrc.html";
const DEFAULT_RELEASE_TIME = "9:30";
const KNOWN_REPORT_NAMES = new Set([
  "商品住宅销售价格指数月度报告",
  "70个大中城市商品住宅销售价格变动情况",
]);

export type ReleaseCalendarEntry = {
  release_month: string;
  expected_stat_month: string;
  scheduled_at: string;
  date_text: string;
  time_text: string;
};

export type ReleaseCalendar = {
  year: number;
  fetched_at: string;
  source_url: string;
  report_name: string;
  raw_content_sha256: string;
  source_urls?: string[];
  source_warnings?: string[];
  entries: ReleaseCalendarEntry[];
};

type MonthGridRecord = {
  SUB_TITLE?: unknown;
  TITLE?: unknown;
  URL?: unknown;
};

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeReportName(value: string): string {
  return cleanText(value).replace(/[\s，,。；;：:（）()、]/g, "");
}

export function scoreReleaseReportName(value: string): number {
  const name = normalizeReportName(value);
  if (KNOWN_REPORT_NAMES.has(name)) return 100;
  if (!name.includes("住宅") || !name.includes("价格")) return 0;
  if (!/(商品|销售)/.test(name) || !/(指数|变动|变化)/.test(name)) return 0;
  const hasCityScope = /(70个大中城市|七十个大中城市|70城|大中城市)/.test(name);
  const hasMonthlyScope = /(月度|月报)/.test(name);
  if (!hasCityScope && !hasMonthlyScope) return 0;
  return 5
    + (name.includes("商品住宅") ? 2 : 0)
    + (name.includes("销售价格") ? 2 : 0)
    + (hasCityScope ? 3 : 0)
    + (hasMonthlyScope ? 2 : 0)
    + (/(报告|情况)/.test(name) ? 1 : 0);
}

function findReportRow($: cheerio.CheerioAPI) {
  const candidates = $("tr").map((_, row) => {
    const cells = $(row).find("td").map((__, cell) => cleanText($(cell).text())).get();
    const reportName = cells[1] ?? "";
    return { row, reportName, score: scoreReleaseReportName(reportName) };
  }).get().filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
  if (candidates.length === 0) throw new Error("发布预告页面未找到70城商品住宅销售价格报告");
  if (candidates[1]?.score === candidates[0].score) {
    throw new Error(`发布预告存在多个同等匹配报告，无法安全选择：${candidates[0].reportName}；${candidates[1].reportName}`);
  }
  return candidates[0];
}

function previousMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseScheduledAt(year: number, month: number, dateText: string, timeText: string): string {
  const day = Number(dateText.match(/^(\d{1,2})(?:\s*[\/／].*)?$/)?.[1]);
  const timeMatch = timeText.match(/^(\d{1,2}):(\d{2})$/);
  if (!Number.isInteger(day) || day < 1 || day > 31 || !timeMatch) {
    throw new Error(`${month}月发布预告无法解析：日期“${dateText}”，时间“${timeText}”`);
  }
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) throw new Error(`${month}月发布预告时间无效：${timeText}`);
  const validationDate = new Date(Date.UTC(year, month - 1, day));
  if (validationDate.getUTCMonth() !== month - 1) throw new Error(`${month}月发布预告日期无效：${dateText}`);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;
}

export function parseReleaseCalendarHtml(html: string, fetchedAt = new Date().toISOString(), sourceUrl = RELEASE_CALENDAR_URL): ReleaseCalendar {
  const $ = cheerio.load(html);
  const pageText = cleanText($.root().text());
  const year = Number(pageText.match(/(20\d{2})年国家统计局主要统计信息发布日程表/)?.[1]);
  if (!Number.isInteger(year)) throw new Error("发布预告页面未找到年度日程表标题");

  const matched = findReportRow($);
  const targetRow = $(matched.row);
  const dateCells = targetRow.find("td").map((_, cell) => cleanText($(cell).text())).get();
  const timeCells = targetRow.next("tr").find("td").map((_, cell) => cleanText($(cell).text())).get();
  if (dateCells.length !== 14 || timeCells.length !== 12) {
    throw new Error(`发布预告目标行结构异常：日期单元格 ${dateCells.length}，时间单元格 ${timeCells.length}`);
  }
  if (dateCells[1] !== matched.reportName) throw new Error("发布预告目标行标题位置发生变化");

  const entries = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const dateText = dateCells[index + 2];
    const timeText = timeCells[index];
    return {
      release_month: `${year}-${String(month).padStart(2, "0")}`,
      expected_stat_month: previousMonth(year, month),
      scheduled_at: parseScheduledAt(year, month, dateText, timeText),
      date_text: dateText,
      time_text: timeText,
    };
  });

  return {
    year,
    fetched_at: fetchedAt,
    source_url: sourceUrl,
    report_name: matched.reportName,
    raw_content_sha256: createHash("sha256").update(html).digest("hex"),
    entries,
  };
}

function parseMonthGridDate(value: string): { year: number; month: number; day: number } {
  const match = value.match(/^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/);
  if (!match) throw new Error(`月度发布日历包含无效日期：${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validationDate = new Date(Date.UTC(year, month - 1, day));
  if (validationDate.getUTCFullYear() !== year || validationDate.getUTCMonth() !== month - 1 || validationDate.getUTCDate() !== day) {
    throw new Error(`月度发布日历包含无效日期：${value}`);
  }
  return { year, month, day };
}

export function parseMonthGridCalendar(
  text: string,
  fetchedAt = new Date().toISOString(),
  sourceUrl = MONTH_GRID_CALENDAR_URL,
): ReleaseCalendar {
  let records: MonthGridRecord[];
  try {
    const normalized = text.trim().replace(/,\s*]$/, "]");
    const parsed: unknown = JSON.parse(normalized);
    if (!Array.isArray(parsed)) throw new Error("root is not an array");
    records = parsed as MonthGridRecord[];
  } catch (error) {
    throw new Error(`月度发布日历不是有效JSON：${error instanceof Error ? error.message : String(error)}`);
  }

  const candidates = records.map((record) => {
    const compactDate = typeof record.SUB_TITLE === "string" ? record.SUB_TITLE.trim() : "";
    const reportName = typeof record.TITLE === "string" ? cleanText(record.TITLE) : "";
    return { compactDate, reportName, score: scoreReleaseReportName(reportName) };
  }).filter((candidate) => candidate.score > 0).map((candidate) => ({ ...candidate, ...parseMonthGridDate(candidate.compactDate) }));
  if (candidates.length === 0) throw new Error("月度发布日历未找到70城商品住宅销售价格报告");

  const years = [...new Set(candidates.map((candidate) => candidate.year))].sort((a, b) => b - a);
  const year = years[0];
  const entries = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const monthly = candidates.filter((candidate) => candidate.year === year && candidate.month === month).sort((a, b) => b.score - a.score);
    if (monthly.length === 0) throw new Error(`月度发布日历缺少${year}年${month}月目标报告`);
    if (monthly[1]?.score === monthly[0].score) {
      throw new Error(`月度发布日历${year}年${month}月存在多个同等匹配报告，无法安全选择`);
    }
    const selected = monthly[0];
    return {
      release_month: `${year}-${String(month).padStart(2, "0")}`,
      expected_stat_month: previousMonth(year, month),
      scheduled_at: parseScheduledAt(year, month, String(selected.day), DEFAULT_RELEASE_TIME),
      date_text: String(selected.day),
      time_text: DEFAULT_RELEASE_TIME,
    };
  });
  const selectedYearCandidates = candidates.filter((candidate) => candidate.year === year);
  const reportNames = [...new Set(selectedYearCandidates.map((candidate) => candidate.reportName))];
  return {
    year,
    fetched_at: fetchedAt,
    source_url: sourceUrl,
    source_urls: [sourceUrl],
    report_name: reportNames.join(" / "),
    raw_content_sha256: createHash("sha256").update(text).digest("hex"),
    entries,
  };
}

export function mergeReleaseCalendars(monthGrid: ReleaseCalendar, annual: ReleaseCalendar): ReleaseCalendar {
  if (monthGrid.year !== annual.year) throw new Error(`两个官方发布日程年份不一致：${monthGrid.year} 与 ${annual.year}`);
  const entries = monthGrid.entries.map((entry) => {
    const annualEntry = annual.entries.find((candidate) => candidate.release_month === entry.release_month);
    if (!annualEntry) throw new Error(`年度发布日程缺少 ${entry.release_month}`);
    const monthGridDate = entry.scheduled_at.slice(0, 10);
    const annualDate = annualEntry.scheduled_at.slice(0, 10);
    if (monthGridDate !== annualDate) {
      throw new Error(`两个官方发布日程的 ${entry.release_month} 日期不一致：${monthGridDate} 与 ${annualDate}`);
    }
    return annualEntry;
  });
  return {
    ...monthGrid,
    fetched_at: [monthGrid.fetched_at, annual.fetched_at].sort().at(-1) ?? monthGrid.fetched_at,
    source_urls: [monthGrid.source_url, annual.source_url],
    raw_content_sha256: createHash("sha256").update(`${monthGrid.raw_content_sha256}:${annual.raw_content_sha256}`).digest("hex"),
    entries,
  };
}

async function fetchOfficialText(url: string): Promise<{ text: string; finalUrl: string }> {
  const response = await fetch(url, {
    headers: { "User-Agent": "HousingPriceIndexBot/0.1 (+monthly release monitoring)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`官方发布预告 ${url} 返回 HTTP ${response.status}`);
  return { text: await response.text(), finalUrl: response.url || url };
}

export async function fetchReleaseCalendar(): Promise<ReleaseCalendar> {
  const fetchedAt = new Date().toISOString();
  const [monthGridResult, annualResult] = await Promise.allSettled([
    fetchOfficialText(MONTH_GRID_CALENDAR_URL),
    fetchOfficialText(RELEASE_CALENDAR_URL),
  ]);
  let monthGrid: ReleaseCalendar | null = null;
  let annual: ReleaseCalendar | null = null;
  let monthGridError: unknown = monthGridResult.status === "rejected" ? monthGridResult.reason : null;
  let annualError: unknown = annualResult.status === "rejected" ? annualResult.reason : null;
  if (monthGridResult.status === "fulfilled") {
    try {
      monthGrid = parseMonthGridCalendar(monthGridResult.value.text, fetchedAt, monthGridResult.value.finalUrl);
    } catch (error) {
      monthGridError = error;
    }
  }
  if (annualResult.status === "fulfilled") {
    try {
      annual = parseReleaseCalendarHtml(annualResult.value.text, fetchedAt, annualResult.value.finalUrl);
    } catch (error) {
      annualError = error;
    }
  }
  if (monthGrid && annual) return mergeReleaseCalendars(monthGrid, annual);
  if (monthGrid) return { ...monthGrid, source_warnings: [`年度发布日程不可用：${String(annualError)}`] };
  if (annual) return { ...annual, source_urls: [annual.source_url], source_warnings: [`月度发布日历不可用：${String(monthGridError)}`] };
  throw new Error(`两个官方发布日程入口均不可用：月度日历=${String(monthGridError)}；年度日程=${String(annualError)}`);
}

async function main() {
  const outputArgument = process.argv.find((arg) => arg.startsWith("--output="))?.split("=").slice(1).join("=");
  const outputPath = resolve(outputArgument || resolve("work", "monthly-data-check", "release-calendar.json"));
  const calendar = await fetchReleaseCalendar();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(calendar, null, 2)}\n`, "utf8");
  console.log(`Synced ${calendar.year} official release calendar (${calendar.entries.length} months) -> ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
