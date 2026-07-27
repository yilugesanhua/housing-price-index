import { createHash } from "node:crypto";
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as cheerio from "cheerio";
import { detectOfficialMetadata, normalizeCityName, recordKey } from "./official-parser";
import { FULL_RECORD_AUDIT_METHOD, FULL_RECORD_AUDIT_VERSION } from "./audit-report";
import { TARGET_CITIES, type ParsedBatch, type StandardRecord } from "./types";
import { validateRecords } from "./validate";
import { readRawArchiveSync } from "./raw-archive";

const OFFICIAL_PATHS = ["/sj/zxfb/", "/xxgk/sjfb/zxfb2020/"];

interface AuditedBatch {
  path: string;
  parsed: ParsedBatch;
  errors: string[];
}

type AuditedTableKind = { propertyType: "new" | "resale" | null; isCategoryTable: boolean; title: string };
const auditedTableKindCache = new WeakMap<object, AuditedTableKind>();

function isOfficialReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.stats.gov.cn" && url.pathname.endsWith(".html") && OFFICIAL_PATHS.some((prefix) => url.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

function rawCellValue(value: string | undefined): number | null {
  const normalized = (value ?? "").replace(/[\u00a0\u2000-\u200b\u3000\s]/g, "").replaceAll(",", "");
  if (!normalized || /^(?:--+|—+|-+|…+|\.\.\.)$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.round(numeric * 10) / 10 : null;
}

function rowCells($: cheerio.CheerioAPI, row: any): string[] {
  return $(row).find("th,td").toArray().map((cell) => $(cell).text().replace(/[\u00a0\u2000-\u200b\u3000]/g, " ").replace(/\s+/g, " ").trim());
}

function auditedTableKind($: cheerio.CheerioAPI, table: any): AuditedTableKind {
  const tableElement = typeof table.get === "function" ? table : $(table);
  const tableNode = tableElement.get(0);
  if (tableNode) {
    const cached = auditedTableKindCache.get(tableNode);
    if (cached) return cached;
  }
  const embedded = tableElement.find("tr").first().text().replace(/\s+/g, "").trim();
  const preceding = tableElement.prevAll("p").filter((_index: number, node: any) => $(node).text().includes("价格指数")).first().text().replace(/\s+/g, "").trim();
  const parentPreceding = tableElement.parent().prevAll("p").filter((_index: number, node: any) => $(node).text().includes("价格指数")).first().text().replace(/\s+/g, "").trim();
  const documentNodes = $("body *").toArray();
  const tablePosition = tableNode ? documentNodes.indexOf(tableNode) : -1;
  const documentPreceding = $("body p").toArray().filter((node) => {
    const position = documentNodes.indexOf(node);
    return position >= 0 && position < tablePosition && $(node).text().includes("价格指数");
  }).map((node) => $(node).text().replace(/\s+/g, "").trim()).at(-1);
  const title = embedded.includes("价格指数") ? embedded : (preceding || parentPreceding || documentPreceding || embedded);
  const propertyType: AuditedTableKind["propertyType"] = /二手住宅.*价格指数/.test(title)
    ? "resale"
    : /新建(?:商品)?住宅.*价格指数/.test(title)
      ? "new"
      : null;
  const result: AuditedTableKind = { propertyType, isCategoryTable: /分类|分套|90平方米|90m2|90㎡|90[-—至到]144|144.*以上/i.test(`${embedded}${title}`), title };
  if (tableNode) auditedTableKindCache.set(tableNode, result);
  return result;
}

function auditRecord(record: StandardRecord, tableRows: string[][][], tableKinds: AuditedTableKind[]): string[] {
  const errors: string[] = [];
  const key = recordKey(record);
  const allLocator = record.source_record_locator.match(/^table\[(\d+)] row\[(\d+)] block\[([01])] city\[([a-z]+)]$/);
  const sizeLocator = record.source_record_locator.match(/^table\[(\d+)] row\[(\d+)] band\[(le90|90_144|gt144)] city\[([a-z]+)]$/);
  if (!allLocator && !sizeLocator) return [`${key}: invalid source_record_locator ${record.source_record_locator}`];
  const locator = allLocator ?? sizeLocator!;
  const [, tableText, rowText] = locator;
  const cityId = locator[4];
  if (cityId !== record.city_id) errors.push(`${key}: locator city does not match record city`);
  const tableIndex = Number(tableText);
  const rowIndex = Number(rowText);
  const cells = tableRows[tableIndex]?.[rowIndex];
  const tableKind = tableKinds[tableIndex];
  if (!cells || !tableKind) return [...errors, `${key}: locator does not resolve to one source row`];
  if (tableKind.propertyType === null) errors.push(`${key}: source table type cannot be independently identified from title ${tableKind.title.slice(0, 100)}`);
  else if (tableKind.propertyType !== record.property_type && (record.size_band === "all" || !tableKind.isCategoryTable)) errors.push(`${key}: property_type=${record.property_type} does not match source table type ${tableKind.propertyType}`);
  if (record.size_band === "all" && tableKind.isCategoryTable) errors.push(`${key}: all-size record unexpectedly points to a category/size-band table`);
  if (record.size_band !== "all" && !tableKind.isCategoryTable) errors.push(`${key}: size-band record unexpectedly points to an all-size table`);
  const offset = allLocator
    ? Number(allLocator[3]) * (cells.length >= 8 ? 4 : 3)
    : 1 + (["le90", "90_144", "gt144"].indexOf(sizeLocator![3])) * (cells.length >= 10 ? 3 : 2);
  if (normalizeCityName(cells[allLocator ? offset : 0] ?? "") !== normalizeCityName(record.city_name)) errors.push(`${key}: source row city mismatch`);
  if (record.city_name !== TARGET_CITIES[record.city_id]) errors.push(`${key}: city_id and city_name mismatch`);
  const comparisons: Array<[string, number | null, number | null]> = [
    ["mom_index", record.mom_index, rawCellValue(cells[offset + (allLocator ? 1 : 0)])],
    ["yoy_index", record.yoy_index, rawCellValue(cells[offset + (allLocator ? 2 : 1)])],
  ];
  if (record.ytd_missing_reason !== "not-published-for-this-table") comparisons.push(["ytd_avg_index", record.ytd_avg_index, rawCellValue(cells[offset + (allLocator ? 3 : 2)])]);
  for (const [field, actual, source] of comparisons) if (actual !== source) errors.push(`${key}: ${field}=${actual} does not match source cell ${source}`);
  return errors;
}

function auditBatch(path: string): AuditedBatch {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ParsedBatch;
  const batch = parsed.source_batch;
  const errors = validateRecords(parsed.records).map((error) => `${batch.source_batch_id}: ${error}`);
  const htmlPath = resolve(dirname(path), `${batch.raw_content_sha256}.html`);
  let html: Buffer;
  try {
    html = readRawArchiveSync(htmlPath);
  } catch (error) {
    return { path, parsed, errors: [...errors, `${batch.source_batch_id}: ${String(error)}`] };
  }
  const digest = createHash("sha256").update(html).digest("hex");
  if (digest !== batch.raw_content_sha256) errors.push(`${batch.source_batch_id}: raw SHA-256 mismatch`);
  const expectedArchive = `data/raw/${batch.stat_month}/${digest}.html`;
  if (batch.raw_archive_uri.replaceAll("\\", "/") !== expectedArchive) errors.push(`${batch.source_batch_id}: raw_archive_uri mismatch`);
  if (!isOfficialReleaseUrl(batch.source_url)) errors.push(`${batch.source_batch_id}: source_url is not an allowlisted official release URL`);
  if (!isOfficialReleaseUrl(batch.final_url)) errors.push(`${batch.source_batch_id}: final_url is not an allowlisted official release URL`);
  if (batch.http_status < 200 || batch.http_status >= 300) errors.push(`${batch.source_batch_id}: non-success HTTP status ${batch.http_status}`);
  const metadata = detectOfficialMetadata(html.toString("utf8"), batch.final_url || batch.source_url);
  if (metadata.statMonth !== batch.stat_month) errors.push(`${batch.source_batch_id}: title month ${metadata.statMonth} differs from batch ${batch.stat_month}`);
  if (metadata.releaseDate !== batch.release_date) errors.push(`${batch.source_batch_id}: release date ${metadata.releaseDate} differs from batch ${batch.release_date}`);
  const expectedRecordCount = Object.keys(TARGET_CITIES).length * 2 * 4;
  if (parsed.records.length !== expectedRecordCount) errors.push(`${batch.source_batch_id}: expected ${expectedRecordCount} target records, got ${parsed.records.length}`);
  const expectedKeys = new Set(Object.keys(TARGET_CITIES).flatMap((cityId) => ["new", "resale"].flatMap((propertyType) => ["all", "le90", "90_144", "gt144"].map((sizeBand) => `${batch.stat_month}|${cityId}|${propertyType}|${sizeBand}`))));
  const actualKeys = new Set(parsed.records.map(recordKey));
  for (const key of expectedKeys) if (!actualKeys.has(key)) errors.push(`${batch.source_batch_id}: missing key ${key}`);
  const locators = new Set<string>();
  const $ = cheerio.load(html.toString("utf8"));
  const tables = $("table").toArray();
  const tableRows = tables.map((table) => $(table).find("tr").toArray().map((row) => rowCells($, row)));
  const tableKinds = tables.map((_table, index) => auditedTableKind($, $("table").eq(index)));
  for (const record of parsed.records) {
    if (locators.has(record.source_record_locator)) errors.push(`${batch.source_batch_id}: duplicate locator ${record.source_record_locator}`);
    locators.add(record.source_record_locator);
    if (record.source_batch_id !== batch.source_batch_id || record.source_url !== batch.source_url || record.stat_month !== batch.stat_month || record.release_date !== batch.release_date) errors.push(`${recordKey(record)}: record source metadata differs from batch`);
    errors.push(...auditRecord(record, tableRows, tableKinds));
  }
  return { path, parsed, errors };
}

const requestedPath = process.argv[2];
const allPaths = globSync("data/raw/**/*.batch.json").sort();
if (requestedPath === "--report-only") {
  const batches = allPaths.map((path) => JSON.parse(readFileSync(path, "utf8")) as ParsedBatch);
  const invalid = batches.filter(({ source_batch }) => source_batch.verification_status !== "verified" || source_batch.verification_method !== FULL_RECORD_AUDIT_METHOD);
  if (invalid.length > 0) throw new Error(`Cannot summarize audit: ${invalid.length} batch(es) lack current verification`);
  const months = batches.map(({ source_batch }) => source_batch.stat_month).sort();
  const report = {
    audit_version: FULL_RECORD_AUDIT_VERSION,
    verified_at: new Date().toISOString(),
    verification_method: FULL_RECORD_AUDIT_METHOD,
    batch_count: batches.length,
    record_count: batches.reduce((sum, batch) => sum + batch.records.length, 0),
    coverage_start: months[0] ?? null,
    coverage_end: months.at(-1) ?? null,
    checks: ["raw SHA-256", "official URL allowlist", "title month", "release date", "record schema", "complete city/property/size-band keys", "independent source table type", "all-size versus size-band table", "source locator resolution", "raw source cell equality"],
    result: "passed",
    batches: batches.map((batch) => ({ source_batch_id: batch.source_batch.source_batch_id, stat_month: batch.source_batch.stat_month, raw_content_sha256: batch.source_batch.raw_content_sha256, records_checked: batch.records.length, result: "passed" })),
  };
  writeFileSync(resolve("data", "audit-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`Summarized ${report.record_count} verified records across ${report.batch_count} batches`);
  process.exit(0);
}
const paths = requestedPath ? [requestedPath] : allPaths;
if (paths.length === 0) throw new Error("No raw source batches found for full-record audit");
const orderedPaths = paths.sort();
console.log(`Auditing ${orderedPaths.length} raw source batches`);
const batchSummaries: Array<{ source_batch_id: string; stat_month: string; raw_content_sha256: string; records_checked: number; result: "passed" }> = [];
const errorSamples: string[] = [];
let errorCount = 0;
let recordCount = 0;
for (const [index, path] of orderedPaths.entries()) {
  const item = auditBatch(path);
  errorCount += item.errors.length;
  if (errorSamples.length < 50) errorSamples.push(...item.errors.slice(0, 50 - errorSamples.length));
  recordCount += item.parsed.records.length;
  batchSummaries.push({
    source_batch_id: item.parsed.source_batch.source_batch_id,
    stat_month: item.parsed.source_batch.stat_month,
    raw_content_sha256: item.parsed.source_batch.raw_content_sha256,
    records_checked: item.parsed.records.length,
    result: "passed",
  });
  (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
  if ((index + 1) % 10 === 0 || index + 1 === orderedPaths.length) console.log(`Audited ${index + 1}/${orderedPaths.length} batches`);
}
if (errorCount > 0) {
  console.error(`Full-record audit failed with ${errorCount} error(s):`);
  for (const error of errorSamples) console.error(`- ${error}`);
  if (errorCount > errorSamples.length) console.error(`- ... ${errorCount - errorSamples.length} additional error(s) omitted`);
  process.exitCode = 1;
} else {
  const verifiedAt = new Date().toISOString();
  for (const path of orderedPaths) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ParsedBatch;
    parsed.source_batch.verification_status = "verified";
    parsed.source_batch.verification_method = FULL_RECORD_AUDIT_METHOD;
    writeFileSync(path, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  }
  if (requestedPath) {
    console.log(`Verified ${recordCount} records in ${requestedPath}`);
  } else {
  const months = batchSummaries.map((item) => item.stat_month).sort();
  const report = {
    audit_version: FULL_RECORD_AUDIT_VERSION,
    verified_at: verifiedAt,
    verification_method: FULL_RECORD_AUDIT_METHOD,
    batch_count: batchSummaries.length,
    record_count: recordCount,
    coverage_start: months[0] ?? null,
    coverage_end: months.at(-1) ?? null,
    checks: ["raw SHA-256", "official URL allowlist", "title month", "release date", "record schema", "complete city/property/size-band keys", "independent source table type", "all-size versus size-band table", "source locator resolution", "raw source cell equality"],
    result: "passed",
    batches: batchSummaries,
  };
  writeFileSync(resolve("data", "audit-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`Verified ${report.record_count} records across ${report.batch_count} batches (${report.coverage_start} to ${report.coverage_end})`);
  }
}
