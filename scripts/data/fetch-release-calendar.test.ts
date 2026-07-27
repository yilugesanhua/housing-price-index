import { describe, expect, it } from "vitest";
import { mergeReleaseCalendars, parseMonthGridCalendar, parseReleaseCalendarHtml } from "./fetch-release-calendar";

const dates = ["19/一", "13/五", "16/一", "16/四", "18/一", "16/二", "15/三", "17/一", "15/二", "19/一", "16/一", "15/二"];
const fixture = (title = "商品住宅销售价格指数月度报告", times = Array(12).fill("9:30")) => `
  <html><body>
    <p>2026年国家统计局主要统计信息发布日程表</p>
    <table>
      <tr><td>序号</td><td>内容</td>${dates.map((_, index) => `<td>${index + 1}月</td>`).join("")}</tr>
      <tr><td rowspan="2">14</td><td rowspan="2">${title}</td>${dates.map((date) => `<td>${date}</td>`).join("")}</tr>
      <tr>${times.map((time) => `<td>${time}</td>`).join("")}</tr>
    </table>
  </body></html>`;
const gridFixture = (
  title = "商品住宅销售价格指数月度报告",
  overrides: Record<number, number> = {},
) => JSON.stringify([
  ...dates.map((date, index) => {
    const month = index + 1;
    const day = overrides[month] ?? Number(date.split("/")[0]);
    return {
      SUB_TITLE: `2026${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`,
      TITLE: title,
      URL: "./placeholder-from-an-older-calendar.html",
    };
  }),
  { SUB_TITLE: "20260715", TITLE: "国民经济运行情况", URL: "./unrelated.html" },
]);

describe("official release calendar", () => {
  it("extracts all 12 scheduled releases and maps them to statistical months", () => {
    const result = parseReleaseCalendarHtml(fixture(), "2026-07-19T00:00:00.000Z");
    expect(result.year).toBe(2026);
    expect(result.entries).toHaveLength(12);
    expect(result.entries[0]).toMatchObject({ expected_stat_month: "2025-12", scheduled_at: "2026-01-19T09:30:00+08:00" });
    expect(result.entries[6]).toMatchObject({ expected_stat_month: "2026-06", scheduled_at: "2026-07-15T09:30:00+08:00" });
  });

  it.each([
    "70个大中城市商品住宅销售价格变动情况",
    "70城商品住宅销售价格变化月度报告",
    "大中城市住宅销售价格指数月报",
  ])("accepts a unique high-confidence report-name variant: %s", (title) => {
    const result = parseReleaseCalendarHtml(fixture(title));
    expect(result.report_name).toBe(title);
    expect(result.entries).toHaveLength(12);
  });

  it("fails loudly when the target row or time structure changes", () => {
    expect(() => parseReleaseCalendarHtml(fixture("其他月度报告"))).toThrow("未找到");
    expect(() => parseReleaseCalendarHtml(fixture(undefined, Array(11).fill("9:30")))).toThrow("结构异常");
  });

  it("rejects ambiguous high-confidence report rows instead of guessing", () => {
    const duplicateRows = `
      <tr><td rowspan="2">15</td><td rowspan="2">70个大中城市商品住宅销售价格变动情况</td>${dates.map((date) => `<td>${date}</td>`).join("")}</tr>
      <tr>${Array(12).fill("9:30").map((time) => `<td>${time}</td>`).join("")}</tr>`;
    const html = fixture().replace("</table>", `${duplicateRows}</table>`);
    expect(() => parseReleaseCalendarHtml(html)).toThrow("多个同等匹配报告");
  });

  it("rejects invalid calendar dates instead of guessing", () => {
    const invalidDates = [...dates];
    invalidDates[1] = "30/五";
    const html = fixture().replace(dates.join("</td><td>"), invalidDates.join("</td><td>"));
    expect(() => parseReleaseCalendarHtml(html)).toThrow("日期无效");
  });

  it("parses the official month-grid feed and ignores its placeholder URLs", () => {
    const withOfficialTrailingComma = gridFixture().replace(/]$/, ",]");
    const staleRecords = JSON.stringify([
      { SUB_TITLE: "20240117", TITLE: "商品住宅销售价格指数月度报告", URL: "./stale.html" },
    ]).slice(1, -1);
    const result = parseMonthGridCalendar(withOfficialTrailingComma.replace(/,]$/, `,${staleRecords},]`));
    expect(result.year).toBe(2026);
    expect(result.source_url).toContain("index_fbrc.html");
    expect(result.entries).toHaveLength(12);
    expect(result.entries[6]).toMatchObject({
      release_month: "2026-07",
      expected_stat_month: "2026-06",
      scheduled_at: "2026-07-15T09:30:00+08:00",
    });
    expect(JSON.stringify(result)).not.toContain("placeholder-from-an-older-calendar.html");
  });

  it("accepts a high-confidence name variant in the month-grid feed", () => {
    expect(parseMonthGridCalendar(gridFixture("70个大中城市商品住宅销售价格变动情况")).entries).toHaveLength(12);
  });

  it("rejects missing, duplicate, and invalid month-grid entries", () => {
    const missing = JSON.parse(gridFixture()).filter((entry: { SUB_TITLE: string }) => !entry.SUB_TITLE.startsWith("202608"));
    expect(() => parseMonthGridCalendar(JSON.stringify(missing))).toThrow("缺少2026年8月");

    const duplicate = JSON.parse(gridFixture());
    duplicate.push({ SUB_TITLE: "20260715", TITLE: "70个大中城市商品住宅销售价格变动情况", URL: "./other.html" });
    expect(() => parseMonthGridCalendar(JSON.stringify(duplicate))).toThrow("多个同等匹配报告");

    const invalid = JSON.parse(gridFixture());
    invalid[1].SUB_TITLE = "20260230";
    expect(() => parseMonthGridCalendar(JSON.stringify(invalid))).toThrow("无效日期");
  });

  it("cross-checks month-grid dates with annual schedule times", () => {
    const annual = parseReleaseCalendarHtml(fixture());
    const merged = mergeReleaseCalendars(parseMonthGridCalendar(gridFixture()), annual);
    expect(merged.source_urls).toHaveLength(2);
    expect(merged.entries[6].time_text).toBe("9:30");
    expect(() => mergeReleaseCalendars(parseMonthGridCalendar(gridFixture(undefined, { 7: 16 })), annual)).toThrow("日期不一致");
  });
});
