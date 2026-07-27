import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "apps/web/public/data");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const data = JSON.parse(await readFile(resolve(root, "data.json"), "utf8"));

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
const versionedData = JSON.parse(await readFile(resolve(root, manifest.data_url.split("/").at(-1)), "utf8"));
if (versionedData.dataset_version !== manifest.dataset_version || versionedData.records.length !== data.records.length) throw new Error("Versioned data file does not match manifest");
if (manifest.record_count !== data.records.length) throw new Error("record_count does not match data.json");
const overviewData = JSON.parse(await readFile(resolve(root, manifest.overview_data_url.split("/").at(-1)), "utf8"));
if (overviewData.dataset_version !== manifest.dataset_version || overviewData.records.length !== manifest.overview_record_count) throw new Error("Overview data does not match manifest");
const marketData = JSON.parse(await readFile(resolve(root, manifest.market_data_url.split("/").at(-1)), "utf8"));
if (marketData.dataset_version !== manifest.dataset_version || marketData.records.length !== manifest.market_record_count || marketData.records.length !== 560) throw new Error("Market data does not match manifest");
const breadthData = JSON.parse(await readFile(resolve(root, manifest.breadth_data_url.split("/").at(-1)), "utf8"));
if (breadthData.dataset_version !== manifest.dataset_version || breadthData.records.length !== manifest.breadth_record_count) throw new Error("Breadth data does not match manifest");
const fullKeys = new Set(data.records.map((record) => [record.stat_month, record.city_id, record.property_type, record.size_band].join("|")));
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
  const key = [record.stat_month, record.city_id, record.property_type, record.size_band].join("|");
  if (keys.has(key)) throw new Error(`Duplicate unique key ${key}`);
  keys.add(key);
  for (const field of ["mom_index", "yoy_index", "mom_change", "yoy_change"]) {
    if (record[field] !== null && !Number.isFinite(record[field])) throw new Error(`Invalid ${field}`);
  }
  if (record.mom_index !== null && record.mom_change !== null && Math.round((record.mom_index - 100) * 10) / 10 !== record.mom_change) {
    throw new Error(`mom_change mismatch for ${record.stat_month}/${record.city_id}`);
  }
  if (record.yoy_index !== null && record.yoy_change !== null && Math.round((record.yoy_index - 100) * 10) / 10 !== record.yoy_change) {
    throw new Error(`yoy_change mismatch for ${record.stat_month}/${record.city_id}`);
  }
  for (const [valueField, reasonField] of [["mom_index", "mom_missing_reason"], ["yoy_index", "yoy_missing_reason"], ["ytd_avg_index", "ytd_missing_reason"]]) {
    if (record[valueField] === null && !record[reasonField]) throw new Error(`Missing ${reasonField} for ${record.stat_month}/${record.city_id}`);
    if (record[valueField] !== null && record[reasonField] !== null) throw new Error(`Unexpected ${reasonField} for ${record.stat_month}/${record.city_id}`);
  }
}
console.log(`Validated ${data.records.length} records (${manifest.data_status})`);
