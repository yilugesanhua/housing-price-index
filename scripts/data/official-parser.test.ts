import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectOfficialMetadata, parseOfficialHtml } from "./official-parser";
import type { SourceBatch } from "./types";

const sourceBatch: SourceBatch = {
  source_batch_id: "official-html-2026-06-fixture",
  source_type: "official-html",
  source_url: "https://www.stats.gov.cn/sj/zxfb/202607/t20260715_1964115.html",
  fetched_at: "2026-07-15T00:00:00.000Z",
  raw_content_sha256: "fixture",
  raw_archive_uri: "data/raw/2026-06/fixture.html",
  parser_version: "official-html-v1",
  schema_version: "1.0.0",
  verification_status: "verified",
  verification_method: "golden-fixture",
  http_status: 200,
  final_url: "https://www.stats.gov.cn/sj/zxfb/202607/t20260715_1964115.html",
  redirect_chain: [],
  stat_month: "2026-06",
  release_date: "2026-07-15",
};

describe("official HTML parser", () => {
  it("解析新房和二手房三个官方面积分档", async () => {
    const html = await readFile(resolve("tests", "fixtures", "official-size-bands-min.html"), "utf8");
    const parsed = parseOfficialHtml(html, sourceBatch);
    expect(parsed.records).toHaveLength(6);
    expect(parsed.records.map((record) => record.size_band).sort()).toEqual(["90_144", "90_144", "gt144", "gt144", "le90", "le90"]);
    expect(parsed.records.find((record) => record.property_type === "new" && record.size_band === "le90")).toMatchObject({
      mom_index: 99.4,
      yoy_index: 96.7,
      ytd_avg_index: 96.7,
      source_record_locator: expect.stringContaining("band[le90]"),
    });
    expect(parsed.records.find((record) => record.property_type === "resale" && record.size_band === "gt144")).toMatchObject({
      mom_index: 100.5,
      yoy_index: 96.3,
      ytd_avg_index: 94.2,
    });
  });

  it("同时解析总体表、面积分类表和左右两栏城市", async () => {
    const html = await readFile(resolve("tests", "fixtures", "official-2026-06-min.html"), "utf8");
    const parsed = parseOfficialHtml(html, sourceBatch);
    expect(parsed.records).toHaveLength(21);
    expect(parsed.records.filter((record) => record.property_type === "new")).toHaveLength(15);
    expect(parsed.records.filter((record) => record.property_type === "resale")).toHaveLength(6);
    expect(parsed.records.find((record) => record.city_id === "beijing" && record.property_type === "new")).toMatchObject({ mom_index: 99.7, mom_change: -0.3, source_record_locator: expect.stringContaining("table[0]") });
    expect(parsed.records.find((record) => record.city_id === "beijing" && record.property_type === "resale")).toMatchObject({ mom_index: 100.1, yoy_index: 94.5, ytd_avg_index: 92.5, source_record_locator: expect.stringContaining("table[1]") });
    expect(parsed.records.find((record) => record.city_id === "shenzhen" && record.property_type === "resale")).toMatchObject({ yoy_index: 95.3, yoy_change: -4.7 });
    expect(parsed.records.find((record) => record.city_id === "beijing" && record.property_type === "new" && record.size_band === "le90")).toMatchObject({ mom_index: 98.1, yoy_index: 88.1, ytd_avg_index: null });
  });

  it("解析旧版内嵌表名、正文发布日期和定基列", async () => {
    const html = await readFile(resolve("tests", "fixtures", "official-2016-01-min.html"), "utf8");
    const oldBatch = { ...sourceBatch, stat_month: "2016-01", release_date: "2016-02-26", source_batch_id: "official-html-2016-01-fixture" };
    const parsed = parseOfficialHtml(html, oldBatch);
    expect(parsed.records).toHaveLength(12);
    expect(parsed.records.every((record) => record.ytd_avg_index === null && record.ytd_missing_reason === "not-published-for-this-table")).toBe(true);
    expect(parsed.records.find((record) => record.city_id === "shenzhen" && record.property_type === "new")).toMatchObject({ mom_index: 104.1, yoy_index: 152.7, release_date: "2016-02-26", methodology_version: "nbs-house-price-index-2015-base" });
  });

  it("从旧信息公开页正文标题识别月份，并从 URL 识别发布日期", () => {
    const html = "<title>国家统计局信息公开</title><div class='xxgkNbXq2'><h2>2019年9月份70个大中城市商品住宅销售价格变动情况</h2></div>";
    expect(detectOfficialMetadata(html, "https://www.stats.gov.cn/xxgk/sjfb/zxfb2020/201910/t20191021_1768131.html")).toEqual({
      statMonth: "2019-09",
      releaseDate: "2019-10-21",
    });
  });

  it("解析旧信息公开页、去重桌面移动表格并保留缺失原因", async () => {
    const html = await readFile(resolve("tests", "fixtures", "official-2019-09-info-min.html"), "utf8");
    const infoBatch = {
      ...sourceBatch,
      source_url: "https://www.stats.gov.cn/xxgk/sjfb/zxfb2020/201910/t20191021_1768131.html",
      final_url: "https://www.stats.gov.cn/xxgk/sjfb/zxfb2020/201910/t20191021_1768131.html",
      stat_month: "2019-09",
      release_date: "2019-10-21",
      source_batch_id: "official-html-2019-09-fixture",
    };
    const parsed = parseOfficialHtml(html, infoBatch);
    expect(parsed.records).toHaveLength(12);
    expect(parsed.records.find((record) => record.city_id === "guangzhou" && record.property_type === "new")).toMatchObject({
      mom_index: null,
      mom_missing_reason: "official-empty-or-dash",
      yoy_index: 96.6,
    });
    expect(parsed.records.find((record) => record.city_id === "shenzhen" && record.property_type === "resale")).toMatchObject({ mom_index: 101.3, yoy_index: 103 });
    expect(parsed.records.every((record) => record.ytd_missing_reason === "not-published-for-this-table")).toBe(true);
  });
  it.each([
    { productFirst: false, expectedTable: 1 },
    { productFirst: true, expectedTable: 0 },
  ])("uses only the new commodity housing table regardless of table order ($productFirst)", ({ productFirst, expectedTable }) => {
    const plainHousing = `
      <table>
        <tr><th>表2：2017年1月70个大中城市新建住宅价格指数</th></tr>
        <tr><th>城市</th><th>环比</th><th>同比</th></tr>
        <tr><td>北京</td><td>88.8</td><td>77.7</td><td>上海</td><td>66.6</td><td>55.5</td></tr>
      </table>`;
    const productHousing = `
      <table>
        <tr><th>表3：2017年1月70个大中城市新建商品住宅价格指数</th></tr>
        <tr><th>城市</th><th>环比</th><th>同比</th></tr>
        <tr><td>北京</td><td>100.0</td><td>127.0</td><td>上海</td><td>100.1</td><td>128.0</td></tr>
      </table>`;
    const tables = productFirst ? `${productHousing}${plainHousing}` : `${plainHousing}${productHousing}`;
    const html = `<html><head><meta name="ArticleTitle" content="2017年1月份70个大中城市商品住宅销售价格变动情况"></head><body>${tables}</body></html>`;
    const parsed = parseOfficialHtml(html, {
      ...sourceBatch,
      source_batch_id: "official-html-2017-01-table-selection",
      stat_month: "2017-01",
      release_date: "2017-02-22",
    });

    expect(parsed.records).toHaveLength(2);
    expect(parsed.records.find((record) => record.city_id === "beijing")).toMatchObject({
      city_id: "beijing",
      property_type: "new",
      size_band: "all",
      mom_index: 100,
      yoy_index: 127,
      source_record_locator: expect.stringContaining(`table[${expectedTable}]`),
    });
  });

  it("rejects conflicting duplicate records from otherwise allowed tables", () => {
    const table = (mom: string) => `
      <table>
        <tr><th>2017年1月70个大中城市新建商品住宅价格指数</th></tr>
        <tr><th>城市</th><th>环比</th><th>同比</th></tr>
        <tr><td>北京</td><td>${mom}</td><td>127.0</td><td>上海</td><td>100.1</td><td>128.0</td></tr>
      </table>`;
    const html = `<html><head><meta name="ArticleTitle" content="2017年1月份70个大中城市商品住宅销售价格变动情况"></head><body>${table("100.0")}${table("99.9")}</body></html>`;

    expect(() => parseOfficialHtml(html, {
      ...sourceBatch,
      source_batch_id: "official-html-2017-01-conflicting-duplicate",
      stat_month: "2017-01",
      release_date: "2017-02-22",
    })).toThrow(/Conflicting duplicate official record 2017-01\|beijing\|new\|all/);
  });
});
