import { describe, expect, it } from "vitest";
import { addChinaBusinessDays, addOneMonth, deriveDataStatus, isChinaBusinessDay } from "./status";

describe("data status SLA", () => {
  it("honors 2026 legal holidays and adjusted working weekends", () => {
    expect(isChinaBusinessDay(new Date("2026-02-14T00:00:00.000Z"))).toBe(true);
    expect(isChinaBusinessDay(new Date("2026-02-16T00:00:00.000Z"))).toBe(false);
    expect(addChinaBusinessDays("2026-02-13", 3)).toBe("2026-02-25T15:59:59.999Z");
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
