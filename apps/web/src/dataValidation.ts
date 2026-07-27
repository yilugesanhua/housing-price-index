import { CITY_IDS, CITY_NAMES, type DataManifest, type MarketBreadthPoint, type PriceRecord, type PublishedBreadthData, type PublishedData } from "@housing/core";

const SUPPORTED_SCHEMA_VERSION = "1.3.0";
const MONTH_PATTERN = /^20\d{2}-(?:0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const DATASET_VERSION_PATTERN = /^20\d{2}-(?:0[1-9]|1[0-2])-[a-f0-9]{12}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

export function validateManifest(value: unknown): DataManifest {
  if (!isObject(value)) throw new Error("数据清单格式无效");
  const manifest = value as Partial<DataManifest>;
  if (manifest.schema_version !== SUPPORTED_SCHEMA_VERSION && manifest.schema_version !== "1.2.0") throw new Error(`数据版本不兼容（需要 ${SUPPORTED_SCHEMA_VERSION}）`);
  if (!manifest.dataset_version || !DATASET_VERSION_PATTERN.test(manifest.dataset_version) || !manifest.dataset_as_of || !MONTH_PATTERN.test(manifest.dataset_as_of)) throw new Error("数据清单缺少有效版本或统计月份");
  if (manifest.data_url !== `/data/data-${manifest.dataset_version}.json`) throw new Error("数据清单文件地址无效");
  if (manifest.overview_data_url !== `/data/overview-${manifest.dataset_version}.json`) throw new Error("六城摘要文件地址无效");
  if (manifest.market_data_url !== `/data/market-${manifest.dataset_version}.json`) throw new Error("市场快照文件地址无效");
  if (manifest.schema_version === SUPPORTED_SCHEMA_VERSION && manifest.breadth_data_url !== `/data/breadth-${manifest.dataset_version}.json`) throw new Error("温度历史文件地址无效");
  if (manifest.city_data_url_template !== `/data/cities/{city_id}-${manifest.dataset_version}.json`) throw new Error("城市数据文件地址无效");
  if (manifest.validation_status !== "passed") throw new Error("数据清单尚未通过校验");
  if (!(["current", "updating", "stale"] as const).includes(manifest.data_status as DataManifest["data_status"])) throw new Error("数据状态无效");
  if (!Number.isInteger(manifest.record_count) || (manifest.record_count ?? 0) < 0) throw new Error("数据清单记录数无效");
  if (!Number.isInteger(manifest.overview_record_count) || (manifest.overview_record_count ?? 0) < 0) throw new Error("六城摘要记录数无效");
  const validMarketCounts = manifest.schema_version === "1.2.0" ? [0, CITY_IDS.length * 2] : [0, CITY_IDS.length * 2 * 4];
  if (!validMarketCounts.includes(manifest.market_record_count ?? -1)) throw new Error("市场快照记录数无效");
  if (manifest.schema_version === SUPPORTED_SCHEMA_VERSION && (!Number.isInteger(manifest.breadth_record_count) || (manifest.breadth_record_count ?? -1) < 0)) throw new Error("温度历史记录数无效");
  if (!isObject(manifest.city_record_counts) || CITY_IDS.some((city) => !Number.isInteger(manifest.city_record_counts?.[city]) || (manifest.city_record_counts?.[city] ?? -1) < 0)) throw new Error("城市数据记录数无效");
  if (!Array.isArray(manifest.coverage_gaps) || !manifest.last_checked_at || !manifest.next_check_due_at) throw new Error("数据清单缺少检查状态");
  return manifest as DataManifest;
}

export function validateMarketBreadthData(value: unknown, manifest: DataManifest): MarketBreadthPoint[] {
  if (!isObject(value)) throw new Error("温度历史数据格式无效");
  const payload = value as Partial<PublishedBreadthData>;
  if (payload.dataset_version !== manifest.dataset_version) throw new Error("清单与温度历史版本不一致，请刷新页面");
  if (!Array.isArray(payload.records) || payload.records.length !== manifest.breadth_record_count) throw new Error("温度历史记录数与清单不一致");
  const keys = new Set<string>();
  for (const [index, unknownRecord] of payload.records.entries()) {
    if (!isObject(unknownRecord)) throw new Error(`温度历史第${index + 1}条格式无效`);
    const record = unknownRecord as Partial<MarketBreadthPoint>;
    if (!record.stat_month || !MONTH_PATTERN.test(record.stat_month)) throw new Error(`温度历史第${index + 1}条月份无效`);
    if (!record.property_type || !["new", "resale"].includes(record.property_type) || !record.size_band || !["all", "le90", "90_144", "gt144"].includes(record.size_band) || !record.metric || !["mom", "yoy"].includes(record.metric)) throw new Error(`温度历史第${index + 1}条分类无效`);
    const counts = [record.up, record.flat, record.down, record.missing];
    if (counts.some((count) => !Number.isInteger(count) || (count ?? -1) < 0) || counts.reduce<number>((sum, count) => sum + (count ?? 0), 0) !== CITY_IDS.length) throw new Error(`温度历史第${index + 1}条城市计数无效`);
    const key = `${record.stat_month}|${record.property_type}|${record.size_band}|${record.metric}`;
    if (keys.has(key)) throw new Error(`温度历史存在重复记录 ${key}`);
    keys.add(key);
  }
  return payload.records as MarketBreadthPoint[];
}

export function cityDataUrl(manifest: DataManifest, city: (typeof CITY_IDS)[number]): string {
  return manifest.city_data_url_template.replace("{city_id}", city);
}

export function validatePublishedData(value: unknown, manifest: DataManifest, options: { expectedRecordCount?: number; allowedCities?: readonly (typeof CITY_IDS)[number][] } = {}): PriceRecord[] {
  if (!isObject(value)) throw new Error("发布数据格式无效");
  const payload = value as Partial<PublishedData>;
  if (payload.dataset_version !== manifest.dataset_version) throw new Error("清单与数据版本不一致，请刷新页面");
  const expectedRecordCount = options.expectedRecordCount ?? manifest.record_count;
  if (!Array.isArray(payload.records) || payload.records.length !== expectedRecordCount) throw new Error("发布数据记录数与清单不一致");

  const keys = new Set<string>();
  for (const [index, unknownRecord] of payload.records.entries()) {
    if (!isObject(unknownRecord)) throw new Error(`发布数据第${index + 1}条格式无效`);
    const record = unknownRecord as Partial<PriceRecord>;
    if (!record.stat_month || !MONTH_PATTERN.test(record.stat_month) || !record.release_date || !DATE_PATTERN.test(record.release_date)) throw new Error(`发布数据第${index + 1}条月份或日期无效`);
    if (!record.city_id || !CITY_IDS.includes(record.city_id) || record.city_name !== CITY_NAMES[record.city_id]) throw new Error(`发布数据第${index + 1}条城市无效`);
    if (options.allowedCities && !options.allowedCities.includes(record.city_id)) throw new Error(`发布数据第${index + 1}条不属于请求城市`);
    if (!record.property_type || !["new", "resale"].includes(record.property_type) || !record.size_band || !["all", "le90", "90_144", "gt144"].includes(record.size_band)) throw new Error(`发布数据第${index + 1}条分类无效`);
    if (!isFiniteNumberOrNull(record.mom_index) || !isFiniteNumberOrNull(record.yoy_index) || !isFiniteNumberOrNull(record.mom_change) || !isFiniteNumberOrNull(record.yoy_change)) throw new Error(`发布数据第${index + 1}条指数或变动率无效`);
    if (record.mom_index === null ? !record.mom_missing_reason || record.mom_change !== null : record.mom_missing_reason !== null || record.mom_change !== Math.round((record.mom_index - 100) * 10) / 10) throw new Error(`发布数据第${index + 1}条环比字段不一致`);
    if (record.yoy_index === null ? !record.yoy_missing_reason || record.yoy_change !== null : record.yoy_missing_reason !== null || record.yoy_change !== Math.round((record.yoy_index - 100) * 10) / 10) throw new Error(`发布数据第${index + 1}条同比字段不一致`);
    for (const field of ["source_url", "source_batch_id", "source_record_locator", "fetched_at", "methodology_version", "parser_version"] as const) if (!record[field] || typeof record[field] !== "string") throw new Error(`发布数据第${index + 1}条缺少${field}`);
    const key = `${record.stat_month}|${record.city_id}|${record.property_type}|${record.size_band}`;
    if (keys.has(key)) throw new Error(`发布数据存在重复记录 ${key}`);
    keys.add(key);
  }
  return payload.records as PriceRecord[];
}
