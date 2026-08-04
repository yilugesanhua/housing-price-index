import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import type { CityId, PropertyType, SizeBand } from "../../packages/core/src/index";
import { TARGET_CITIES, type ParsedBatch, type SourceBatch, type StandardRecord } from "./types";

export const PARSER_VERSION = "official-html-v8-product-housing-only-strict-release-date";
export const SCHEMA_VERSION = "1.0.0";

const cityByNormalizedName = new Map<string, CityId>(
  Object.entries(TARGET_CITIES).map(([id, name]) => [normalizeCityName(String(name)), id as CityId]),
);

export function normalizeCityName(value: string): string {
  return value.replace(/[\u00a0\u2000-\u200b\u3000\s]/g, "").replace(/[（）()]/g, "").trim();
}

function parseMonth(text: string): string {
  const match = text.match(/(20\d{2})年\s*(\d{1,2})月/);
  if (!match) throw new Error(`无法从官方页面标题识别统计月份: ${text.slice(0, 120)}`);
  return `${match[1]}-${match[2].padStart(2, "0")}`;
}

function parseReleaseDate($: cheerio.CheerioAPI, sourceUrl: string): string {
  const meta = $("meta[name=PubDate], meta[name=publishdate], meta[name=ArticleDate]").attr("content");
  const fromMeta = meta?.match(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}/)?.[0];
  if (fromMeta) return fromMeta.replaceAll("/", "-");
  const visibleDate = $(".detail-title-des p, .detail-title-des, .info, .time").text().match(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}/)?.[0];
  if (visibleDate) return visibleDate.replaceAll("/", "-");
  const fromUrl = sourceUrl.match(/t(20\d{6})(?:_|\.)/i)?.[1];
  if (fromUrl) return `${fromUrl.slice(0, 4)}-${fromUrl.slice(4, 6)}-${fromUrl.slice(6, 8)}`;
  throw new Error(`无法从官方页面识别发布日期: ${sourceUrl}`);
}

export function detectOfficialMetadata(html: string, sourceUrl: string): { statMonth: string; releaseDate: string } {
  const $ = cheerio.load(html);
  const title = $("meta[name=ArticleTitle]").attr("content")
    ?? $("h1, h2, .xxgkNbXq2").toArray().map((node) => $(node).text().replace(/\s+/g, " ").trim()).find((value) => /20\d{2}年\s*\d{1,2}月/.test(value))
    ?? $("title").text();
  const statMonth = parseMonth(title);
  return { statMonth, releaseDate: parseReleaseDate($, sourceUrl) };
}

function parseIndex(value: string | undefined): { value: number | null; reason: string | null } {
  const normalized = (value ?? "").replace(/[\u00a0\u2000-\u200b\u3000\s]/g, "").trim();
  if (!normalized || /^(?:--+|—+|-+|…+|\.\.\.)$/.test(normalized)) {
    return { value: null, reason: "official-empty-or-dash" };
  }
  const numeric = Number(normalized.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return { value: null, reason: "unparseable-official-value" };
  return { value: Math.round(numeric * 10) / 10, reason: null };
}

function tableTitle($: cheerio.CheerioAPI, table: any): string {
  const embeddedTitle = $(table).find("tr").first().text().replace(/\s+/g, "").trim();
  if (/价格(?:分类)?指数|分类价格指数/.test(embeddedTitle)) return embeddedTitle;
  const directCandidate = $(table).prevAll("p").filter((_index, node) => /价格(?:分类)?指数|分类价格指数/.test($(node).text())).first().text().replace(/\s+/g, "").trim();
  if (directCandidate) return directCandidate;
  const parent = $(table).parent();
  const candidate = parent.prevAll("p").filter((_index, node) => /价格(?:分类)?指数|分类价格指数/.test($(node).text())).first().text().replace(/\s+/g, "").trim();
  if (candidate) return candidate;
  const documentNodes = $("body *").toArray();
  const tablePosition = documentNodes.indexOf(table);
  return $("body p").toArray().filter((node) => {
    const position = documentNodes.indexOf(node);
    return position >= 0 && position < tablePosition && /价格(?:分类)?指数|分类价格指数/.test($(node).text());
  }).map((node) => $(node).text().replace(/\s+/g, "").trim()).at(-1) ?? "";
}

function propertyTypeFromTitle(title: string): PropertyType | null {
  if (/新建商品住宅(?:销售价格指数|价格指数|销售价格分类指数|分类价格指数)/.test(title)) return "new";
  if (/二手住宅(?:销售价格指数|价格指数|销售价格分类指数|分类价格指数)/.test(title)) return "resale";
  return null;
}

function ytdEndMonth(header: string, statMonth: string): string | null {
  const match = header.match(/1\s*[-—]\s*(\d{1,2})月平均/);
  if (!match) return null;
  return `${statMonth.slice(0, 4)}-${match[1].padStart(2, "0")}`;
}

function parseRowCells($: cheerio.CheerioAPI, row: any): string[] {
  return $(row).find("th,td").toArray().map((cell) => $(cell).text().replace(/[\u00a0\u2000-\u200b\u3000]/g, " ").replace(/\s+/g, " ").trim());
}

function isSizeBandTable($: cheerio.CheerioAPI, table: any, heading: string): boolean {
  const header = $(table).find("tr").slice(0, 3).toArray().flatMap((row) => parseRowCells($, row)).join("").replace(/\s+/g, "");
  return /分类|分套|90(?:m2|㎡|平方米)|90[-—至到]144|144(?:m2|㎡|平方米)?以上/i.test(`${heading}${header}`);
}

function makeRecord(
  cells: string[],
  block: 0 | 1,
  propertyType: PropertyType,
  statMonth: string,
  releaseDate: string,
  sourceBatch: SourceBatch,
  tableIndex: number,
  rowIndex: number,
  ytdHeader: string,
): StandardRecord | null {
  const hasYtd = ytdEndMonth(ytdHeader, statMonth) !== null || ytdHeader.includes("累计");
  const blockWidth = cells.length >= 8 ? 4 : 3;
  const offset = block * blockWidth;
  const cityText = cells[offset];
  const cityId = cityByNormalizedName.get(normalizeCityName(cityText ?? ""));
  if (!cityId) return null;
  const mom = parseIndex(cells[offset + 1]);
  const yoy = parseIndex(cells[offset + 2]);
  const ytd = hasYtd ? parseIndex(cells[offset + 3]) : { value: null, reason: "not-published-for-this-table" };
  const ytdEnd = ytdEndMonth(ytdHeader, statMonth);
  return {
    stat_month: statMonth,
    release_date: releaseDate,
    city_id: cityId,
    city_name: TARGET_CITIES[cityId],
    property_type: propertyType,
    size_band: "all",
    mom_index: mom.value,
    yoy_index: yoy.value,
    ytd_avg_index: hasYtd ? ytd.value : null,
    ytd_period_start: hasYtd && ytd.value !== null ? `${statMonth.slice(0, 4)}-01` : null,
    ytd_period_end: hasYtd && ytd.value !== null ? (ytdEnd ?? statMonth) : null,
    ytd_comparison_base: hasYtd && ytd.value !== null ? "上年同期=100" : null,
    mom_change: mom.value === null ? null : Math.round((mom.value - 100) * 10) / 10,
    yoy_change: yoy.value === null ? null : Math.round((yoy.value - 100) * 10) / 10,
    mom_missing_reason: mom.reason,
    yoy_missing_reason: yoy.reason,
    ytd_missing_reason: hasYtd ? ytd.reason : "not-published-for-this-table",
    source_url: sourceBatch.source_url,
    source_type: sourceBatch.source_type,
    source_batch_id: sourceBatch.source_batch_id,
    source_record_locator: `table[${tableIndex}] row[${rowIndex}] block[${block}] city[${cityId}]`,
    fetched_at: sourceBatch.fetched_at,
    methodology_version: statMonth >= "2026-01" ? "nbs-house-price-index-2025-base" : statMonth >= "2021-01" ? "nbs-house-price-index-2020-base" : "nbs-house-price-index-2015-base",
    parser_version: PARSER_VERSION,
  };
}

const SIZE_BANDS = ["le90", "90_144", "gt144"] as const satisfies readonly SizeBand[];

function makeSizeBandRecord(
  cells: string[],
  sizeBand: (typeof SIZE_BANDS)[number],
  propertyType: PropertyType,
  statMonth: string,
  releaseDate: string,
  sourceBatch: SourceBatch,
  tableIndex: number,
  rowIndex: number,
  ytdHeader: string,
): StandardRecord | null {
  const cityId = cityByNormalizedName.get(normalizeCityName(cells[0] ?? ""));
  if (!cityId || cells.length < 7) return null;
  const bandIndex = SIZE_BANDS.indexOf(sizeBand);
  const bandWidth = cells.length >= 10 ? 3 : 2;
  const offset = 1 + bandIndex * bandWidth;
  const mom = parseIndex(cells[offset]);
  const yoy = parseIndex(cells[offset + 1]);
  const hasYtd = ytdEndMonth(ytdHeader, statMonth) !== null || ytdHeader.includes("累计");
  const ytd = hasYtd && bandWidth === 3 ? parseIndex(cells[offset + 2]) : { value: null, reason: "not-published-for-this-table" };
  const ytdEnd = ytdEndMonth(ytdHeader, statMonth);
  return {
    stat_month: statMonth,
    release_date: releaseDate,
    city_id: cityId,
    city_name: TARGET_CITIES[cityId],
    property_type: propertyType,
    size_band: sizeBand,
    mom_index: mom.value,
    yoy_index: yoy.value,
    ytd_avg_index: hasYtd ? ytd.value : null,
    ytd_period_start: hasYtd && ytd.value !== null ? `${statMonth.slice(0, 4)}-01` : null,
    ytd_period_end: hasYtd && ytd.value !== null ? (ytdEnd ?? statMonth) : null,
    ytd_comparison_base: hasYtd && ytd.value !== null ? "上年同期=100" : null,
    mom_change: mom.value === null ? null : Math.round((mom.value - 100) * 10) / 10,
    yoy_change: yoy.value === null ? null : Math.round((yoy.value - 100) * 10) / 10,
    mom_missing_reason: mom.reason,
    yoy_missing_reason: yoy.reason,
    ytd_missing_reason: hasYtd ? ytd.reason : "not-published-for-this-table",
    source_url: sourceBatch.source_url,
    source_type: sourceBatch.source_type,
    source_batch_id: sourceBatch.source_batch_id,
    source_record_locator: `table[${tableIndex}] row[${rowIndex}] band[${sizeBand}] city[${cityId}]`,
    fetched_at: sourceBatch.fetched_at,
    methodology_version: statMonth >= "2026-01" ? "nbs-house-price-index-2025-base" : statMonth >= "2021-01" ? "nbs-house-price-index-2020-base" : "nbs-house-price-index-2015-base",
    parser_version: PARSER_VERSION,
  };
}

export function parseOfficialHtml(html: string, sourceBatch: SourceBatch): ParsedBatch {
  const $ = cheerio.load(html);
  const detected = detectOfficialMetadata(html, sourceBatch.source_url);
  const statMonth = detected.statMonth;
  const releaseDate = sourceBatch.release_date || detected.releaseDate;
  const records: StandardRecord[] = [];
  let inferredSizeProperty: PropertyType = "new";
  const inferredSizeCities = new Set<CityId>();
  $("table").each((tableIndex, table) => {
    const heading = tableTitle($, table);
    const rows = $(table).find("tr").toArray();
    const sizeBandTable = isSizeBandTable($, table, heading);
    const embeddedHeading = rows[0] ? parseRowCells($, rows[0]).join("") : "";
    const explicitSizeProperty = sizeBandTable ? propertyTypeFromTitle(embeddedHeading) : null;
    if (explicitSizeProperty && explicitSizeProperty !== inferredSizeProperty) {
      inferredSizeProperty = explicitSizeProperty;
      inferredSizeCities.clear();
    }
    const propertyType = sizeBandTable ? (explicitSizeProperty ?? inferredSizeProperty) : propertyTypeFromTitle(heading);
    if (!propertyType) return;
    const headerCells = rows.slice(0, sizeBandTable ? 4 : 2).flatMap((row) => parseRowCells($, row));
    const ytdHeader = headerCells.find((cell) => /1\s*[-—]\s*\d{1,2}月平均|累计/.test(cell)) ?? "";
    if (sizeBandTable) {
      rows.forEach((row, rowIndex) => {
        const cells = parseRowCells($, row);
        for (const sizeBand of SIZE_BANDS) {
          const record = makeSizeBandRecord(cells, sizeBand, propertyType, statMonth, releaseDate, sourceBatch, tableIndex, rowIndex, ytdHeader);
          if (record) {
            records.push(record);
            if (sizeBand === "le90") inferredSizeCities.add(record.city_id);
          }
        }
      });
      if (inferredSizeCities.size === Object.keys(TARGET_CITIES).length) {
        inferredSizeProperty = propertyType === "new" ? "resale" : "new";
        inferredSizeCities.clear();
      }
      return;
    }
    rows.slice(2).forEach((row, rowIndex) => {
      const cells = parseRowCells($, row);
      if (cells.length < 4) return;
      for (const block of [0, 1] as const) {
        const record = makeRecord(cells, block, propertyType, statMonth, releaseDate, sourceBatch, tableIndex, rowIndex + 2, ytdHeader);
        if (record) records.push(record);
      }
    });
  });
  const unique = new Map<string, StandardRecord>();
  for (const record of records) {
    const key = recordKey(record);
    const existing = unique.get(key);
    if (existing) {
      const { source_record_locator: _existingLocator, ...existingComparable } = existing;
      const { source_record_locator: _recordLocator, ...recordComparable } = record;
      if (JSON.stringify(existingComparable) !== JSON.stringify(recordComparable)) {
        throw new Error(`Conflicting duplicate official record ${key}: ${existing.source_record_locator} versus ${record.source_record_locator}`);
      }
    }
    unique.set(key, record);
  }
  return { source_batch: sourceBatch, records: [...unique.values()] };
}

export function recordKey(record: Pick<StandardRecord, "stat_month" | "city_id" | "property_type" | "size_band">): string {
  return [record.stat_month, record.city_id, record.property_type, record.size_band].join("|");
}

export function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function parseOfficialFile(path: string, sourceBatch: SourceBatch): Promise<ParsedBatch> {
  return parseOfficialHtml(await readFile(path, "utf8"), sourceBatch);
}
