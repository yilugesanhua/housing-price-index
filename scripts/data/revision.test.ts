import { describe, expect, it } from "vitest";
import type { StandardRecord } from "./types";
import { hasRevisableRecordChange } from "./revision";

const record = {
  stat_month: "2017-01",
  release_date: "2017-02-22",
  city_id: "beijing",
  city_name: "北京",
  property_type: "new",
  size_band: "all",
  mom_index: 100,
  yoy_index: 127,
  ytd_avg_index: null,
  ytd_period_start: null,
  ytd_period_end: null,
  ytd_comparison_base: null,
  mom_change: 0,
  yoy_change: 27,
  mom_missing_reason: null,
  yoy_missing_reason: null,
  ytd_missing_reason: "not-published-for-this-table",
  source_url: "https://www.stats.gov.cn/example.html",
  source_type: "official-html",
  source_batch_id: "official-html-2017-01-fixture",
  source_record_locator: "table[8] row[4] block[0] city[beijing]",
  fetched_at: "2017-02-22T00:00:00.000Z",
  methodology_version: "nbs-house-price-index-2015-base",
  parser_version: "official-html-v6-size-band-tables",
} satisfies StandardRecord;

describe("revision comparison", () => {
  it("does not record a parser-only metadata upgrade as an official data revision", () => {
    expect(hasRevisableRecordChange(record, { ...record, parser_version: "official-html-v7-product-housing-only" })).toBe(false);
  });

  it("records an official statistical value change", () => {
    expect(hasRevisableRecordChange(record, { ...record, yoy_index: 126.9, yoy_change: 26.9 })).toBe(true);
  });
});
