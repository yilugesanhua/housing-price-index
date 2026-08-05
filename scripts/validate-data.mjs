import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "apps/web/public/data");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const data = JSON.parse(await readFile(resolve(root, "data.json"), "utf8"));
const PROPERTY_TYPES = ["new", "resale"];
const SIZE_BANDS = ["all", "le90", "90_144", "gt144"];
const INDEX_FIELDS = ["mom_index", "yoy_index", "ytd_avg_index"];
const MAX_INDEX_VALUE = 1000;

function isIsoDate(value) {
  if (!/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value || "")) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function isMonth(value) {
  return /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(value || "");
}

function nextMonth(value) {
  const date = new Date(`${value}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}

function hasAtMostOneDecimal(value) {
  return Math.abs(value * 10 - Math.round(value * 10)) < Number.EPSILON * 100;
}

function recordKey(record) {
  return [record.stat_month, record.city_id, record.property_type, record.size_band].join("|");
}

if (!manifest.schema_version || !manifest.dataset_version) throw new Error("Missing dataset version metadata");
if (manifest.schema_version !== "1.3.0") throw new Error(`Unsupported schema_version ${manifest.schema_version}`);
if (manifest.validation_status !== "passed") throw new Error("Manifest validation_status must be passed");
if (manifest.data_url !== `/data/data-${manifest.dataset_version}.json`) throw new Error("Unexpected versioned data_url");
if (manifest.overview_data_url !== `/data/overview-${manifest.dataset_version}.json`) throw new Error("Unexpected overview_data_url");
if (manifest.market_data_url !== `/data/market-${manifest.dataset_version}.json`) throw new Error("Unexpected market_data_url");
if (manifest.breadth_data_url !== `/data/breadth-${manifest.dataset_version}.json`) throw new Error("Unexpected breadth_data_url");
if (manifest.city_data_url_template !== `/data/cities/{city_id}-${manifest.dataset_version}.json`) throw new Error("Unexpected city_data_url_template");
if (!Array.isArray(data.records)) throw new Error("data.json.records must be an array");
if (data.dataset_version !== manifest.dataset_version) throw new Error("dataset_version does not match data.json");
const months = [...new Set(data.records.map((record) => record.stat_month))].sort();
if (months.length === 0 || !months.every(isMonth)) throw new Error("Published months are invalid");
if (months[0] !== manifest.coverage_start || months.at(-1) !== manifest.coverage_end || manifest.coverage_end !== manifest.dataset_as_of) throw new Error("Published month coverage does not match manifest");
for (let index = 1; index < months.length; index += 1) if (months[index] !== nextMonth(months[index - 1])) throw new Error(`Published month coverage is not continuous at ${months[index]}`);
const cityIds = Object.keys(manifest.city_record_counts ?? {});
if (cityIds.length !== 70 || new Set(cityIds).size !== cityIds.length || cityIds.some((cityId) => !/^[a-z]+$/.test(cityId))) throw new Error("Manifest city set is invalid");
if (data.records.length !== months.length * cityIds.length * PROPERTY_TYPES.length * SIZE_BANDS.length) throw new Error("Published record count does not cover every month/city/series slot");
const versionedData = JSON.parse(await readFile(resolve(root, manifest.data_url.split("/").at(-1)), "utf8"));
if (versionedData.dataset_version !== manifest.dataset_version || versionedData.records.length !== data.records.length) throw new Error("Versioned data file does not match manifest");
if (manifest.record_count !== data.records.length) throw new Error("record_count does not match data.json");
const overviewData = JSON.parse(await readFile(resolve(root, manifest.overview_data_url.split("/").at(-1)), "utf8"));
if (overviewData.dataset_version !== manifest.dataset_version || overviewData.records.length !== manifest.overview_record_count) throw new Error("Overview data does not match manifest");
const marketData = JSON.parse(await readFile(resolve(root, manifest.market_data_url.split("/").at(-1)), "utf8"));
if (marketData.dataset_version !== manifest.dataset_version || marketData.records.length !== manifest.market_record_count || marketData.records.length !== 560) throw new Error("Market data does not match manifest");
const breadthData = JSON.parse(await readFile(resolve(root, manifest.breadth_data_url.split("/").at(-1)), "utf8"));
if (breadthData.dataset_version !== manifest.dataset_version || breadthData.records.length !== manifest.breadth_record_count) throw new Error("Breadth data does not match manifest");
const fullKeys = new Set(data.records.map(recordKey));
const recordsByMonth = new Map(months.map((month) => [month, []]));
for (const record of data.records) recordsByMonth.get(record.stat_month)?.push(record);
for (const month of months) {
  const monthRecords = recordsByMonth.get(month) ?? [];
  if (monthRecords.length !== cityIds.length * PROPERTY_TYPES.length * SIZE_BANDS.length) throw new Error(`Published month is incomplete: ${month}`);
  const releaseDates = new Set(monthRecords.map((record) => record.release_date));
  const sourceBatchIds = new Set(monthRecords.map((record) => record.source_batch_id));
  if (releaseDates.size !== 1 || !isIsoDate([...releaseDates][0])) throw new Error(`Published month has inconsistent release dates: ${month}`);
  if (sourceBatchIds.size !== 1 || !new RegExp(`^official-html-${month}-[a-f0-9]{12}$`).test([...sourceBatchIds][0])) throw new Error(`Published month has inconsistent source batches: ${month}`);
  for (const cityId of cityIds) for (const propertyType of PROPERTY_TYPES) for (const sizeBand of SIZE_BANDS) {
    if (!fullKeys.has([month, cityId, propertyType, sizeBand].join("|"))) throw new Error(`Missing published record: ${month}/${cityId}/${propertyType}/${sizeBand}`);
  }
}
if ([...recordsByMonth.get(manifest.dataset_as_of)].some((record) => record.release_date !== manifest.release_date)) throw new Error("Latest release date does not match manifest");
for (const record of overviewData.records) if (!fullKeys.has([record.stat_month, record.city_id, record.property_type, record.size_band].join("|"))) throw new Error("Overview record not found in full dataset");
for (const record of marketData.records) {
  if (record.stat_month !== manifest.dataset_as_of) throw new Error("Market snapshot has unexpected scope");
  if (!fullKeys.has([record.stat_month, record.city_id, record.property_type, record.size_band].join("|"))) throw new Error("Market record not found in full dataset");
}
if (new Set(marketData.records.map((record) => `${record.city_id}|${record.property_type}|${record.size_band}`)).size !== 560) throw new Error("Market snapshot must contain every city/property/size-band combination once");
const breadthKeys = new Set();
for (const record of breadthData.records) {
  const key = [record.stat_month, record.property_type, record.size_band, record.metric].join("|");
  if (breadthKeys.has(key)) throw new Error(`Duplicate breadth key ${key}`);
  breadthKeys.add(key);
  if (![record.up, record.flat, record.down, record.missing].every((count) => Number.isInteger(count) && count >= 0) || record.up + record.flat + record.down + record.missing !== 70) throw new Error(`Invalid breadth counts ${key}`);
  const source = data.records.filter((item) => item.stat_month === record.stat_month && item.property_type === record.property_type && item.size_band === record.size_band);
  const values = source.map((item) => record.metric === "mom" ? item.mom_change : item.yoy_change);
  const expected = values.reduce((counts, value) => {
    if (value === null || !Number.isFinite(value)) counts.missing += 1;
    else if (value > 0) counts.up += 1;
    else if (value < 0) counts.down += 1;
    else counts.flat += 1;
    return counts;
  }, { up: 0, flat: 0, down: 0, missing: 0 });
  if (JSON.stringify(expected) !== JSON.stringify({ up: record.up, flat: record.flat, down: record.down, missing: record.missing })) throw new Error(`Breadth counts do not match source records ${key}`);
}
let cityRecordTotal = 0;
for (const [city, expectedCount] of Object.entries(manifest.city_record_counts ?? {})) {
  const cityUrl = manifest.city_data_url_template.replace("{city_id}", city);
  const cityData = JSON.parse(await readFile(resolve(root, "cities", cityUrl.split("/").at(-1)), "utf8"));
  if (cityData.dataset_version !== manifest.dataset_version || cityData.records.length !== expectedCount || cityData.records.some((record) => record.city_id !== city)) throw new Error(`City data does not match manifest: ${city}`);
  cityRecordTotal += cityData.records.length;
}
if (cityRecordTotal !== data.records.length) throw new Error("City shard record total does not match data.json");
if (!Array.isArray(manifest.coverage_gaps)) throw new Error("coverage_gaps must be an array");
if (!manifest.last_checked_at || !manifest.next_check_due_at) throw new Error("Missing manifest check timestamps");
if (Date.parse(manifest.next_check_due_at) <= Date.parse(manifest.last_checked_at)) throw new Error("next_check_due_at must follow last_checked_at");
const keys = new Set();
for (const record of data.records) {
  for (const field of ["stat_month", "city_id", "property_type", "size_band", "source_url", "source_batch_id", "source_record_locator", "fetched_at", "parser_version"]) {
    if (!record[field]) throw new Error(`Missing ${field} in record`);
  }
  const key = recordKey(record);
  if (keys.has(key)) throw new Error(`Duplicate unique key ${key}`);
  keys.add(key);
  if (!cityIds.includes(record.city_id) || !PROPERTY_TYPES.includes(record.property_type) || !SIZE_BANDS.includes(record.size_band)) throw new Error(`Invalid published record key ${key}`);
  if (!isIsoDate(record.release_date)) throw new Error(`Invalid release_date for ${key}`);
  if (!/^https:\/\/www\.stats\.gov\.cn\/(?:sj\/zxfb|xxgk\/sjfb\/zxfb2020)\/.+\.html$/.test(record.source_url)) throw new Error(`Invalid official source URL for ${key}`);
  if (!Number.isFinite(Date.parse(record.fetched_at || ""))) throw new Error(`Invalid fetched_at for ${key}`);
  for (const field of INDEX_FIELDS) {
    const value = record[field];
    if (value !== null && (!Number.isFinite(value) || value <= 0 || value > MAX_INDEX_VALUE || !hasAtMostOneDecimal(value))) throw new Error(`Invalid ${field} for ${key}`);
  }
  for (const [indexField, changeField] of [["mom_index", "mom_change"], ["yoy_index", "yoy_change"]]) {
    const index = record[indexField];
    const change = record[changeField];
    if ((index === null) !== (change === null)) throw new Error(`${indexField}/${changeField} nullability mismatch for ${key}`);
    if (change !== null && (!Number.isFinite(change) || !hasAtMostOneDecimal(change) || change !== Math.round((index - 100) * 10) / 10)) throw new Error(`${changeField} mismatch for ${key}`);
  }
  for (const [valueField, reasonField] of [["mom_index", "mom_missing_reason"], ["yoy_index", "yoy_missing_reason"], ["ytd_avg_index", "ytd_missing_reason"]]) {
    if (record[valueField] === null && !record[reasonField]) throw new Error(`Missing ${reasonField} for ${record.stat_month}/${record.city_id}`);
    if (record[valueField] !== null && record[reasonField] !== null) throw new Error(`Unexpected ${reasonField} for ${record.stat_month}/${record.city_id}`);
  }
  if (record.mom_index === null && record.mom_missing_reason !== "official-empty-or-dash") throw new Error(`Unsupported mom_missing_reason for ${key}`);
  if (record.yoy_index === null && record.yoy_missing_reason !== "official-empty-or-dash") throw new Error(`Unsupported yoy_missing_reason for ${key}`);
  if (record.ytd_avg_index === null) {
    if (record.ytd_missing_reason !== "not-published-for-this-table" || record.ytd_period_start !== null || record.ytd_period_end !== null || record.ytd_comparison_base !== null) throw new Error(`Invalid missing YTD metadata for ${key}`);
  } else if (record.ytd_period_start !== `${record.stat_month.slice(0, 4)}-01` || record.ytd_period_end !== record.stat_month || record.ytd_comparison_base !== "上年同期=100") {
    throw new Error(`Invalid YTD period metadata for ${key}`);
  }
}
console.log(`Validated ${data.records.length} records (${manifest.data_status})`);
