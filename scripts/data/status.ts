export type DataStatus = "current" | "updating" | "stale";

export type ChinaCalendarCoverageStatus = "covered" | "waiting_for_official_calendar";

export interface ChinaHolidayCalendar {
  year: number;
  source_url: string | null;
  official_published_at: string | null;
  config_version: string | null;
  coverage_status: ChinaCalendarCoverageStatus;
  holidays: readonly string[];
  working_weekends: readonly string[];
}

// 2026: 国办发明电〔2025〕7号
// https://www.gov.cn/zhengce/content/202511/content_7047090.htm
const HOLIDAYS_2026 = [
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
 ] as const;

const WORKING_WEEKENDS_2026 = ["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"] as const;

const CALENDAR_CONFIGS: Readonly<Record<number, ChinaHolidayCalendar>> = Object.freeze({
  2026: Object.freeze({
    year: 2026,
    source_url: "https://www.gov.cn/zhengce/content/202511/content_7047090.htm",
    official_published_at: "2025-11-04T17:00:00+08:00",
    config_version: "china-state-council-holidays-2026-v1",
    coverage_status: "covered",
    holidays: HOLIDAYS_2026,
    working_weekends: WORKING_WEEKENDS_2026,
  }),
});

function waitingCalendar(year: number): ChinaHolidayCalendar {
  return {
    year,
    source_url: null,
    official_published_at: null,
    config_version: null,
    coverage_status: "waiting_for_official_calendar",
    holidays: [],
    working_weekends: [],
  };
}

export function getChinaHolidayCalendar(year: number): ChinaHolidayCalendar {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return waitingCalendar(year);
  return CALENDAR_CONFIGS[year] ?? waitingCalendar(year);
}

export function getChinaCalendarCoverageStatus(year: number): ChinaCalendarCoverageStatus {
  return getChinaHolidayCalendar(year).coverage_status;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isChinaBusinessDayKnown(date: Date): boolean | null {
  const key = dateKey(date);
  const calendar = getChinaHolidayCalendar(date.getUTCFullYear());
  if (calendar.coverage_status !== "covered") return null;
  if (calendar.working_weekends.includes(key)) return true;
  if (calendar.holidays.includes(key)) return false;
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function isChinaBusinessDay(date: Date): boolean {
  const result = isChinaBusinessDayKnown(date);
  if (result === null) throw new Error(`缺少${date.getUTCFullYear()}年官方法定工作日配置：waiting_for_official_calendar`);
  return result;
}

export function addChinaBusinessDays(dateValue: string, count: number): string | null {
  const date = new Date(`${dateValue.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || !Number.isSafeInteger(count) || count < 0) throw new Error("工作日计算参数无效");
  let added = 0;
  while (added < count) {
    date.setUTCDate(date.getUTCDate() + 1);
    const businessDay = isChinaBusinessDayKnown(date);
    if (businessDay === null) return null;
    if (businessDay) added += 1;
  }
  return `${dateKey(date)}T15:59:59.999Z`;
}

export function addOneMonth(timestamp: string): string {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

export function deriveDataStatus(input: { datasetAsOf: string; latestOfficialMonth: string; latestReleaseDate: string; nextCheckDueAt: string; now: string }): DataStatus {
  if (input.datasetAsOf === input.latestOfficialMonth) return input.now <= input.nextCheckDueAt ? "current" : "stale";
  if (input.datasetAsOf > input.latestOfficialMonth) return "stale";
  const updateDeadline = addChinaBusinessDays(input.latestReleaseDate, 3);
  if (updateDeadline === null) return "updating";
  return input.now <= updateDeadline ? "updating" : "stale";
}
