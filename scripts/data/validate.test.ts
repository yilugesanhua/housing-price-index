import { describe, expect, it } from "vitest";
import { validateRecords } from "./validate";
import type { StandardRecord } from "./types";

function record(overrides: Partial<StandardRecord> = {}): StandardRecord {
  return {
    stat_month: "2026-06",
    release_date: "2026-07-15",
    city_id: "beijing",
    city_name: "北京",
    property_type: "new",
    size_band: "all",
    mom_index: 100.1,
    yoy_index: 99.9,
    ytd_avg_index: 99.8,
    ytd_period_start: "2026-01",
    ytd_period_end: "2026-06",
    ytd_comparison_base: "上年同期=100",
    mom_change: 0.1,
    yoy_change: -0.1,
    mom_missing_reason: null,
    yoy_missing_reason: null,
    ytd_missing_reason: null,
    source_url: "https://www.stats.gov.cn/sj/zxfb/example.html",
    source_type: "official-html",
    source_batch_id: "official-html-2026-06-fixture",
    source_record_locator: "table[0] row[1] block[0] city[beijing]",
    fetched_at: "2026-07-15T01:00:00.000Z",
    methodology_version: "fixture",
    parser_version: "fixture",
    ...overrides,
  };
}

function fieldErrors(overrides: Partial<StandardRecord> = {}): string[] {
  return validateRecords([record(overrides)]).filter((error) => !error.includes("expected 70 target cities"));
}

describe("standard record numeric invariants", () => {
  it("accepts one-decimal official values and matching derived fields", () => {
    expect(fieldErrors()).toEqual([]);
  });

  it("rejects out-of-range or over-precise indices", () => {
    expect(fieldErrors({ mom_index: 0, mom_change: -100 }).some((error) => error.includes("mom_index invariant failed"))).toBe(true);
    expect(fieldErrors({ yoy_index: 100.12, yoy_change: 0.1 }).some((error) => error.includes("yoy_index invariant failed"))).toBe(true);
  });

  it("requires index, change and official missing reason to agree", () => {
    expect(fieldErrors({ mom_index: null, mom_change: 0, mom_missing_reason: "official-empty-or-dash" }).some((error) => error.includes("mom_change must be null"))).toBe(true);
    expect(fieldErrors({ mom_index: null, mom_change: null, mom_missing_reason: "guessed" }).some((error) => error.includes("unsupported mom missing reason"))).toBe(true);
  });

  it("requires ytd period metadata to agree with the value", () => {
    expect(fieldErrors({ ytd_avg_index: null, ytd_missing_reason: "not-published-for-this-table" }).some((error) => error.includes("ytd companion fields must be null"))).toBe(true);
    expect(fieldErrors({ ytd_period_start: "2026-02" }).some((error) => error.includes("ytd companion fields are invalid"))).toBe(true);
    expect(fieldErrors({ ytd_comparison_base: "上月=100" }).some((error) => error.includes("ytd companion fields are invalid"))).toBe(true);
  });

  it("rejects calendar dates that only look like ISO dates", () => {
    expect(fieldErrors({ release_date: "2026-02-31" }).some((error) => error.includes("release_date is invalid"))).toBe(true);
  });
});
