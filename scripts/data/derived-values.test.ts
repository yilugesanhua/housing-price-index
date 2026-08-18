import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CITY_IDS,
  CITY_PROFILES,
  getCumulativeIndexSeries,
  getMarketPosition,
  type CityId,
  type MarketBreadthPoint,
  type Metric,
  type PriceRecord,
  type PropertyType,
  type SizeBand,
} from "@housing/core";

const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(resolve(root, "apps/web/public/data/manifest.json"), "utf8"));
const records = (JSON.parse(readFileSync(resolve(root, "apps/web/public/data/data.json"), "utf8")) as { records: PriceRecord[] }).records;
const breadth = (JSON.parse(readFileSync(resolve(root, `apps/web/public/data/${manifest.breadth_data_url.split("/").at(-1)}`), "utf8")) as { records: MarketBreadthPoint[] }).records;
const propertyTypes: PropertyType[] = ["new", "resale"];
const sizeBands: SizeBand[] = ["all", "le90", "90_144", "gt144"];
const metrics: Metric[] = ["mom", "yoy"];
const historyMonthCount = new Set(records.map((record) => record.stat_month)).size;
const recordsByScope = new Map<string, PriceRecord[]>();
const recordsBySeries = new Map<string, PriceRecord[]>();
for (const record of records) {
  const scopeKey = [record.stat_month, record.property_type, record.size_band].join("|");
  recordsByScope.set(scopeKey, [...(recordsByScope.get(scopeKey) ?? []), record]);
  const seriesKey = [record.city_id, record.property_type, record.size_band].join("|");
  recordsBySeries.set(seriesKey, [...(recordsBySeries.get(seriesKey) ?? []), record]);
}

function independentRank(items: Array<{ city_id: CityId; value: number }>) {
  const sorted = [...items].sort((left, right) => right.value - left.value || left.city_id.localeCompare(right.city_id, "en"));
  const counts = new Map<number, number>();
  for (const item of sorted) counts.set(item.value, (counts.get(item.value) ?? 0) + 1);
  let previousValue: number | null = null;
  let previousRank = 0;
  return sorted.map((item, index) => {
    const rank = item.value === previousValue ? previousRank : index + 1;
    previousValue = item.value;
    previousRank = rank;
    return { ...item, rank, tied: (counts.get(item.value) ?? 0) > 1 };
  });
}

function independentCumulative(input: PriceRecord[]) {
  let value = 100;
  let broken = false;
  return [...input].sort((left, right) => left.stat_month.localeCompare(right.stat_month)).map((record, index) => {
    if (index === 0) return { stat_month: record.stat_month, value };
    if (broken || record.mom_index === null) {
      broken = true;
      return { stat_month: record.stat_month, value: null };
    }
    value *= record.mom_index / 100;
    return { stat_month: record.stat_month, value };
  });
}

describe("full-history derived values", () => {
  it("recomputes every published monthly breadth count from the 70 source values", () => {
    const byKey = new Map(breadth.map((item) => [[item.stat_month, item.property_type, item.size_band, item.metric].join("|"), item]));
    const months = [...new Set(records.map((record) => record.stat_month))].sort();
    let checked = 0;
    for (const month of months) for (const propertyType of propertyTypes) for (const sizeBand of sizeBands) for (const metric of metrics) {
      const values = (recordsByScope.get([month, propertyType, sizeBand].join("|")) ?? []).map((record) => metric === "mom" ? record.mom_change : record.yoy_change);
      const expected = values.reduce((counts, value) => {
        if (value === null) counts.missing += 1;
        else if (value > 0) counts.up += 1;
        else if (value < 0) counts.down += 1;
        else counts.flat += 1;
        return counts;
      }, { up: 0, flat: 0, down: 0, missing: 0 });
      expect(byKey.get([month, propertyType, sizeBand, metric].join("|"))).toMatchObject(expected);
      expect(expected.up + expected.flat + expected.down + expected.missing).toBe(70);
      checked += 1;
    }
    expect(checked).toBe(historyMonthCount * 2 * 4 * 2);
    expect(byKey.size).toBe(checked);
  });

  it("independently recomputes every latest-month national, tier, and province rank", () => {
    const latestMonth = manifest.dataset_as_of as string;
    const latest = records.filter((record) => record.stat_month === latestMonth);
    let checked = 0;
    for (const propertyType of propertyTypes) for (const sizeBand of sizeBands) for (const metric of metrics) {
      const values = latest
        .filter((record) => record.property_type === propertyType && record.size_band === sizeBand)
        .map((record) => ({ city_id: record.city_id, value: metric === "mom" ? record.mom_change : record.yoy_change }))
        .filter((item): item is { city_id: CityId; value: number } => item.value !== null);
      const national = independentRank(values);
      for (const focusCity of CITY_IDS) {
        const actual = getMarketPosition(latest, propertyType, metric, focusCity, sizeBand);
        const profile = CITY_PROFILES[focusCity];
        const tier = independentRank(values.filter((item) => CITY_PROFILES[item.city_id].tier === profile.tier));
        const province = independentRank(values.filter((item) => CITY_PROFILES[item.city_id].province === profile.province));
        expect(actual.ranked).toEqual(national);
        expect(actual.tier.ranked).toEqual(tier);
        expect(actual.province.ranked).toEqual(province);
        expect(actual.counts.up + actual.counts.flat + actual.counts.down + actual.counts.missing).toBe(70);
        checked += 1;
      }
    }
    expect(checked).toBe(2 * 4 * 2 * 70);
  });

  it("independently recomputes every cumulative series for all four display windows", () => {
    const windows = [36, 60, 120, 180];
    let checked = 0;
    for (const cityId of CITY_IDS) for (const propertyType of propertyTypes) for (const sizeBand of sizeBands) {
      const series = [...(recordsBySeries.get([cityId, propertyType, sizeBand].join("|")) ?? [])].sort((left, right) => left.stat_month.localeCompare(right.stat_month));
      expect(series).toHaveLength(historyMonthCount);
      for (const window of windows) {
        const input = series.slice(-window);
        const actual = getCumulativeIndexSeries(input);
        const expected = independentCumulative(input);
        expect(actual.map((point) => point.stat_month)).toEqual(expected.map((point) => point.stat_month));
        for (let index = 0; index < expected.length; index += 1) {
          if (expected[index].value === null) expect(actual[index].value).toBeNull();
          else expect(actual[index].value).toBeCloseTo(expected[index].value!, 10);
        }
        checked += 1;
      }
    }
    expect(checked).toBe(70 * 2 * 4 * 4);
  });
});
