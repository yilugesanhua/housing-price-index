export type DataStatus = "current" | "updating" | "stale";

// 国办发明电〔2025〕7号：https://www.gov.cn/zhengce/content/202511/content_7047090.htm
const HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
]);

const WORKING_WEEKENDS_2026 = new Set(["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"]);

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isChinaBusinessDay(date: Date): boolean {
  const key = dateKey(date);
  if (WORKING_WEEKENDS_2026.has(key)) return true;
  if (HOLIDAYS_2026.has(key)) return false;
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function addChinaBusinessDays(dateValue: string, count: number): string {
  const date = new Date(`${dateValue.slice(0, 10)}T00:00:00.000Z`);
  let added = 0;
  while (added < count) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isChinaBusinessDay(date)) added += 1;
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
  return input.now <= updateDeadline ? "updating" : "stale";
}
