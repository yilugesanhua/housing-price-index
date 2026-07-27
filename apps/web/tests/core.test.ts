import { describe, expect, it } from "vitest";
import { CITY_IDS, CITY_NAMES, CITY_PROFILES, formatChange, formatChangeMagnitude, formatCompactStatMonth, formatIndex, formatReleaseDate, formatStatMonth, getCumulativeIndexSeries, getMarketPosition, getPeakDrawdownSeries, getWindowRecords, type CityId, type PriceRecord } from "@housing/core";

function record(month: number, city: "beijing" | "shanghai"): PriceRecord {
  const statMonth = `${2020 + Math.floor((month - 1) / 12)}-${String(((month - 1) % 12) + 1).padStart(2, "0")}`;
  return {
    stat_month: statMonth,
    release_date: "2026-01-01",
    city_id: city,
    city_name: city === "beijing" ? "北京" : "上海",
    property_type: "new",
    size_band: "all",
    mom_index: 100,
    yoy_index: 100,
    mom_change: 0,
    yoy_change: 0,
    mom_missing_reason: null,
    yoy_missing_reason: null,
    source_url: "https://www.stats.gov.cn/sj/zxfb/example.html",
    source_batch_id: "fixture",
    source_record_locator: "fixture",
    fetched_at: "2026-01-01T00:00:00.000Z",
    methodology_version: "fixture",
    parser_version: "fixture",
  };
}

describe("record windows", () => {
  it("counts unique statistical months rather than record rows", () => {
    const records = Array.from({ length: 72 }, (_, index) => [record(index + 1, "beijing"), record(index + 1, "shanghai")]).flat();
    const window = getWindowRecords(records, 36);
    expect(new Set(window.map((item) => item.stat_month)).size).toBe(36);
    expect(window).toHaveLength(72);
    expect(window[0].stat_month).toBe("2023-01");
    expect(window.at(-1)?.stat_month).toBe("2025-12");
  });

  it("formats public numbers and dates through locale formatters", () => {
    expect(formatChange(0.3)).toBe("+0.3%");
    expect(formatChange(0)).toBe("0.0%");
    expect(formatChangeMagnitude(-5.5)).toBe("5.5%");
    expect(formatChangeMagnitude(5.5)).toBe("5.5%");
    expect(formatIndex(100)).toBe("100.0");
    expect(formatStatMonth("2026-06")).toContain("2026");
    expect(formatCompactStatMonth("2026-06")).toContain("26");
    expect(formatReleaseDate("2026-07-15")).toContain("2026");
  });

  it("compounds monthly indices from a 100-point baseline and stops at missing data", () => {
    const records = [record(1, "beijing"), record(2, "beijing"), record(3, "beijing"), record(4, "beijing")];
    records[1].mom_index = 101;
    records[2].mom_index = 99;
    records[3].mom_index = null;
    records[3].mom_missing_reason = "not-published";
    expect(getCumulativeIndexSeries(records)).toEqual([
      { stat_month: "2020-01", value: 100 },
      { stat_month: "2020-02", value: 101 },
      { stat_month: "2020-03", value: 99.99 },
      { stat_month: "2020-04", value: null },
    ]);
  });

  it("calculates drawdown from the highest cumulative value reached by each month", () => {
    const result = getPeakDrawdownSeries([
      { stat_month: "2020-01", value: 100 },
      { stat_month: "2020-02", value: 115 },
      { stat_month: "2020-03", value: 110 },
      { stat_month: "2020-04", value: 92 },
      { stat_month: "2020-05", value: null },
    ]);

    expect(result[0].drawdown).toBe(0);
    expect(result[1].drawdown).toBe(0);
    expect(result[2].drawdown).toBeCloseTo(-4.3478, 4);
    expect(result[3].drawdown).toBeCloseTo(-20, 8);
    expect(result[4].drawdown).toBeNull();
  });

  it("calculates market breadth, tied ranks, tier average and province peers", () => {
    const marketRecord = (city: CityId, value: number): PriceRecord => ({
      ...record(1, "beijing"),
      stat_month: "2026-06",
      city_id: city,
      city_name: CITY_NAMES[city],
      mom_index: 100 + value,
      mom_change: value,
    });
    const result = getMarketPosition([
      marketRecord("beijing", 0.2),
      marketRecord("shanghai", 0.2),
      marketRecord("shenzhen", 0),
      marketRecord("guangzhou", -0.1),
      marketRecord("fuzhou", -0.1),
      marketRecord("quanzhou", -0.2),
      marketRecord("xiamen", -0.3),
    ], "new", "mom", "xiamen");

    expect(result.counts).toEqual({ up: 2, flat: 1, down: 4, missing: 0 });
    expect(result.ranked.slice(0, 2).map((item) => item.rank)).toEqual([1, 1]);
    expect(result.focus?.rank).toBe(7);
    expect(result.tier.label).toBe("二线城市");
    expect(result.tier.average).toBeCloseTo(-0.2, 8);
    expect(result.tier.focus?.rank).toBe(2);
    expect(result.province.name).toBe("福建");
    expect(result.province.ranked.map((item) => item.city_id)).toEqual(["fuzhou", "quanzhou", "xiamen"]);
  });

  it("keeps the official 4/31/35 city-tier split and a province for every city", () => {
    const counts = { first: 0, second: 0, third: 0 };
    for (const city of CITY_IDS) {
      counts[CITY_PROFILES[city].tier] += 1;
      expect(CITY_PROFILES[city].province.length).toBeGreaterThan(0);
    }
    expect(counts).toEqual({ first: 4, second: 31, third: 35 });
  });
});
