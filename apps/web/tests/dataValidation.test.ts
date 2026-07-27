import { describe, expect, it } from "vitest";
import { cityDataUrl, validateManifest, validateMarketBreadthData, validatePublishedData } from "../src/dataValidation";
import { CITY_IDS, type DataManifest, type MarketBreadthPoint, type PriceRecord } from "@housing/core";

const manifest: DataManifest = {
  dataset_as_of: "2026-06",
  schema_version: "1.2.0",
  dataset_version: "2026-06-aaaaaaaaaaaa",
  data_url: "/data/data-2026-06-aaaaaaaaaaaa.json",
  release_date: "2026-07-15",
  generated_at: "2026-07-15T00:00:00.000Z",
  record_count: 1,
  overview_data_url: "/data/overview-2026-06-aaaaaaaaaaaa.json",
  overview_record_count: 1,
  market_data_url: "/data/market-2026-06-aaaaaaaaaaaa.json",
  market_record_count: 140,
  city_data_url_template: "/data/cities/{city_id}-2026-06-aaaaaaaaaaaa.json",
  city_record_counts: Object.fromEntries(CITY_IDS.map((city) => [city, city === "beijing" ? 1 : 0])) as DataManifest["city_record_counts"],
  coverage_start: "2016-01",
  coverage_end: "2026-06",
  validation_status: "passed",
  data_status: "current",
  status_reason: "fixture",
  latest_official_month: "2026-06",
  latest_official_url: "https://www.stats.gov.cn/sj/zxfb/example.html",
  last_checked_at: "2026-07-15T00:00:00.000Z",
  next_check_due_at: "2026-08-15T00:00:00.000Z",
  coverage_gaps: [],
};

const record: PriceRecord = {
  stat_month: "2026-06",
  release_date: "2026-07-15",
  city_id: "beijing",
  city_name: "北京",
  property_type: "new",
  size_band: "all",
  mom_index: 100.1,
  yoy_index: 99.9,
  mom_change: 0.1,
  yoy_change: -0.1,
  mom_missing_reason: null,
  yoy_missing_reason: null,
  source_url: "https://www.stats.gov.cn/sj/zxfb/example.html",
  source_batch_id: "fixture",
  source_record_locator: "fixture",
  fetched_at: "2026-07-15T00:00:00.000Z",
  methodology_version: "fixture",
  parser_version: "fixture",
};

const breadthRecord: MarketBreadthPoint = { stat_month: "2026-06", property_type: "new", size_band: "le90", metric: "mom", up: 20, flat: 1, down: 49, missing: 0 };

describe("runtime published data validation", () => {
  it("accepts a matching manifest and payload", () => {
    expect(validateManifest(manifest)).toEqual(manifest);
    expect(validatePublishedData({ dataset_version: manifest.dataset_version, records: [record] }, manifest)).toEqual([record]);
    expect(cityDataUrl(manifest, "beijing")).toBe("/data/cities/beijing-2026-06-aaaaaaaaaaaa.json");
    expect(validatePublishedData({ dataset_version: manifest.dataset_version, records: [record] }, manifest, { expectedRecordCount: 1, allowedCities: ["beijing"] })).toEqual([record]);
  });

  it("rejects unsafe manifest file paths and invalid states", () => {
    expect(() => validateManifest({ ...manifest, data_url: "https://example.com/data.json" })).toThrow("数据清单文件地址无效");
    expect(() => validateManifest({ ...manifest, market_data_url: "https://example.com/market.json" })).toThrow("市场快照文件地址无效");
    expect(() => validateManifest({ ...manifest, market_record_count: 139 })).toThrow("市场快照记录数无效");
    expect(() => validateManifest({ ...manifest, city_data_url_template: "https://example.com/{city_id}.json" })).toThrow("城市数据文件地址无效");
    expect(() => validateManifest({ ...manifest, data_status: "unknown" })).toThrow("数据状态无效");
  });

  it("rejects malformed, inconsistent, and duplicate records", () => {
    expect(() => validatePublishedData({ dataset_version: manifest.dataset_version, records: [{ ...record, city_name: "错误城市" }] }, manifest)).toThrow("城市无效");
    expect(() => validatePublishedData({ dataset_version: manifest.dataset_version, records: [{ ...record, mom_change: 1.2 }] }, manifest)).toThrow("环比字段不一致");
    expect(() => validatePublishedData({ dataset_version: manifest.dataset_version, records: [record, record] }, { ...manifest, record_count: 2 })).toThrow("重复记录");
  });

  it("validates schema 1.3 breadth history", () => {
    const v13 = { ...manifest, schema_version: "1.3.0", market_record_count: 560, breadth_data_url: `/data/breadth-${manifest.dataset_version}.json`, breadth_record_count: 1 };
    expect(validateMarketBreadthData({ dataset_version: manifest.dataset_version, records: [breadthRecord] }, v13)).toEqual([breadthRecord]);
    expect(() => validateMarketBreadthData({ dataset_version: manifest.dataset_version, records: [{ ...breadthRecord, down: 48 }] }, v13)).toThrow("城市计数无效");
  });
});
