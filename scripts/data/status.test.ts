import { describe, expect, it } from "vitest";
import { addChinaBusinessDays, addOneMonth, deriveDataStatus, getChinaCalendarCoverageStatus, getChinaHolidayCalendar, isChinaBusinessDay, isChinaBusinessDayKnown } from "./status";

describe("data status SLA", () => {
  it("honors 2026 legal holidays and adjusted working weekends", () => {
    expect(isChinaBusinessDay(new Date("2026-02-14T00:00:00.000Z"))).toBe(true);
    expect(isChinaBusinessDay(new Date("2026-02-16T00:00:00.000Z"))).toBe(false);
    expect(addChinaBusinessDays("2026-02-13", 3)).toBe("2026-02-25T15:59:59.999Z");
  });

  it("binds each covered year to traceable official calendar metadata", () => {
    const calendar = getChinaHolidayCalendar(2026);
    expect(calendar).toMatchObject({
      year: 2026,
      source_url: "https://www.gov.cn/zhengce/content/202511/content_7047090.htm",
      official_published_at: "2025-11-04T17:00:00+08:00",
      config_version: "china-state-council-holidays-2026-v1",
      coverage_status: "covered",
    });
    expect(getChinaCalendarCoverageStatus(2027)).toBe("waiting_for_official_calendar");
    expect(isChinaBusinessDayKnown(new Date("2027-01-04T00:00:00.000Z"))).toBeNull();
    expect(() => isChinaBusinessDay(new Date("2027-01-04T00:00:00.000Z"))).toThrow("waiting_for_official_calendar");
  });

  it("does not invent a cross-year SLA deadline before the next official calendar", () => {
    expect(addChinaBusinessDays("2026-12-30", 3)).toBeNull();
    expect(deriveDataStatus({ datasetAsOf: "2026-11", latestOfficialMonth: "2026-12", latestReleaseDate: "2026-12-30", nextCheckDueAt: "2027-01-31T00:00:00.000Z", now: "2027-01-20T00:00:00.000Z" })).toBe("updating");
  });

  it("keeps current data current until the next monthly check deadline", () => {
    expect(addOneMonth("2026-07-15T10:00:00.000Z")).toBe("2026-08-15T10:00:00.000Z");
    expect(deriveDataStatus({ datasetAsOf: "2026-06", latestOfficialMonth: "2026-06", latestReleaseDate: "2026-07-15", nextCheckDueAt: "2026-08-15T10:00:00.000Z", now: "2026-07-20T00:00:00.000Z" })).toBe("current");
    expect(deriveDataStatus({ datasetAsOf: "2026-06", latestOfficialMonth: "2026-06", latestReleaseDate: "2026-07-15", nextCheckDueAt: "2026-08-15T10:00:00.000Z", now: "2026-08-16T00:00:00.000Z" })).toBe("stale");
  });

  it("distinguishes the three-workday updating window from stale data", () => {
    expect(deriveDataStatus({ datasetAsOf: "2026-05", latestOfficialMonth: "2026-06", latestReleaseDate: "2026-07-15", nextCheckDueAt: "2026-08-15T00:00:00.000Z", now: "2026-07-17T00:00:00.000Z" })).toBe("updating");
    expect(deriveDataStatus({ datasetAsOf: "2026-05", latestOfficialMonth: "2026-06", latestReleaseDate: "2026-07-15", nextCheckDueAt: "2026-08-15T00:00:00.000Z", now: "2026-07-21T00:00:00.000Z" })).toBe("stale");
  });
});
