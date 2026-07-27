import { describe, expect, it } from "vitest";
import { buildDiscoveryHandoff, evaluateLatestCheck, evaluateReleaseSchedule, extractStatMonth } from "./check-latest";
import type { ReleaseCalendar } from "./fetch-release-calendar";

const manifest = { dataset_as_of: "2026-06", next_check_due_at: "2026-08-15T00:00:00.000Z" };
const page = (month: string) => ({ title: `${month.slice(0, 4)}年${Number(month.slice(5))}月份70个大中城市住宅销售价格变动情况`, href: `https://www.stats.gov.cn/sj/zxfb/${month}.html` });
const calendar: ReleaseCalendar = {
  year: 2026,
  fetched_at: "2026-07-19T00:00:00.000Z",
  source_url: "https://www.stats.gov.cn/sj/fbrc/bnxxfb/",
  report_name: "商品住宅销售价格指数月度报告",
  raw_content_sha256: "test",
  entries: [
    { release_month: "2026-07", expected_stat_month: "2026-06", scheduled_at: "2026-07-15T09:30:00+08:00", date_text: "15/三", time_text: "9:30" },
    { release_month: "2026-08", expected_stat_month: "2026-07", scheduled_at: "2026-08-17T09:30:00+08:00", date_text: "17/一", time_text: "9:30" },
  ],
};

describe("monthly official data check", () => {
  it("extracts a valid statistical month from official titles", () => {
    expect(extractStatMonth("2026年6月份70个大中城市住宅销售价格变动情况")).toBe("2026-06");
    expect(extractStatMonth("2026年13月份70个大中城市住宅销售价格变动情况")).toBeNull();
  });

  it("reports current data before the next check deadline", () => {
    const result = evaluateLatestCheck({ checked_at: "2026-07-19T00:00:00.000Z", pages: [page("2026-06")] }, manifest, new Date("2026-07-19T00:00:00.000Z"));
    expect(result.status).toBe("current");
    expect(result.latest_official_month).toBe("2026-06");
  });

  it("alerts when a newer official month is discovered", () => {
    const result = evaluateLatestCheck({ pages: [page("2026-06"), page("2026-07")] }, manifest, new Date("2026-08-14T00:00:00.000Z"));
    expect(result.status).toBe("update_available");
    expect(result.reasons.join(" ")).toContain("2026-07");
  });

  it("treats missing pages and overdue checks as anomalies", () => {
    expect(evaluateLatestCheck({ pages: [] }, manifest).status).toBe("anomaly");
    expect(evaluateLatestCheck({ pages: [page("2026-06")] }, manifest, new Date("2026-08-16T00:00:00.000Z")).status).toBe("anomaly");
  });

  it("waits until the next preview-driven release window", () => {
    const decision = evaluateReleaseSchedule(calendar, manifest, new Date("2026-08-10T00:00:00.000Z"));
    expect(decision.release_window).toBe("waiting");
    expect(decision.should_check_official).toBe(false);
    expect(decision.expected_stat_month).toBe("2026-07");
  });

  it("checks around the scheduled time and alerts after a six-hour delay", () => {
    const active = evaluateReleaseSchedule(calendar, manifest, new Date("2026-08-17T01:15:00.000Z"));
    expect(active.release_window).toBe("active");
    expect(active.should_check_official).toBe(true);

    const overdue = evaluateReleaseSchedule(calendar, manifest, new Date("2026-08-17T08:00:00.000Z"));
    const result = evaluateLatestCheck({ pages: [page("2026-06")] }, manifest, new Date("2026-08-17T08:00:00.000Z"), overdue);
    expect(overdue.release_window).toBe("overdue");
    expect(result.status).toBe("anomaly");
    expect(result.official_release_detected).toBe(false);
  });

  it("marks the scheduled release as detected when the formal page appears", () => {
    const decision = evaluateReleaseSchedule(calendar, manifest, new Date("2026-08-17T02:00:00.000Z"));
    const result = evaluateLatestCheck({ pages: [page("2026-07")] }, manifest, new Date("2026-08-17T02:00:00.000Z"), decision);
    expect(result.status).toBe("update_available");
    expect(result.official_release_detected).toBe(true);
  });

  it("builds a commit-bound machine handoff only for the exact scheduled month", () => {
    const decision = evaluateReleaseSchedule(calendar, manifest, new Date("2026-08-17T02:00:00.000Z"));
    const result = evaluateLatestCheck({ checked_at: "2026-08-17T02:00:00.000Z", pages: [page("2026-07")] }, manifest, new Date("2026-08-17T02:00:00.000Z"), decision);
    const reportText = `${JSON.stringify(result, null, 2)}\n`;
    const handoff = buildDiscoveryHandoff(result, calendar, reportText, { GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "123" });
    expect(handoff.expected_stat_month).toBe("2026-07");
    expect(handoff.repository_commit_sha).toBe("a".repeat(40));
    expect(handoff.discovery_run_id).toBe("123");
    expect(handoff.idempotency_key).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects handoffs for non-official URLs or undetected releases", () => {
    const decision = evaluateReleaseSchedule(calendar, manifest, new Date("2026-08-17T02:00:00.000Z"));
    const current = evaluateLatestCheck({ pages: [page("2026-06")] }, manifest, new Date("2026-08-17T02:00:00.000Z"), decision);
    expect(() => buildDiscoveryHandoff(current, calendar, "{}\n")).toThrow(/发现正式页面/);
    const update = evaluateLatestCheck({ pages: [{ title: "2026年7月份70个大中城市住宅销售价格变动情况", href: "https://evil.example/release.html" }] }, manifest, new Date("2026-08-17T02:00:00.000Z"), decision);
    expect(() => buildDiscoveryHandoff(update, calendar, "{}\n")).toThrow(/白名单/);
  });
});
