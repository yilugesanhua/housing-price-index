import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contract = require("../../apps/miniprogram/cloudfunctions/monthlyDataWatchdog/discovery-contract.js") as {
  parseReleaseCalendarHtml: (html: string, fetchedAt?: string, sourceUrl?: string) => ReleaseCalendar;
  parseMonthGridCalendar: (text: string, fetchedAt?: string, sourceUrl?: string) => ReleaseCalendar;
  mergeReleaseCalendars: (monthGrid: ReleaseCalendar, annual: ReleaseCalendar) => ReleaseCalendar;
  fetchReleaseCalendar: () => Promise<ReleaseCalendar>;
};

export type ReleaseCalendarEntry = {
  release_month: string;
  expected_stat_month: string;
  scheduled_at: string;
  date_text: string;
  time_text: string;
};

export type ReleaseCalendar = {
  year: number;
  fetched_at: string;
  source_url: string;
  source_urls?: string[];
  source_warnings?: string[];
  source_responses?: Array<{
    requested_url: string;
    final_url: string;
    status: number;
    content_length: number;
    content_sha256: string;
    attempt: number;
  }>;
  report_name: string;
  raw_content_sha256: string;
  entries: ReleaseCalendarEntry[];
};

// Parsing and source requests live in the CloudBase-deployable contract so
// GitHub and Tencent Cloud cannot gradually recognize different reports.
export function parseReleaseCalendarHtml(html: string, fetchedAt = new Date().toISOString(), sourceUrl?: string): ReleaseCalendar {
  return contract.parseReleaseCalendarHtml(html, fetchedAt, sourceUrl);
}

export function parseMonthGridCalendar(text: string, fetchedAt = new Date().toISOString(), sourceUrl?: string): ReleaseCalendar {
  return contract.parseMonthGridCalendar(text, fetchedAt, sourceUrl);
}

export function mergeReleaseCalendars(monthGrid: ReleaseCalendar, annual: ReleaseCalendar): ReleaseCalendar {
  return contract.mergeReleaseCalendars(monthGrid, annual);
}

export async function fetchReleaseCalendar(): Promise<ReleaseCalendar> {
  return contract.fetchReleaseCalendar();
}

async function main() {
  const outputArgument = process.argv.find((arg) => arg.startsWith("--output="))?.split("=").slice(1).join("=");
  const outputPath = resolve(outputArgument || resolve("work", "monthly-data-check", "release-calendar.json"));
  const calendar = await fetchReleaseCalendar();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(calendar, null, 2)}\n`, "utf8");
  console.log(`Synced ${calendar.year} official release calendar (${calendar.entries.length} months) -> ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
