import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { recordKey } from "./official-parser";
import { atomicReplaceDirectory } from "./atomic-publish";
import { validateAuditReport, type AuditReport } from "./audit-report";
import { addOneMonth, deriveDataStatus } from "./status";
import { hasRevisableRecordChange } from "./revision";
import { sourceDatasetVersion } from "./source-identity";
import { readBatches, validateRecords } from "./validate";
import type { StandardRecord } from "./types";
import { CITY_IDS, FEATURED_CITY_IDS, type CityId, type MarketBreadthPoint, type Metric, type PropertyType, type SizeBand } from "@housing/core";

const OUTPUT_DIR = resolve(process.env.AUTO_RELEASE_OUTPUT_ROOT ?? resolve("apps", "web", "public", "data"));
const TEMP_DIR = `${OUTPUT_DIR}.tmp`;
const BACKUP_DIR = `${OUTPUT_DIR}.backup`;
const PREVIOUS_OUTPUT_DIR = resolve(process.env.AUTO_RELEASE_PREVIOUS_OUTPUT_ROOT ?? OUTPUT_DIR);
const NORMALIZED_DIR = resolve(process.env.AUTO_RELEASE_NORMALIZED_ROOT ?? resolve("data", "normalized"));
const PREVIOUS_NORMALIZED_DIR = resolve(process.env.AUTO_RELEASE_PREVIOUS_NORMALIZED_ROOT ?? NORMALIZED_DIR);
const AUDIT_REPORT_PATH = resolve(process.env.AUTO_RELEASE_AUDIT_REPORT_PATH ?? resolve("data", "audit-report.json"));
const MIN_COVERAGE_START = "2011-07";

function releaseTimestamp(): string {
  const seed = process.env.AUTO_RELEASE_TIME_SEED;
  if (!seed) return new Date().toISOString();
  const timestamp = Date.parse(seed);
  if (!Number.isFinite(timestamp)) throw new Error("AUTO_RELEASE_TIME_SEED is invalid");
  return new Date(timestamp).toISOString();
}

function configuredNextCheckAt(fallback: string): string {
  const configured = process.env.AUTO_RELEASE_NEXT_CHECK_AT;
  if (!configured) return fallback;
  const timestamp = Date.parse(configured);
  if (!Number.isFinite(timestamp)) throw new Error("AUTO_RELEASE_NEXT_CHECK_AT is invalid");
  return new Date(timestamp).toISOString();
}

interface RevisionRecord {
  revision_id: string;
  release_type: "historical_correction";
  reason_type: "official_revision" | "parser_error" | "transform_error" | "mapping_error";
  record_key: string;
  previous_value: StandardRecord;
  revised_value: StandardRecord;
  detected_at: string;
  source_batch_id: string;
  reason: string;
  supersedes_revision_id: string | null;
}

function monthRange(start: string, end: string): string[] {
  const result: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endValue = Number(end.replace("-", ""));
  while (year * 100 + month <= endValue) {
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return result;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return fallback; }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await rm(temporaryPath, { force: true });
  await writeFile(temporaryPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporaryPath, path);
}

const batches = await readBatches();
const records = batches.flatMap((batch) => batch.records);
const errors = validateRecords(records);
const auditReport = await readJson<AuditReport | null>(AUDIT_REPORT_PATH, null);
errors.push(...validateAuditReport(auditReport, batches));
const verifiedBatches = batches.filter((batch) => batch.source_batch.verification_status === "verified");
if (batches.length === 0) errors.push("no source batches found under data/raw");
if (verifiedBatches.length !== batches.length) errors.push("production publish requires every source batch to be verified");
const months = [...new Set(records.map((record) => record.stat_month))].sort();
if (months[0] !== MIN_COVERAGE_START) errors.push(`coverage must start at ${MIN_COVERAGE_START}; got ${months[0] ?? "none"}`);
const latestMonth = months.at(-1) ?? "";
if (latestMonth) {
  const gaps = monthRange(MIN_COVERAGE_START, latestMonth).filter((month) => !months.includes(month));
  if (gaps.length > 0) errors.push(`coverage gaps must be resolved before production publish: ${gaps.join(", ")}`);
}
if (latestMonth && latestMonth !== batches.map((batch) => batch.source_batch.stat_month).sort().at(-1)) errors.push("latest batch month does not match record coverage");

if (errors.length > 0) {
  console.error("Publish blocked by data contract:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const sortedRecords = [...records].sort((a, b) => recordKey(a).localeCompare(recordKey(b)));
  const recordsJson = JSON.stringify(sortedRecords);
  const shortHash = createHash("sha256").update(recordsJson).digest("hex").slice(0, 12);
  const datasetVersion = `${latestMonth}-${shortHash}`;
  const existingRevisions = await readJson<RevisionRecord[]>(resolve(PREVIOUS_NORMALIZED_DIR, "revisions.json"), []);
  const sourceVersion = sourceDatasetVersion(latestMonth, batches, existingRevisions);
  const generatedAt = releaseTimestamp();
  const latestBatch = batches.find((batch) => batch.source_batch.stat_month === latestMonth);
  const discovery = await readJson<{ checked_at?: string; historical_official_search_checked_at?: string }>(resolve("data", "discovered-official-pages.json"), {});
  const lastCheckedAt = process.env.AUTO_RELEASE_TIME_SEED
    ? generatedAt
    : discovery.historical_official_search_checked_at ?? discovery.checked_at ?? generatedAt;
  const nextCheckDueAt = configuredNextCheckAt(addOneMonth(lastCheckedAt));
  const dataStatus = deriveDataStatus({ datasetAsOf: latestMonth, latestOfficialMonth: latestMonth, latestReleaseDate: latestBatch?.source_batch.release_date ?? generatedAt.slice(0, 10), nextCheckDueAt, now: generatedAt });
  const dataFileName = `data-${datasetVersion}.json`;
  const overviewFileName = `overview-${datasetVersion}.json`;
  const marketFileName = `market-${datasetVersion}.json`;
  const breadthFileName = `breadth-${datasetVersion}.json`;
  const payload = { dataset_version: datasetVersion, records: sortedRecords };
  const overviewMonths = new Set(months.slice(-12));
  const overviewRecords = sortedRecords.filter((record) => overviewMonths.has(record.stat_month) && FEATURED_CITY_IDS.includes(record.city_id as (typeof FEATURED_CITY_IDS)[number]));
  const overviewPayload = { dataset_version: datasetVersion, records: overviewRecords };
  const marketRecords = sortedRecords.filter((record) => record.stat_month === latestMonth);
  if (marketRecords.length !== CITY_IDS.length * 2 * 4) throw new Error(`latest market snapshot must contain ${CITY_IDS.length * 2 * 4} records; got ${marketRecords.length}`);
  const marketPayload = { dataset_version: datasetVersion, records: marketRecords };
  const scopeRecords = new Map<string, StandardRecord[]>();
  for (const record of sortedRecords) {
    const key = `${record.stat_month}|${record.property_type}|${record.size_band}`;
    const scope = scopeRecords.get(key) ?? [];
    scope.push(record);
    scopeRecords.set(key, scope);
  }
  const breadthRecords: MarketBreadthPoint[] = [];
  for (const statMonth of months) {
    for (const propertyType of ["new", "resale"] as const satisfies readonly PropertyType[]) {
      for (const sizeBand of ["all", "le90", "90_144", "gt144"] as const satisfies readonly SizeBand[]) {
        const scope = scopeRecords.get(`${statMonth}|${propertyType}|${sizeBand}`) ?? [];
        for (const metric of ["mom", "yoy"] as const satisfies readonly Metric[]) {
          const counts = scope.reduce((result, record) => {
            const value = metric === "mom" ? record.mom_change : record.yoy_change;
            if (value === null || !Number.isFinite(value)) result.missing += 1;
            else if (value > 0) result.up += 1;
            else if (value < 0) result.down += 1;
            else result.flat += 1;
            return result;
          }, { up: 0, flat: 0, down: 0, missing: 0 });
          if (counts.up + counts.flat + counts.down + counts.missing !== CITY_IDS.length) throw new Error(`breadth scope must contain 70 cities: ${statMonth}/${propertyType}/${sizeBand}/${metric}`);
          breadthRecords.push({ stat_month: statMonth, property_type: propertyType, size_band: sizeBand, metric, ...counts });
        }
      }
    }
  }
  const breadthPayload = { dataset_version: datasetVersion, records: breadthRecords };
  const cityPayloads = Object.fromEntries(CITY_IDS.map((city) => [city, { dataset_version: datasetVersion, records: sortedRecords.filter((record) => record.city_id === city) }])) as Record<CityId, typeof payload>;
  const cityRecordCounts = Object.fromEntries(CITY_IDS.map((city) => [city, cityPayloads[city].records.length])) as Record<CityId, number>;
  const manifest = {
    dataset_as_of: latestMonth,
    schema_version: "1.3.0",
    dataset_version: datasetVersion,
    source_dataset_version: sourceVersion,
    data_url: `/data/${dataFileName}`,
    overview_data_url: `/data/${overviewFileName}`,
    overview_record_count: overviewRecords.length,
    market_data_url: `/data/${marketFileName}`,
    market_record_count: marketRecords.length,
    breadth_data_url: `/data/${breadthFileName}`,
    breadth_record_count: breadthRecords.length,
    city_data_url_template: `/data/cities/{city_id}-${datasetVersion}.json`,
    city_record_counts: cityRecordCounts,
    release_date: latestBatch?.source_batch.release_date ?? "",
    generated_at: generatedAt,
    record_count: sortedRecords.length,
    coverage_start: months[0],
    coverage_end: latestMonth,
    source_counts: batches.reduce<Record<string, number>>((counts, batch) => {
      const key = batch.source_batch.source_type;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    validation_status: "passed",
    parser_version: latestBatch?.source_batch.parser_version ?? "",
    data_status: dataStatus,
    status_reason: dataStatus === "current" ? "全部来源批次已核验，数据契约校验通过。" : "数据检查或更新已超过约定时限，请以官方来源为准。",
    last_checked_at: lastCheckedAt,
    latest_official_month: latestMonth,
    latest_official_url: latestBatch?.source_batch.source_url ?? "",
    next_check_due_at: nextCheckDueAt,
    coverage_gaps: [],
  };

  const oldPayload = await readJson<{ records?: StandardRecord[] }>(resolve(PREVIOUS_OUTPUT_DIR, "data.json"), {});
  const oldByKey = new Map((oldPayload.records ?? []).map((record) => [recordKey(record), record]));
  const newRevisions: RevisionRecord[] = [];
  for (const record of sortedRecords) {
    const key = recordKey(record);
    const previous = oldByKey.get(key);
    if (!previous) continue;
    if (!hasRevisableRecordChange(previous, record)) continue;
    const prior = [...existingRevisions, ...newRevisions].filter((revision) => revision.record_key === key).at(-1);
    const revisionId = createHash("sha256").update(`${key}|${JSON.stringify(previous)}|${JSON.stringify(record)}|${generatedAt}`).digest("hex");
    newRevisions.push({ revision_id: revisionId, release_type: "historical_correction", reason_type: "official_revision", record_key: key, previous_value: previous, revised_value: record, detected_at: generatedAt, source_batch_id: record.source_batch_id, reason: "official-source-record-changed-during-publish", supersedes_revision_id: prior?.revision_id ?? null });
  }
  manifest.source_dataset_version = sourceDatasetVersion(latestMonth, batches, [...existingRevisions, ...newRevisions]);

  await rm(TEMP_DIR, { recursive: true, force: true });
  await mkdir(TEMP_DIR, { recursive: true });
  await mkdir(resolve(TEMP_DIR, "cities"), { recursive: true });
  await writeFile(resolve(TEMP_DIR, "data.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
  await writeFile(resolve(TEMP_DIR, dataFileName), JSON.stringify(payload, null, 2) + "\n", "utf8");
  await writeFile(resolve(TEMP_DIR, overviewFileName), JSON.stringify(overviewPayload, null, 2) + "\n", "utf8");
  await writeFile(resolve(TEMP_DIR, marketFileName), JSON.stringify(marketPayload, null, 2) + "\n", "utf8");
  await writeFile(resolve(TEMP_DIR, breadthFileName), JSON.stringify(breadthPayload, null, 2) + "\n", "utf8");
  await Promise.all(CITY_IDS.map((city) => writeFile(resolve(TEMP_DIR, "cities", `${city}-${datasetVersion}.json`), JSON.stringify(cityPayloads[city], null, 2) + "\n", "utf8")));
  await writeFile(resolve(TEMP_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const stagedPayload = JSON.parse(await readFile(resolve(TEMP_DIR, "data.json"), "utf8")) as typeof payload;
  const stagedManifest = JSON.parse(await readFile(resolve(TEMP_DIR, "manifest.json"), "utf8")) as typeof manifest;
  const stagedOverview = JSON.parse(await readFile(resolve(TEMP_DIR, overviewFileName), "utf8")) as typeof overviewPayload;
  const stagedMarket = JSON.parse(await readFile(resolve(TEMP_DIR, marketFileName), "utf8")) as typeof marketPayload;
  const stagedBreadth = JSON.parse(await readFile(resolve(TEMP_DIR, breadthFileName), "utf8")) as typeof breadthPayload;
  if (stagedPayload.dataset_version !== stagedManifest.dataset_version || stagedPayload.records.length !== stagedManifest.record_count || stagedOverview.records.length !== stagedManifest.overview_record_count || stagedMarket.records.length !== stagedManifest.market_record_count || stagedBreadth.records.length !== stagedManifest.breadth_record_count) throw new Error("staged publish validation failed");
  for (const city of CITY_IDS) {
    const stagedCity = JSON.parse(await readFile(resolve(TEMP_DIR, "cities", `${city}-${datasetVersion}.json`), "utf8")) as typeof payload;
    if (stagedCity.dataset_version !== datasetVersion || stagedCity.records.length !== stagedManifest.city_record_counts[city] || stagedCity.records.some((record) => record.city_id !== city)) throw new Error(`staged city publish validation failed: ${city}`);
  }

  await atomicReplaceDirectory({
    outputDir: OUTPUT_DIR,
    stagedDir: TEMP_DIR,
    backupDir: BACKUP_DIR,
    validate: async () => {
    const publishedPayload = JSON.parse(await readFile(resolve(OUTPUT_DIR, "data.json"), "utf8")) as typeof payload;
    const versionedPayload = JSON.parse(await readFile(resolve(OUTPUT_DIR, dataFileName), "utf8")) as typeof payload;
    const publishedOverview = JSON.parse(await readFile(resolve(OUTPUT_DIR, overviewFileName), "utf8")) as typeof overviewPayload;
    const publishedMarket = JSON.parse(await readFile(resolve(OUTPUT_DIR, marketFileName), "utf8")) as typeof marketPayload;
    const publishedBreadth = JSON.parse(await readFile(resolve(OUTPUT_DIR, breadthFileName), "utf8")) as typeof breadthPayload;
    const publishedManifest = JSON.parse(await readFile(resolve(OUTPUT_DIR, "manifest.json"), "utf8")) as typeof manifest;
    if (publishedPayload.dataset_version !== publishedManifest.dataset_version || versionedPayload.dataset_version !== publishedManifest.dataset_version || publishedPayload.records.length !== publishedManifest.record_count || publishedOverview.records.length !== publishedManifest.overview_record_count || publishedMarket.records.length !== publishedManifest.market_record_count || publishedBreadth.records.length !== publishedManifest.breadth_record_count) throw new Error("post-publish validation failed");
    for (const city of CITY_IDS) {
      const publishedCity = JSON.parse(await readFile(resolve(OUTPUT_DIR, "cities", `${city}-${datasetVersion}.json`), "utf8")) as typeof payload;
      if (publishedCity.records.length !== publishedManifest.city_record_counts[city] || publishedCity.records.some((record) => record.city_id !== city)) throw new Error(`post-publish city validation failed: ${city}`);
    }
    },
  });

  await mkdir(NORMALIZED_DIR, { recursive: true });
  await writeJsonAtomically(resolve(NORMALIZED_DIR, "records.json"), { dataset_version: datasetVersion, records: sortedRecords });
  await writeJsonAtomically(resolve(NORMALIZED_DIR, "revisions.json"), [...existingRevisions, ...newRevisions]);
  console.log(`Published ${sortedRecords.length} records as ${datasetVersion}; appended ${newRevisions.length} revision(s)`);
}
